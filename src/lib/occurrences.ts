import { expandRule, parseRule } from "./recurrence";
import { addLocalDays, endOfLocalDay, instantToWall, startOfLocalDay, wallToInstant } from "./time";

/**
 * The times an item should have open occurrences for, right now.
 * One-off items have exactly one. Repeating items get the next 30 days; a series that
 * started in the past does not pile up old "late" copies, only today onward.
 */
export function buildDues(dueAt: Date | null, rrule: string | null, tz: string, now: Date): Date[] {
  if (!dueAt) return [];
  if (!rrule) return [dueAt];
  const rule = parseRule(rrule);
  if (!rule) return [dueAt];
  const today = startOfLocalDay(now, tz);
  return expandRule({
    rule,
    start: dueAt,
    tz,
    from: dueAt < today ? today : undefined,
    to: endOfLocalDay(addLocalDays(now, tz, 30), tz),
    limit: 60,
  });
}

/** "Tomorrow morning": 9:00 AM on the next calendar day, in the person's zone (stays 9 AM on clock-change days). */
export function tomorrowMorning(now: Date, tz: string): Date {
  const w = instantToWall(addLocalDays(now, tz, 1), tz);
  return wallToInstant({ ...w, h: 9, mi: 0 }, tz);
}

/** "Tonight": 8:00 PM today in the person's zone, or null once it is too late for that to make sense (after 7 PM). */
export function tonightAt(now: Date, tz: string): Date | null {
  const w = instantToWall(now, tz);
  if (w.h >= 19) return null;
  return wallToInstant({ ...w, h: 20, mi: 0 }, tz);
}
