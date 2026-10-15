import type { AgendaEntry } from "./types";
import type { TFn } from "./i18n";
import { daysBetweenLocal, formatDay, formatMoney, formatTime, type Lang } from "./time";

/** "5:00 PM", "Tomorrow", "Fri, Oct 16 · 5:00 PM" — worked out on the server so phone and server agree. */
export function dueLabel(entry: AgendaEntry, now: Date, tz: string, lang: Lang, t: TFn): string {
  const due = new Date(entry.dueAt);
  const diff = daysBetweenLocal(now, due, tz);
  const day = diff === 0 ? t("today.dueToday") : diff === 1 ? t("today.dueTomorrow") : formatDay(due, tz, lang);
  if (entry.allDay) return day;
  const time = formatTime(due, tz, lang);
  return diff === 0 ? time : `${day} · ${time}`;
}

export const moneyLabel = (entry: Pick<AgendaEntry, "amountCents" | "currency">, lang: Lang) =>
  entry.amountCents != null ? formatMoney(entry.amountCents, entry.currency, lang) : null;
