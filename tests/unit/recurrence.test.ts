import { describe, expect, it } from "vitest";
import { expandRule, parseRule, ruleToString } from "@/lib/recurrence";
import { instantToWall, wallToInstant } from "@/lib/time";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0) => wallToInstant({ y, m, d, h, mi }, NY);
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe("parseRule / ruleToString", () => {
  it("round trips", () => {
    const rule = parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6")!;
    expect(rule).toMatchObject({ freq: "WEEKLY", interval: 2, byDay: [1, 3], count: 6 });
    expect(ruleToString(rule)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6");
  });
  it("rejects nonsense", () => {
    expect(parseRule("FREQ=HOURLY")).toBeNull();
    expect(parseRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(parseRule("hello")).toBeNull();
  });
});

describe("daylight saving", () => {
  it("a daily 9 AM stays 9 AM when clocks spring forward (Mar 8, 2026)", () => {
    const out = expandRule({ rule: "FREQ=DAILY", start: at(2026, 3, 6, 9), tz: NY, to: at(2026, 3, 10, 23), limit: 5 });
    expect(iso(out)).toEqual([
      "2026-03-06T14:00:00.000Z", // EST
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z", // EDT begins, 9 AM is one hour earlier in UTC
      "2026-03-09T13:00:00.000Z",
      "2026-03-10T13:00:00.000Z",
    ]);
    out.forEach((d) => expect(instantToWall(d, NY).h).toBe(9));
  });

  it("a daily 9 AM stays 9 AM when clocks fall back (Nov 1, 2026)", () => {
    const out = expandRule({ rule: "FREQ=DAILY", start: at(2026, 10, 30, 9), tz: NY, to: at(2026, 11, 3, 23) });
    expect(out.map((d) => instantToWall(d, NY).h)).toEqual([9, 9, 9, 9, 9]);
    expect(out[1].toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(out[2].toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("11:59 PM repeats stay at 11:59 PM across a clock change", () => {
    const out = expandRule({ rule: "FREQ=DAILY", start: at(2026, 3, 7, 23, 59), tz: NY, to: at(2026, 3, 9, 23, 59) });
    out.forEach((d) => expect(instantToWall(d, NY)).toMatchObject({ h: 23, mi: 59 }));
    expect(out).toHaveLength(3);
  });
});

describe("rules", () => {
  it("monthly on the 31st lands on the last day of short months", () => {
    const out = expandRule({ rule: "FREQ=MONTHLY", start: at(2026, 1, 31, 9), tz: NY, to: at(2026, 5, 1, 0) });
    expect(out.map((d) => instantToWall(d, NY).d)).toEqual([31, 28, 31, 30]);
  });

  it("rent on the 1st of every month", () => {
    const out = expandRule({ rule: "FREQ=MONTHLY;BYMONTHDAY=1", start: at(2026, 11, 1, 9), tz: NY, to: at(2027, 2, 2, 0) });
    expect(out.map((d) => instantToWall(d, NY).m)).toEqual([11, 12, 1, 2]);
  });

  it("every other week on Monday and Wednesday", () => {
    const out = expandRule({ rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", start: at(2026, 10, 14, 18), tz: NY, to: at(2026, 11, 20, 0) });
    expect(out.map((d) => instantToWall(d, NY)).map((w) => `${w.m}/${w.d}`)).toEqual([
      "10/14", // starts on a Wednesday
      "10/26",
      "10/28",
      "11/9",
      "11/11",
    ]);
  });

  it("COUNT stops the series and counts hidden past ones too", () => {
    const all = expandRule({ rule: "FREQ=DAILY;COUNT=3", start: at(2026, 10, 1, 9), tz: NY, to: at(2026, 12, 1, 0) });
    expect(all).toHaveLength(3);
    const later = expandRule({ rule: "FREQ=DAILY;COUNT=3", start: at(2026, 10, 1, 9), tz: NY, from: at(2026, 10, 2, 0), to: at(2026, 12, 1, 0) });
    expect(later).toHaveLength(2);
  });

  it("UNTIL ends the series", () => {
    const out = expandRule({ rule: "FREQ=DAILY;UNTIL=20261003", start: at(2026, 10, 1, 9), tz: NY, to: at(2026, 12, 1, 0) });
    expect(out).toHaveLength(3);
  });

  it("yearly on Feb 29 uses Feb 28 in other years", () => {
    const out = expandRule({ rule: "FREQ=YEARLY", start: at(2028, 2, 29, 9), tz: NY, to: at(2030, 3, 1, 0) });
    expect(out.map((d) => instantToWall(d, NY)).map((w) => `${w.y}-${w.m}-${w.d}`)).toEqual(["2028-2-29", "2029-2-28", "2030-2-28"]);
  });

  it("the first time is always the start", () => {
    const out = expandRule({ rule: "FREQ=WEEKLY;BYDAY=FR", start: at(2026, 10, 14, 9), tz: NY, to: at(2026, 10, 25, 0) });
    expect(instantToWall(out[0], NY).d).toBe(14);
  });
});
