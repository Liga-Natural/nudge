import { describe, expect, it } from "vitest";
import { findQuietClash, inQuietHours, quietEndAfter } from "@/lib/quiet";
import { wallToInstant } from "@/lib/time";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0) => wallToInstant({ y, m, d, h, mi }, NY);
const quiet = { start: "22:00", end: "07:00", urgentOverride: false };
const now = at(2026, 10, 14, 20, 0);

describe("quiet hours check", () => {
  it("wraps past midnight", () => {
    expect(inQuietHours(23 * 60 + 5, "22:00", "07:00")).toBe(true);
    expect(inQuietHours(3 * 60, "22:00", "07:00")).toBe(true);
    expect(inQuietHours(12 * 60, "22:00", "07:00")).toBe(false);
    expect(inQuietHours(7 * 60, "22:00", "07:00")).toBe(false);
    expect(inQuietHours(60, "09:00", "09:00")).toBe(false);
  });

  it("flags the 11:05 PM reminder that would have been held silently", () => {
    const clash = findQuietClash({ dueAt: at(2026, 10, 14, 23, 5), reminders: [{ offsetMinutes: 0 }], tz: NY, quiet, now });
    expect(clash).not.toBeNull();
    expect(clash!.releaseAt.getTime()).toBe(at(2026, 10, 15, 7, 0).getTime());
  });

  it("does not flag it when urgent things break through (the reminder fires at the due time)", () => {
    const clash = findQuietClash({ dueAt: at(2026, 10, 14, 23, 5), reminders: [{ offsetMinutes: 0 }], tz: NY, quiet: { ...quiet, urgentOverride: true }, now });
    expect(clash).toBeNull();
  });

  it("still flags an early reminder (a day before at 11 PM) even with the urgent exception on", () => {
    const clash = findQuietClash({ dueAt: at(2026, 10, 16, 9, 0), reminders: [{ daysBefore: 1, atTime: "23:00" }], tz: NY, quiet: { ...quiet, urgentOverride: true }, now });
    expect(clash).not.toBeNull();
  });

  it("is quiet about daytime reminders and ones already in the past", () => {
    expect(findQuietClash({ dueAt: at(2026, 10, 15, 16, 46), reminders: [{ offsetMinutes: 0 }], tz: NY, quiet, now })).toBeNull();
    expect(findQuietClash({ dueAt: at(2026, 10, 14, 19, 0), reminders: [{ offsetMinutes: 0 }], tz: NY, quiet, now })).toBeNull();
    expect(findQuietClash({ dueAt: null, reminders: [], tz: NY, quiet, now })).toBeNull();
  });

  it("finds when quiet hours end, today or tomorrow", () => {
    expect(quietEndAfter(at(2026, 10, 14, 23, 5), NY, "07:00").getTime()).toBe(at(2026, 10, 15, 7).getTime());
    expect(quietEndAfter(at(2026, 10, 14, 3, 0), NY, "07:00").getTime()).toBe(at(2026, 10, 14, 7).getTime());
  });
});
