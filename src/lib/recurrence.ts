import { instantToWall, wallToInstant } from "./time";

// A small, careful subset of repeat rules (RRULE strings):
//   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY ; INTERVAL=n ; BYDAY=MO,TU.. ; BYMONTHDAY=n ; COUNT=n ; UNTIL=YYYYMMDD
// Rules are worked out in the person's wall-clock time, so 9 AM stays 9 AM across
// daylight saving changes. Day 31 in a short month becomes the last day of that month.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Rule = {
  freq: Freq;
  interval: number;
  byDay?: number[]; // 0 = Sunday ... 6 = Saturday
  byMonthDay?: number;
  count?: number;
  until?: string; // YYYYMMDD
};

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRule(text: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const piece of text.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = piece.split("=");
    if (k && v) parts[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = parts.FREQ as Freq | undefined;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const rule: Rule = { freq, interval };
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(",").map((c) => DAY_CODES.indexOf(c.replace(/^[-+]?\d+/, "")));
    if (days.some((d) => d < 0)) return null;
    rule.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  if (parts.BYMONTHDAY) {
    const n = Number(parts.BYMONTHDAY);
    if (!Number.isInteger(n) || n < 1 || n > 31) return null;
    rule.byMonthDay = n;
  }
  if (parts.COUNT) {
    const n = Number(parts.COUNT);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return null;
    rule.count = n;
  }
  if (parts.UNTIL) {
    if (!/^\d{8}/.test(parts.UNTIL)) return null;
    rule.until = parts.UNTIL.slice(0, 8);
  }
  return rule;
}

export function ruleToString(rule: Rule): string {
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) out.push(`BYDAY=${rule.byDay.map((d) => DAY_CODES[d]).join(",")}`);
  if (rule.byMonthDay) out.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.count) out.push(`COUNT=${rule.count}`);
  if (rule.until) out.push(`UNTIL=${rule.until}`);
  return out.join(";");
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/**
 * Lists the times a repeating item is due, from its first time onward.
 * `from` hides earlier ones (but they still count towards COUNT). Stops at `to` or `limit`.
 */
export function expandRule(opts: {
  rule: Rule | string;
  start: Date;
  tz: string;
  from?: Date;
  to: Date;
  limit?: number;
}): Date[] {
  const rule = typeof opts.rule === "string" ? parseRule(opts.rule) : opts.rule;
  if (!rule) return [];
  const { start, tz, to } = opts;
  const limit = opts.limit ?? 400;
  const s = instantToWall(start, tz);
  const startDay = Date.UTC(s.y, s.m - 1, s.d);
  const untilDay = rule.until
    ? Date.UTC(Number(rule.until.slice(0, 4)), Number(rule.until.slice(4, 6)) - 1, Number(rule.until.slice(6, 8)))
    : Infinity;

  const days: number[] = []; // UTC day numbers (ms), in order
  const MAX_DAYS = 366 * 12;
  const push = (utcMs: number) => {
    if (utcMs >= startDay && utcMs <= untilDay) days.push(utcMs);
  };

  const horizon = instantToWall(to, tz);
  const horizonDay = Date.UTC(horizon.y, horizon.m - 1, horizon.d) + 86400000;
  const stop = Math.min(untilDay, horizonDay);

  if (rule.freq === "DAILY") {
    for (let k = 0; days.length < MAX_DAYS; k++) {
      const d = startDay + k * rule.interval * 86400000;
      if (d > stop) break;
      push(d);
    }
  } else if (rule.freq === "WEEKLY") {
    const byDay = rule.byDay?.length ? rule.byDay : [new Date(startDay).getUTCDay()];
    const startWeek = startDay - ((new Date(startDay).getUTCDay() + 6) % 7) * 86400000; // Monday
    for (let k = 0; days.length < MAX_DAYS; k++) {
      const weekStart = startWeek + k * rule.interval * 7 * 86400000;
      if (weekStart > stop) break;
      for (const wd of [...byDay].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        push(weekStart + ((wd + 6) % 7) * 86400000);
      }
    }
  } else if (rule.freq === "MONTHLY") {
    const want = rule.byMonthDay ?? s.d;
    for (let k = 0; days.length < MAX_DAYS; k++) {
      const total = s.m - 1 + k * rule.interval;
      const y = s.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const d = Math.min(want, daysInMonth(y, m));
      const ms = Date.UTC(y, m - 1, d);
      if (Date.UTC(y, m - 1, 1) > stop) break;
      push(ms);
    }
  } else {
    for (let k = 0; days.length < MAX_DAYS; k++) {
      const y = s.y + k * rule.interval;
      const d = Math.min(s.d, daysInMonth(y, s.m));
      const ms = Date.UTC(y, s.m - 1, d);
      if (Date.UTC(y, 0, 1) > stop) break;
      push(ms);
    }
  }

  // The first time is always the start itself, even if the pattern would skip it.
  if (!days.length || days[0] !== startDay) days.unshift(startDay);

  const out: Date[] = [];
  let counted = 0;
  for (const ms of days) {
    if (rule.count && counted >= rule.count) break;
    counted++;
    const dt = new Date(ms);
    const instant = wallToInstant(
      { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: s.h, mi: s.mi },
      tz,
    );
    if (instant > to) break;
    if (opts.from && instant < opts.from) continue;
    out.push(instant);
    if (out.length >= limit) break;
  }
  return out;
}

export function describeRule(rule: Rule, lang: "en" | "es"): string {
  const en = lang === "en";
  const n = rule.interval;
  if (rule.freq === "DAILY") return n === 1 ? (en ? "Every day" : "Cada día") : en ? `Every ${n} days` : `Cada ${n} días`;
  if (rule.freq === "WEEKLY") {
    const names = en
      ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      : ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const base = n === 1 ? (en ? "Every week" : "Cada semana") : en ? `Every ${n} weeks` : `Cada ${n} semanas`;
    return rule.byDay?.length ? `${base} (${rule.byDay.map((d) => names[d]).join(", ")})` : base;
  }
  if (rule.freq === "MONTHLY") {
    const base = n === 1 ? (en ? "Every month" : "Cada mes") : en ? `Every ${n} months` : `Cada ${n} meses`;
    return rule.byMonthDay ? `${base} (${en ? "day" : "día"} ${rule.byMonthDay})` : base;
  }
  return n === 1 ? (en ? "Every year" : "Cada año") : en ? `Every ${n} years` : `Cada ${n} años`;
}
