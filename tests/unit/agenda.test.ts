import { describe, expect, it } from "vitest";
import { filterBySpace, groupByDay, groupToday, toEntries } from "@/lib/agenda";
import { buildDues, tomorrowMorning } from "@/lib/occurrences";
import { dueInstant, itemInputSchema } from "@/lib/item-input";
import { defaultReminders, fireTime } from "@/lib/reminders";
import { instantToWall, wallToInstant } from "@/lib/time";
import type { AgendaEntry, ItemRow, OccurrenceRow } from "@/lib/types";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0) => wallToInstant({ y, m, d, h, mi }, NY);
const NOW = at(2026, 10, 14, 16, 30); // Wednesday afternoon

const entry = (id: string, due: Date, extra: Partial<AgendaEntry> = {}): AgendaEntry => ({
  occId: id, itemId: id, title: id, type: "task", dueAt: due.toISOString(), allDay: false, amountCents: null,
  currency: "USD", spaceId: null, snoozedUntil: null, recurring: false, priority: 0, courseId: null, autopay: false, ...extra,
});

describe("Today groups", () => {
  it("splits late, today and the next 7 days", () => {
    const g = groupToday(
      [
        entry("last-night", at(2026, 10, 13, 23, 59)),
        entry("this-morning", at(2026, 10, 14, 9)), // earlier today but not before today
        entry("tonight", at(2026, 10, 14, 23, 59)),
        entry("tomorrow", at(2026, 10, 15, 9)),
        entry("in-a-week", at(2026, 10, 21, 20)),
        entry("later", at(2026, 10, 22, 9)),
      ],
      NOW,
      NY,
    );
    expect(g.late.map((e) => e.occId)).toEqual(["last-night"]);
    expect(g.today.map((e) => e.occId)).toEqual(["this-morning", "tonight"]);
    expect(g.next.map((e) => e.occId)).toEqual(["tomorrow", "in-a-week"]);
  });

  it("an item due at 11:59 PM is today until midnight, then late", () => {
    const due = at(2026, 10, 14, 23, 59);
    expect(groupToday([entry("a", due)], at(2026, 10, 14, 23, 58), NY).today).toHaveLength(1);
    expect(groupToday([entry("a", due)], at(2026, 10, 15, 0, 1), NY).late).toHaveLength(1);
  });

  it("uses the person's zone, not the server's, to decide what is today", () => {
    // 11:30 PM Oct 14 in New York is already Oct 15 in UTC.
    const lateNight = at(2026, 10, 14, 23, 30);
    const g = groupToday([entry("a", at(2026, 10, 14, 23, 59))], lateNight, NY);
    expect(g.today).toHaveLength(1);
  });

  it("a snoozed late item sits in Today until its snooze ends", () => {
    const snoozed = entry("s", at(2026, 10, 13, 9), { snoozedUntil: at(2026, 10, 14, 18).toISOString() });
    expect(groupToday([snoozed], NOW, NY).today).toHaveLength(1);
    expect(groupToday([snoozed], at(2026, 10, 14, 19), NY).late).toHaveLength(1);
  });
});

describe("other list helpers", () => {
  it("groups by local day in order", () => {
    const g = groupByDay([entry("b", at(2026, 10, 16, 9)), entry("a", at(2026, 10, 15, 9)), entry("c", at(2026, 10, 15, 20))], NY);
    expect(g.map((d) => [d.day, d.entries.map((e) => e.occId)])).toEqual([
      ["2026-10-15", ["a", "c"]],
      ["2026-10-16", ["b"]],
    ]);
  });

  it("filters by space", () => {
    const list = [entry("a", NOW, { spaceId: "s1" }), entry("b", NOW, { spaceId: "s2" })];
    expect(filterBySpace(list, "s1").map((e) => e.occId)).toEqual(["a"]);
    expect(filterBySpace(list, null)).toHaveLength(2);
  });

  it("joins occurrences to items and hides archived ones", () => {
    const items = [
      { id: "i1", title: "Keep", type: "task", status: "open", space_id: null, all_day: false, amount_cents: null, currency: "USD", rrule: null, priority: 0 },
      { id: "i2", title: "Gone", type: "task", status: "archived", space_id: null, all_day: false, amount_cents: null, currency: "USD", rrule: null, priority: 0 },
    ] as unknown as ItemRow[];
    const occs = [
      { id: "o1", item_id: "i1", due_at: NOW.toISOString(), status: "open", snoozed_until: null, snooze_count: 0, done_at: null },
      { id: "o2", item_id: "i2", due_at: NOW.toISOString(), status: "open", snoozed_until: null, snooze_count: 0, done_at: null },
    ] as OccurrenceRow[];
    expect(toEntries(occs, items).map((e) => e.title)).toEqual(["Keep"]);
  });
});

describe("occurrences", () => {
  it("a one-off item has exactly one", () => {
    expect(buildDues(at(2026, 11, 3, 9), null, NY, NOW)).toHaveLength(1);
    expect(buildDues(null, null, NY, NOW)).toEqual([]);
  });

  it("a daily item gets about 30 days ready", () => {
    const dues = buildDues(at(2026, 10, 14, 9), "FREQ=DAILY", NY, NOW);
    expect(dues.length).toBeGreaterThanOrEqual(30);
    expect(dues.length).toBeLessThanOrEqual(32);
  });

  it("a series that started long ago does not pile up late copies", () => {
    const dues = buildDues(at(2026, 1, 1, 9), "FREQ=DAILY", NY, NOW);
    expect(dues[0].getTime()).toBeGreaterThanOrEqual(at(2026, 10, 14, 0).getTime());
  });

  it("tomorrow morning is 9:00 AM tomorrow, also across a clock change", () => {
    expect(instantToWall(tomorrowMorning(NOW, NY), NY)).toMatchObject({ d: 15, h: 9, mi: 0 });
    expect(instantToWall(tomorrowMorning(at(2026, 3, 7, 22), NY), NY)).toMatchObject({ m: 3, d: 8, h: 9 });
    expect(instantToWall(tomorrowMorning(at(2026, 10, 31, 22), NY), NY)).toMatchObject({ m: 11, d: 1, h: 9 });
  });
});

describe("saving items", () => {
  it("turns the form's date and time into the right moment in the person's zone", () => {
    expect(dueInstant("2026-10-16T17:00", false, NY)?.toISOString()).toBe("2026-10-16T21:00:00.000Z");
    expect(dueInstant("2026-10-16", true, NY)?.toISOString()).toBe("2026-10-17T03:59:00.000Z"); // 11:59 PM
    expect(dueInstant(null, false, NY)).toBeNull();
  });

  it("rejects bad input", () => {
    const ok = { title: "x", type: "task", dueLocal: null, allDay: false, amountCents: null, rrule: null, spaceId: null, autopay: false, courseId: null, notes: null, reminders: [] };
    expect(itemInputSchema.safeParse(ok).success).toBe(true);
    expect(itemInputSchema.safeParse({ ...ok, title: "   " }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...ok, rrule: "FREQ=HOURLY" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...ok, amountCents: -5 }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...ok, reminders: Array(9).fill({ offsetMinutes: 0 }) }).success).toBe(false);
  });
});

describe("default reminders", () => {
  it("payments: 3 days before and on the day, both at 9 AM", () => {
    expect(defaultReminders("payment", true)).toEqual([
      { daysBefore: 3, atTime: "09:00" },
      { daysBefore: 0, atTime: "09:00" },
    ]);
  });
  it("homework with a time: the evening before at 6 PM, and at the due time", () => {
    expect(defaultReminders("homework", false)).toEqual([{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 0 }]);
  });
  it("fire times follow the person's clock", () => {
    const due = at(2026, 3, 8, 9);
    expect(fireTime({ daysBefore: 1, atTime: "18:00" }, due, NY).toISOString()).toBe("2026-03-07T23:00:00.000Z");
    expect(fireTime({ offsetMinutes: 60 }, due, NY).toISOString()).toBe(new Date(due.getTime() - 3600_000).toISOString());
  });
});
