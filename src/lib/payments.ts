import type { AgendaEntry } from "./types";
import { addLocalDays, endOfLocalDay, instantToWall, startOfLocalDay, wallToInstant } from "./time";

export type PaymentGroups = {
  late: AgendaEntry[];
  week: AgendaEntry[];
  month: AgendaEntry[];
  totals: { late: number; week: number; month: number };
};

const sum = (list: AgendaEntry[]) => list.reduce((n, e) => n + (e.amountCents ?? 0), 0);

/** Late; the next 7 days; the rest of this calendar month (after those 7 days). Money is whole cents. */
export function splitPayments(entries: AgendaEntry[], now: Date, tz: string): PaymentGroups {
  const dayStart = startOfLocalDay(now, tz);
  const weekEnd = endOfLocalDay(addLocalDays(now, tz, 7), tz);
  const w = instantToWall(now, tz);
  const monthEnd = new Date(wallToInstant({ y: w.m === 12 ? w.y + 1 : w.y, m: w.m === 12 ? 1 : w.m + 1, d: 1, h: 0, mi: 0 }, tz).getTime() - 1);
  const payments = entries.filter((e) => e.type === "payment");
  const groups = {
    late: payments.filter((e) => new Date(e.dueAt) < dayStart),
    week: payments.filter((e) => new Date(e.dueAt) >= dayStart && new Date(e.dueAt) <= weekEnd),
    month: payments.filter((e) => new Date(e.dueAt) > weekEnd && new Date(e.dueAt) <= monthEnd),
  };
  return { ...groups, totals: { late: sum(groups.late), week: sum(groups.week), month: sum(groups.month) } };
}

/** Today's date in the person's zone as YYYY-MM-DD, for the "Paid on" box. */
export function todayKey(now: Date, tz: string): string {
  const w = instantToWall(now, tz);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}
