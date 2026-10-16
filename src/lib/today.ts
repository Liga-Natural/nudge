import { addLocalDays, endOfLocalDay, instantToWall, localDateKey, startOfLocalDay } from "./time";
import type { HabitDay } from "./streak";
import type { AgendaEntry } from "./types";

export type Period = "anytime" | "morning" | "afternoon" | "evening";
export const PERIODS: Period[] = ["anytime", "morning", "afternoon", "evening"];

/** Morning is before noon, afternoon is noon to 5 PM, evening is after. Items with no clock time are "anytime". */
export function periodOf(entry: Pick<AgendaEntry, "dueAt" | "allDay">, tz: string): Period {
  if (entry.allDay) return "anytime";
  const h = instantToWall(new Date(entry.dueAt), tz).h;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export const periodNow = (now: Date, tz: string): Exclude<Period, "anytime"> => {
  const h = instantToWall(now, tz).h;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};

/** Puts entries in the person's own order where they dragged them (by id), everything else in due order after. */
export function applyOrder<T extends { occId: string }>(entries: T[], order: string[] | undefined): T[] {
  if (!order?.length) return entries;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...entries].sort((a, b) => (rank.get(a.occId) ?? 1e6) - (rank.get(b.occId) ?? 1e6));
}

export type Timeline = Record<Period, AgendaEntry[]>;

export function groupTimeline(entries: AgendaEntry[], tz: string, order?: string[]): Timeline {
  const out: Timeline = { anytime: [], morning: [], afternoon: [], evening: [] };
  for (const e of entries) out[periodOf(e, tz)].push(e);
  for (const p of PERIODS) out[p] = applyOrder(out[p], order);
  return out;
}

/** Where the "now" line goes inside a period: before the first item that is due after now. */
export function nowLineIndex(items: AgendaEntry[], now: Date): number {
  const i = items.findIndex((e) => new Date(e.dueAt) > now);
  return i === -1 ? items.length : i;
}

export type Views = { today: AgendaEntry[]; tomorrow: AgendaEntry[]; week: AgendaEntry[]; late: AgendaEntry[] };

/**
 * Today = due today. Tomorrow = due tomorrow. This week = everything up to 7 days ahead (so it includes both).
 * Late = open and from before today (a snoozed one sits in Today until its snooze ends).
 */
export function splitViews(entries: AgendaEntry[], now: Date, tz: string): Views {
  const dayStart = startOfLocalDay(now, tz);
  const todayEnd = endOfLocalDay(now, tz);
  const tomorrowEnd = endOfLocalDay(addLocalDays(now, tz, 1), tz);
  const weekEnd = endOfLocalDay(addLocalDays(now, tz, 7), tz); // same reach Today always had: 7 days ahead
  const v: Views = { today: [], tomorrow: [], week: [], late: [] };
  for (const e of entries) {
    const due = new Date(e.dueAt);
    const snoozed = !!e.snoozedUntil && new Date(e.snoozedUntil) > now;
    if (due < dayStart) {
      if (snoozed) {
        v.today.push(e);
        v.week.push(e);
      } else v.late.push(e);
      continue;
    }
    if (due <= weekEnd) v.week.push(e);
    if (due <= todayEnd) v.today.push(e);
    else if (due <= tomorrowEnd) v.tomorrow.push(e);
  }
  return v;
}

/** The next thing coming up (not late, not snoozed away), soonest first. */
export function nextUp(entries: AgendaEntry[], now: Date): AgendaEntry | null {
  let best: AgendaEntry | null = null;
  for (const e of entries) {
    const due = new Date(e.dueAt);
    if (e.snoozedUntil && new Date(e.snoozedUntil) > now) continue;
    if (due < now) continue;
    if (!best || due < new Date(best.dueAt)) best = e;
  }
  return best;
}

export type CountdownParts = { d: number; h: number; m: number; now: boolean };

export function countdown(ms: number): CountdownParts {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return { d: Math.floor(mins / 1440), h: Math.floor((mins % 1440) / 60), m: mins % 60, now: mins < 1 };
}

/** "2h 14m", "45m", "3d 2h", "now". */
export function countdownText(ms: number, now = "now"): string {
  const c = countdown(ms);
  if (c.now) return now;
  if (c.d > 0) return c.h ? `${c.d}d ${c.h}h` : `${c.d}d`;
  if (c.h > 0) return c.m ? `${c.h}h ${c.m}m` : `${c.h}h`;
  return `${c.m}m`;
}

export type DotState = "done" | "skipped" | "missed" | "today" | "future" | "none";

/** The 7 days of the current week (Monday first) as dots: done, skipped, missed, today (still open), or future. */
export function weekDots(days: HabitDay[], now: Date, tz: string): { key: string; state: DotState }[] {
  const todayKey = localDateKey(now, tz);
  const w = instantToWall(now, tz);
  const dow = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const status = new Map<string, HabitDay["status"]>();
  const rank = { done: 3, skipped: 2, open: 1 } as const;
  for (const d of days) {
    const k = localDateKey(new Date(d.dueAt), tz);
    const seen = status.get(k);
    if (!seen || rank[d.status] > rank[seen]) status.set(k, d.status);
  }
  const out: { key: string; state: DotState }[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.UTC(w.y, w.m - 1, w.d - sinceMonday + i));
    const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
    const s = status.get(key);
    const state: DotState =
      key > todayKey
        ? "future"
        : s === "done"
          ? "done"
          : s === "skipped"
            ? "skipped"
            : key === todayKey
              ? s === "open"
                ? "today"
                : "none"
              : s === "open"
                ? "missed"
                : "none";
    out.push({ key, state });
  }
  return out;
}
