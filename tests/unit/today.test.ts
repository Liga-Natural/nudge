import { describe, expect, it } from "vitest";
import { applyOrder, countdownText, groupTimeline, nextUp, nowLineIndex, periodOf, splitViews, weekDots } from "@/lib/today";
import { wallToInstant } from "@/lib/time";
import type { AgendaEntry } from "@/lib/types";

const NY = "America/New_York";
const at = (d: number, h: number, mi = 0) => wallToInstant({ y: 2026, m: 10, d, h, mi }, NY);
// Thursday, Oct 15 2026, 2:00 PM
const NOW = at(15, 14);

const e = (id: string, due: Date, extra: Partial<AgendaEntry> = {}): AgendaEntry => ({
  occId: id, itemId: id, title: id, type: "task", dueAt: due.toISOString(), allDay: false, amountCents: null,
  currency: "USD", spaceId: null, snoozedUntil: null, recurring: false, priority: 0, courseId: null, autopay: false, ...extra,
});

describe("Today timeline", () => {
  it("groups by morning / afternoon / evening, with no-time items as anytime", () => {
    expect(periodOf(e("a", at(15, 9)), NY)).toBe("morning");
    expect(periodOf(e("a", at(15, 12)), NY)).toBe("afternoon");
    expect(periodOf(e("a", at(15, 16, 59)), NY)).toBe("afternoon");
    expect(periodOf(e("a", at(15, 17)), NY)).toBe("evening");
    expect(periodOf(e("a", at(15, 23, 59), { allDay: true }), NY)).toBe("anytime");
    const t = groupTimeline([e("m", at(15, 8)), e("x", at(15, 19)), e("d", at(15, 23, 59), { allDay: true })], NY);
    expect(t.morning.map((x) => x.occId)).toEqual(["m"]);
    expect(t.evening.map((x) => x.occId)).toEqual(["x"]);
    expect(t.anytime.map((x) => x.occId)).toEqual(["d"]);
  });

  it("puts the now line before the first item still ahead", () => {
    const items = [e("a", at(15, 12)), e("b", at(15, 13)), e("c", at(15, 15)), e("d", at(15, 16))];
    expect(nowLineIndex(items, NOW)).toBe(2);
    expect(nowLineIndex(items, at(15, 6))).toBe(0);
    expect(nowLineIndex(items, at(15, 20))).toBe(4);
  });

  it("applies a saved drag order, leaving unlisted items after in time order", () => {
    const items = [e("a", at(15, 9)), e("b", at(15, 10)), e("c", at(15, 11))];
    expect(applyOrder(items, ["c", "a"]).map((x) => x.occId)).toEqual(["c", "a", "b"]);
    expect(applyOrder(items, undefined)).toBe(items);
  });
});

describe("Today views and counts", () => {
  const all = [
    e("late", at(14, 10)),
    e("snoozed-late", at(13, 10), { snoozedUntil: at(15, 18).toISOString() }),
    e("today", at(15, 18)),
    e("tomorrow", at(16, 9)),
    e("later", at(19, 9)),
    e("far", at(25, 9)),
  ];
  it("splits late / today / tomorrow / this week, one place each for late", () => {
    const v = splitViews(all, NOW, NY);
    expect(v.late.map((x) => x.occId)).toEqual(["late"]);
    expect(v.today.map((x) => x.occId).sort()).toEqual(["snoozed-late", "today"]);
    expect(v.tomorrow.map((x) => x.occId)).toEqual(["tomorrow"]);
    expect(v.week.map((x) => x.occId).sort()).toEqual(["later", "snoozed-late", "today", "tomorrow"]);
  });

  it("finds the next thing up and formats the countdown", () => {
    const n = nextUp(all, NOW);
    expect(n?.occId).toBe("today");
    expect(countdownText(at(15, 16, 14).getTime() - NOW.getTime())).toBe("2h 14m");
    expect(countdownText(45 * 60_000)).toBe("45m");
    expect(countdownText(26 * 3_600_000)).toBe("1d 2h");
    expect(countdownText(10_000)).toBe("now");
  });
});

describe("habit week dots", () => {
  it("shows Monday to Sunday with done, skipped, missed, today and future", () => {
    const days = [
      { dueAt: at(12, 9).toISOString(), status: "done" as const },
      { dueAt: at(13, 9).toISOString(), status: "skipped" as const },
      { dueAt: at(14, 9).toISOString(), status: "open" as const },
      { dueAt: at(15, 9).toISOString(), status: "open" as const },
    ];
    const dots = weekDots(days, NOW, NY);
    expect(dots.map((d) => d.key)[0]).toBe("2026-10-12");
    expect(dots.map((d) => d.state)).toEqual(["done", "skipped", "missed", "today", "future", "future", "future"]);
  });
});
