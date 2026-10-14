import { fromZonedTime } from "date-fns-tz";

// Every date in Nudge is shown with an explicit time zone, so the server and the
// phone always print the same text.

export type Wall = { y: number; m: number; d: number; h: number; mi: number };

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

export function wallToInstant(w: Wall, tz: string): Date {
  return fromZonedTime(`${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:00`, tz);
}

export function instantToWall(date: Date, tz: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

export function localDateKey(date: Date, tz: string): string {
  const w = instantToWall(date, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

export function startOfLocalDay(date: Date, tz: string): Date {
  const w = instantToWall(date, tz);
  return wallToInstant({ ...w, h: 0, mi: 0 }, tz);
}

/** Same clock time, `n` calendar days later (9 AM stays 9 AM across daylight saving). */
export function addLocalDays(date: Date, tz: string, n: number): Date {
  const w = instantToWall(date, tz);
  const shifted = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return wallToInstant(
    { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: w.h, mi: w.mi },
    tz,
  );
}

export function endOfLocalDay(date: Date, tz: string): Date {
  const w = instantToWall(date, tz);
  return wallToInstant({ ...w, h: 23, mi: 59 }, tz);
}

export function daysBetweenLocal(a: Date, b: Date, tz: string): number {
  const wa = instantToWall(a, tz);
  const wb = instantToWall(b, tz);
  return Math.round((Date.UTC(wb.y, wb.m - 1, wb.d) - Date.UTC(wa.y, wa.m - 1, wa.d)) / 86400000);
}

export type Lang = "en" | "es";
const locale = (lang: Lang) => (lang === "es" ? "es-US" : "en-US");

export function formatTime(date: Date, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDay(date: Date, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDayLong(date: Date, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatMoney(cents: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency }).format(cents / 100);
}

export const isAllDayTime = (date: Date, tz: string) => {
  const w = instantToWall(date, tz);
  return w.h === 23 && w.mi === 59;
};
