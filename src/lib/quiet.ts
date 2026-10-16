import { fireTime, type ReminderSpec } from "./reminders";
import { instantToWall, wallToInstant } from "./time";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Same rule as nudge_in_quiet() in the database: from-until, wrapping past midnight. */
export function inQuietHours(localMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
}

export type QuietSettings = { start: string; end: string; urgentOverride: boolean };

export type QuietClash = { fireAt: Date; releaseAt: Date };

/**
 * The first reminder of a new item that the clock would hold back for quiet hours (and so tell nobody),
 * or null when every reminder rings on time. Mirrors dispatch_claim(): a reminder fires inside quiet
 * hours and is held unless the "urgent" exception applies (it fires within an hour of the due time).
 */
export function findQuietClash(opts: {
  dueAt: Date | null;
  reminders: ReminderSpec[];
  tz: string;
  quiet: QuietSettings;
  now: Date;
}): QuietClash | null {
  const { dueAt, reminders, tz, quiet, now } = opts;
  if (!dueAt) return null;
  const fires = reminders
    .map((r) => fireTime(r, dueAt, tz))
    .filter((f) => f.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  for (const fireAt of fires) {
    const w = instantToWall(fireAt, tz);
    if (!inQuietHours(w.h * 60 + w.mi, quiet.start, quiet.end)) continue;
    if (quiet.urgentOverride && dueAt.getTime() - fireAt.getTime() <= 3_600_000) continue;
    return { fireAt, releaseAt: quietEndAfter(fireAt, tz, quiet.end) };
  }
  return null;
}

/** The next moment quiet hours end, counted from `from` (mirrors nudge_quiet_end_at). */
export function quietEndAfter(from: Date, tz: string, end: string): Date {
  const w = instantToWall(from, tz);
  const [h, mi] = end.slice(0, 5).split(":").map(Number);
  const sameDay = wallToInstant({ y: w.y, m: w.m, d: w.d, h, mi }, tz);
  if (sameDay.getTime() > from.getTime()) return sameDay;
  const next = new Date(Date.UTC(w.y, w.m - 1, w.d + 1));
  return wallToInstant({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate(), h, mi }, tz);
}
