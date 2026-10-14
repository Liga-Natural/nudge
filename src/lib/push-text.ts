import { daysBetweenLocal, formatDay, formatMoney, formatTime, type Lang } from "./time";

// The words in notifications, in English and Spanish.

export type ReminderRow = {
  send_id: string;
  user_id: string;
  item_id: string;
  title: string;
  item_type: string;
  due_at: string;
  all_day: boolean;
  amount_cents: number | null;
  currency: string;
  kind: "reminder" | "snooze";
  label: string | null;
  fire_at: string;
  timezone: string;
  language: Lang;
};

export type SummaryRow = {
  user_id: string;
  timezone: string;
  language: Lang;
  local_date: string;
  today_count: number;
  late_count: number;
  payments_count: number;
  payments_cents: number;
};

export type PushPayload = { title: string; body: string; url: string; tag?: string };

const EMOJI: Record<string, string> = { task: "✅", homework: "📚", payment: "💳", package: "📦", event: "📅", renewal: "🔁" };
export const emojiFor = (type: string) => EMOJI[type] ?? "✅";

const T = {
  en: {
    autopay: (when: string) => `Heads up: autopay is on (${when})`,
    dueNow: "Due now",
    inMinutes: (n: number) => `Due in ${n} minute${n === 1 ? "" : "s"}`,
    inHours: (n: number) => `Due in ${n} hour${n === 1 ? "" : "s"}`,
    today: "Due today",
    tomorrow: "Due tomorrow",
    todayAt: (t: string) => `Due today at ${t}`,
    tomorrowAt: (t: string) => `Due tomorrow at ${t}`,
    dueOn: (d: string) => `Due ${d}`,
    dueOnAt: (d: string, t: string) => `Due ${d} at ${t}`,
    late: "This is late",
    lateAt: (t: string) => `Was due at ${t}`,
    snoozeBack: "Snooze is over",
    missed: "Missed while you were away",
    many: (n: number) => `${n} reminders`,
    summaryTitle: "Good morning ☀️",
    todayThings: (n: number) => `Today: ${n} thing${n === 1 ? "" : "s"}`,
    lateThings: (n: number) => `${n} late`,
    paymentsDue: (n: number, money: string) => `💳 ${money} due in 7 days${n > 1 ? ` (${n} bills)` : ""}`,
  },
  es: {
    autopay: (when: string) => `Aviso: el pago automático está activo (${when})`,
    dueNow: "Vence ahora",
    inMinutes: (n: number) => `Vence en ${n} minuto${n === 1 ? "" : "s"}`,
    inHours: (n: number) => `Vence en ${n} hora${n === 1 ? "" : "s"}`,
    today: "Vence hoy",
    tomorrow: "Vence mañana",
    todayAt: (t: string) => `Vence hoy a las ${t}`,
    tomorrowAt: (t: string) => `Vence mañana a las ${t}`,
    dueOn: (d: string) => `Vence ${d}`,
    dueOnAt: (d: string, t: string) => `Vence ${d} a las ${t}`,
    late: "Esto va tarde",
    lateAt: (t: string) => `Vencía a las ${t}`,
    snoozeBack: "Se acabó la pausa",
    missed: "Perdido mientras no estabas",
    many: (n: number) => `${n} recordatorios`,
    summaryTitle: "Buenos días ☀️",
    todayThings: (n: number) => `Hoy: ${n} cosa${n === 1 ? "" : "s"}`,
    lateThings: (n: number) => `${n} atrasada${n === 1 ? "" : "s"}`,
    paymentsDue: (n: number, money: string) => `💳 ${money} por pagar en 7 días${n > 1 ? ` (${n} pagos)` : ""}`,
  },
} as const;

export function describeDue(row: Pick<ReminderRow, "due_at" | "all_day">, now: Date, tz: string, lang: Lang): string {
  const t = T[lang];
  const due = new Date(row.due_at);
  const minutes = Math.round((due.getTime() - now.getTime()) / 60000);
  const dayDiff = daysBetweenLocal(now, due, tz);
  if (row.all_day) {
    if (dayDiff < 0) return t.late;
    if (dayDiff === 0) return t.today;
    if (dayDiff === 1) return t.tomorrow;
    return t.dueOn(formatDay(due, tz, lang));
  }
  const time = formatTime(due, tz, lang);
  if (minutes < -1) return t.lateAt(time);
  if (minutes <= 1) return t.dueNow;
  if (minutes < 60) return t.inMinutes(minutes);
  if (minutes < 180 && dayDiff === 0) return t.inHours(Math.round(minutes / 60));
  if (dayDiff === 0) return t.todayAt(time);
  if (dayDiff === 1) return t.tomorrowAt(time);
  return t.dueOnAt(formatDay(due, tz, lang), time);
}

export function buildReminderPayload(rows: ReminderRow[], now: Date, opts: { autopay?: Set<string> } = {}): PushPayload {
  const first = rows[0];
  const lang = first.language;
  const tz = first.timezone;
  const t = T[lang];
  const missed = rows.every((r) => r.label === "missed");
  const lines = rows.map((r) => {
    const money = r.amount_cents != null ? ` · ${formatMoney(r.amount_cents, r.currency, lang)}` : "";
    const base = r.kind === "snooze" && !r.all_day ? t.snoozeBack : describeDue(r, now, tz, lang);
    // Autopay: only ever a heads-up, never "pay now".
    const due = new Date(r.due_at);
    const dayAndTime = r.all_day ? formatDay(due, tz, lang) : `${formatDay(due, tz, lang)} · ${formatTime(due, tz, lang)}`;
    const when = opts.autopay?.has(r.item_id) ? t.autopay(dayAndTime) : base;
    return { head: `${emojiFor(r.item_type)} ${r.title}${money}`, when };
  });
  const prefix = missed ? `${t.missed}: ` : "";
  if (rows.length === 1) {
    return { title: `${prefix}${lines[0].head}`.slice(0, 120), body: lines[0].when, url: "/", tag: first.item_id };
  }
  return {
    title: missed ? `${t.missed} (${rows.length})` : t.many(rows.length),
    body: lines.slice(0, 4).map((l) => `${l.head} — ${l.when}`).join("\n"),
    url: "/",
    tag: `group-${first.user_id}`,
  };
}

export function buildSummaryPayload(row: SummaryRow): PushPayload {
  const t = T[row.language];
  const parts: string[] = [];
  if (row.today_count > 0) parts.push(t.todayThings(row.today_count));
  if (row.late_count > 0) parts.push(t.lateThings(row.late_count));
  if (row.payments_count > 0) parts.push(t.paymentsDue(row.payments_count, formatMoney(row.payments_cents, "USD", row.language)));
  return { title: t.summaryTitle, body: parts.join(" · "), url: "/", tag: `summary-${row.local_date}` };
}
