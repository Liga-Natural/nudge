// The extra dashboard widgets (week strip, bills, exam countdown, activity, tonight mode), as plain functions.

import { isExam } from "./school";
import { addLocalDays, daysBetweenLocal, endOfLocalDay, instantToWall, localDateKey } from "./time";
import type { AgendaEntry } from "./types";

// ------------------------------------------------------------------------------------------- week
export type WeekDay = { key: string; dow: number; count: number; today: boolean; heavy: boolean };

/** The next 7 days (today first) with how many things are due on each; the busiest day (3+) is flagged. */
export function weekStrip(entries: AgendaEntry[], now: Date, tz: string): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addLocalDays(now, tz, i);
    const w = instantToWall(d, tz);
    days.push({ key: localDateKey(d, tz), dow: new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(), count: 0, today: i === 0, heavy: false });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const e of entries) {
    const snoozed = !!e.snoozedUntil && new Date(e.snoozedUntil) > now;
    const key = localDateKey(new Date(snoozed ? (e.snoozedUntil as string) : e.dueAt), tz);
    // Anything already late counts toward today.
    const day = key < days[0].key ? days[0] : byKey.get(key);
    if (day) day.count++;
  }
  const max = Math.max(...days.map((d) => d.count));
  for (const d of days) d.heavy = d.count >= 3 && d.count === max;
  return days;
}

// ------------------------------------------------------------------------------------------- exam
export type ExamCountdown = { entry: AgendaEntry; days: number; fill: number };

/** The nearest test or quiz still ahead, with days to go and a ring that fills as it gets close (14 days out = empty). */
export function examCountdown(entries: AgendaEntry[], now: Date, tz: string): ExamCountdown | null {
  const ahead = entries
    .filter((e) => e.type === "homework" && isExam(e.title) && new Date(e.dueAt) >= now)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  if (!ahead) return null;
  const days = daysBetweenLocal(now, new Date(ahead.dueAt), tz);
  return { entry: ahead, days, fill: Math.max(0.04, Math.min(1, 1 - days / 14)) };
}

// ------------------------------------------------------------------------------------------ bills
export type BillsMonth = { dueCents: number; paidCents: number; dueCount: number; fill: number };

/** This month: what is still to pay (open payments dated this month) against what has been paid. */
export function billsMonth(entries: AgendaEntry[], paid: { amount_cents: number; paid_on: string }[], now: Date, tz: string): BillsMonth {
  const month = localDateKey(now, tz).slice(0, 7);
  const open = entries.filter((e) => e.type === "payment" && localDateKey(new Date(e.dueAt), tz).slice(0, 7) === month);
  const dueCents = open.reduce((n, e) => n + (e.amountCents ?? 0), 0);
  const paidCents = paid.filter((p) => p.paid_on.slice(0, 7) === month).reduce((n, p) => n + p.amount_cents, 0);
  const total = dueCents + paidCents;
  return { dueCents, paidCents, dueCount: open.length, fill: total > 0 ? paidCents / total : 0 };
}

// --------------------------------------------------------------------------------------- activity
export type Activity = { doneToday: number; doneYesterday: number; thisWeek: number; lastWeek: number; hwThisWeek: number; hwLastWeek: number };

/** How much got finished: today, yesterday, this week (Monday on) and the week before. `types` maps item id to its kind. */
export function activityStats(done: { item_id: string; done_at: string | null }[], types: Record<string, string>, now: Date, tz: string): Activity {
  const a: Activity = { doneToday: 0, doneYesterday: 0, thisWeek: 0, lastWeek: 0, hwThisWeek: 0, hwLastWeek: 0 };
  const w = instantToWall(now, tz);
  const sinceMonday = (new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay() + 6) % 7;
  for (const d of done) {
    if (!d.done_at) continue;
    const ago = daysBetweenLocal(new Date(d.done_at), now, tz);
    if (ago < 0) continue;
    const hw = types[d.item_id] === "homework";
    if (ago === 0) a.doneToday++;
    if (ago === 1) a.doneYesterday++;
    if (ago <= sinceMonday) {
      a.thisWeek++;
      if (hw) a.hwThisWeek++;
    } else if (ago <= sinceMonday + 7) {
      a.lastWeek++;
      if (hw) a.hwLastWeek++;
    }
  }
  return a;
}

export const QUOTES = 8;

/** The line for "win of the day": what you finished yesterday or today, else a nudge picked by the day of the year. */
export function winLine(a: Activity, now: Date, tz: string): { kind: "yesterday" | "today" | "quote"; n: number } {
  if (a.doneYesterday > 0) return { kind: "yesterday", n: a.doneYesterday };
  if (a.doneToday > 0) return { kind: "today", n: a.doneToday };
  const w = instantToWall(now, tz);
  const dayOfYear = Math.floor((Date.UTC(w.y, w.m - 1, w.d) - Date.UTC(w.y, 0, 0)) / 86_400_000);
  return { kind: "quote", n: dayOfYear % QUOTES };
}

// ---------------------------------------------------------------------------------- tonight mode
/** Homework to get through tonight: everything late, and everything due before noon tomorrow, in the order it is due. */
export function tonightList(entries: AgendaEntry[], now: Date, tz: string): AgendaEntry[] {
  const cutoff = new Date(endOfLocalDay(addLocalDays(now, tz, 1), tz).getTime() - 12 * 3_600_000);
  return entries
    .filter((e) => e.type === "homework")
    .filter((e) => !(e.snoozedUntil && new Date(e.snoozedUntil) > now))
    .filter((e) => new Date(e.dueAt) <= cutoff)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
