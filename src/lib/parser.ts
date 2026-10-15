import * as chrono from "chrono-node";
import { endOfLocalDay, instantToWall, wallToInstant, type Lang, type Wall } from "./time";
import { ruleToString, type Freq, type Rule } from "./recurrence";

// Turns plain words ("pay phone bill friday 5pm $45") into an item for the person to confirm.
// No AI: chrono-node reads dates and times, our own rules read the rest.

export type ItemType = "task" | "homework" | "payment" | "package" | "event" | "renewal" | "work" | "habit" | "birthday";
export type WorkKind = "game_day" | "registration" | "sponsor" | "posting";

export type ParsedItem = {
  title: string;
  type: ItemType;
  dueAt: Date | null;
  allDay: boolean;
  amountCents: number | null;
  rrule: string | null;
  /** "Remind me N minutes before" typed by the person, if any. */
  reminderOffsetMinutes: number | null;
  trackingNumber: string | null;
  /** For work items: what kind (game day, registrations, sponsor follow-up, posting). */
  subtype: WorkKind | null;
  /** The name of one of the person's classes, when the words name it ("math hw friday"). */
  courseName: string | null;
  /** Where, from "@ Dr Lopez office" at the end. */
  location: string | null;
  warnings: ("past" | "no_date" | "package_later")[];
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).join("|");

const UNIT_MIN: Record<string, number> = {
  minute: 1, min: 1, minuto: 1, hour: 60, hr: 60, hora: 60, day: 1440, dia: 1440, week: 10080, semana: 10080,
};

const TRACKING_PATTERNS = [
  /\b1Z[0-9A-Z]{16}\b/i, // UPS
  /\bTBA\d{12}\b/i, // Amazon
  /\b9[2345]\d{18,20}\b/, // USPS
  /\b\d{12,15}\b/, // FedEx / generic long number
];

function cut(text: string, index: number, length: number) {
  return `${text.slice(0, index)} ${text.slice(index + length)}`;
}

function extractReminder(text: string): { text: string; minutes: number | null } {
  const re =
    /\b(?:remind me|recu[eé]rdame|av[ií]same)\s+(\d+|an?|one|un|una)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|minutos?|horas?|d[ií]as?|semanas?)\s*(?:before|early|earlier|ahead|antes)\b/i;
  const m = re.exec(text);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
    const unit = norm(m[2]).replace(/s$/, "");
    const per = UNIT_MIN[unit] ?? UNIT_MIN[unit.replace(/s$/, "")];
    if (per) return { text: cut(text, m.index, m[0].length), minutes: n * per };
  }
  // A bare "remind me" is just noise in the title.
  return { text: text.replace(/\b(?:remind me|recu[eé]rdame|av[ií]same)\b/gi, " "), minutes: null };
}

function extractAmount(text: string): { text: string; cents: number | null } {
  const dollar = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(text);
  if (dollar) {
    return { text: cut(text, dollar.index, dollar[0].length), cents: Math.round(parseFloat(dollar[1].replace(/,/g, "")) * 100) };
  }
  const words = /\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd|d[oó]lares)\b/i.exec(text);
  if (words) {
    return { text: cut(text, words.index, words[0].length), cents: Math.round(parseFloat(words[1].replace(/,/g, "")) * 100) };
  }
  return { text, cents: null };
}

function extractRepeat(text: string): { text: string; rule: Rule | null } {
  const t = norm(text);
  let rule: Rule | null = null;
  let matched: RegExpExecArray | null = null;

  const monthDay = String.raw`(?:\s+(?:on the|on|el dia|el)\s+(\d{1,2})(?:st|nd|rd|th)?)?`;

  // every 15th / every month on the 15th / the 15th of every month / monthly on the 15th / cada 15
  let m = /\b(?:every|each|cada)\s+(?:month\s+)?(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:week|day|month|year))/.exec(t);
  if (!m) m = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/.exec(t);
  if (!m) m = /\b(?:monthly|mensual(?:mente)?)\s+(?:on\s+|el\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    return { text: cut(text, m.index, m[0].length), rule: { freq: "MONTHLY", interval: 1, byMonthDay: Number(m[1]) } };
  }

  // every 2 weeks / cada 2 semanas
  m = new RegExp(String.raw`\b(?:every|each|cada)\s+(\d+)\s*(day|week|month|year|dia|semana|mes|ano)s?\b${monthDay}`).exec(t);
  if (m) {
    matched = m;
    rule = freqRule(m[2], Number(m[1]), m[3]);
  }
  // every day / each month on the 1st / cada mes
  if (!rule) {
    m = new RegExp(String.raw`\b(?:every|each|cada)\s+(day|week|month|year|dia|semana|mes|ano)\b${monthDay}`).exec(t);
    if (m) {
      matched = m;
      rule = freqRule(m[1], 1, m[2]);
    }
  }
  // daily / weekly / monthly / yearly / diario ...
  if (!rule) {
    m = new RegExp(String.raw`\b(daily|weekly|monthly|yearly|annually|diario|semanal|mensual|anual)\b${monthDay}`).exec(t);
    if (m) {
      matched = m;
      const f = { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year", diario: "day", semanal: "week", mensual: "month", anual: "year" }[m[1]]!;
      rule = freqRule(f, 1, m[2]);
    }
  }
  // every monday (and wednesday) / cada lunes
  if (!rule) {
    m = new RegExp(String.raw`\b(?:every|each|cada)\s+((?:${WEEKDAY_RE})(?:\s*(?:,|and|y)\s*(?:${WEEKDAY_RE}))*)\b`).exec(t);
    if (m) {
      matched = m;
      const days = [...m[1].matchAll(new RegExp(WEEKDAY_RE, "g"))].map((x) => WEEKDAYS[x[0]]);
      rule = { freq: "WEEKLY", interval: 1, byDay: [...new Set(days)].sort((a, b) => a - b) };
    }
  }
  if (!rule || !matched) return { text, rule: null };
  // Accents were stripped for matching; positions line up one-to-one because NFD marks are removed in place.
  return { text: cut(text, matched.index, matched[0].length), rule };
}

function freqRule(word: string, interval: number, dayOfMonth?: string): Rule {
  const map: Record<string, Freq> = { day: "DAILY", dia: "DAILY", week: "WEEKLY", semana: "WEEKLY", month: "MONTHLY", mes: "MONTHLY", year: "YEARLY", ano: "YEARLY" };
  const freq: Freq = map[word] ?? "DAILY";
  const rule: Rule = { freq, interval };
  if (dayOfMonth && freq === "MONTHLY") {
    const n = Number(dayOfMonth);
    if (n >= 1 && n <= 31) rule.byMonthDay = n;
  }
  return rule;
}

const HOMEWORK_RE = /\b(homework|hw|hmwk|worksheet|assignment|exam|quiz|test|essay|project|midterm|final|tarea|tareas|deberes|examen|ensayo|proyecto|prueba)\b/;
const PAYMENT_RE = /\b(pay|bill|rent|invoice|subscription|tuition|mortgage|pagar|pago|factura|renta|alquiler|recibo|suscripcion|matricula|hipoteca)\b/;
const RENEWAL_RE = /\b(renew|renewal|registration|license|licence|passport|expires?|expiration|renovar|renovacion|registro|licencia|pasaporte|vence)\b/;
const EVENT_RE = /\b(dentist|doctor|appointment|meeting|call|interview|party|game|match|practice|dentista|doctor|cita|reunion|llamada|entrevista|fiesta|partido|practica)\b/;

const BIRTHDAY_RE = /\b(birthday|bday|b-day|cumpleanos|cumple)\b/;
const BIRTHDAY_NOT = /\b(gift|present|cake|card|balloons?|decorations?|regalo|torta|tarjeta)\b/;
const WORK_RE =
  /\b(sponsors?|game ?day|registrations|player registration|team registration|sign-?ups?|roster|posting schedule|liga natural|style jerseys|post (?:on|to|about)|reel|tiktok|instagram)\b/;
const HABIT_RE = /\b(habit|habits|routine|habito|habitos|rutina)\b/;
const HABIT_VERB_RE = /\b(workout|gym|meditate|meditation|stretch|journal|run|walk|study|read|ejercicio|meditar|caminar|estudiar|leer)\b/;

/** Which kind of work item the words describe. */
export function workKind(t: string): WorkKind {
  if (/\bsponsors?\b/.test(t)) return "sponsor";
  if (/\bregistrations?\b|\bsign-?ups?\b/.test(t)) return "registration";
  if (/\bgame ?day\b/.test(t)) return "game_day";
  return "posting";
}

function detectType(text: string, o: { hasAmount: boolean; hasDate: boolean; hasRepeat: boolean }): ItemType {
  const t = norm(text);
  if (BIRTHDAY_RE.test(t) && !BIRTHDAY_NOT.test(t) && o.hasDate) return "birthday";
  if (HABIT_RE.test(t) || (o.hasRepeat && HABIT_VERB_RE.test(t) && !PAYMENT_RE.test(t))) return "habit";
  if (WORK_RE.test(t)) return "work";
  if (HOMEWORK_RE.test(t)) return "homework";
  if (PAYMENT_RE.test(t) || o.hasAmount) return "payment";
  if (RENEWAL_RE.test(t)) return "renewal";
  if (EVENT_RE.test(t)) return "event";
  return "task";
}

function tidyTitle(raw: string): string {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/\b(?:due|vence|para|by|on|at|a las|a la|el|the)\s*$/i, "")
    .replace(/^\s*(?:due|vence|by|on|at)\s+/i, "")
    .replace(/\b(?:due|vence)\s*$/i, "")
    .replace(/[\s,.;:\-–—]+$/g, "")
    .replace(/^[\s,.;:\-–—]+/g, "")
    .trim();
  s = s.replace(/\b(?:due|vence)\b\s*(?=$)/i, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pickChrono(text: string, ref: Date, lang: Lang | "auto") {
  const opts = { forwardDate: true };
  const tryParse = (l: Lang) => (l === "es" ? chrono.es.parse(text, ref, opts) : chrono.en.parse(text, ref, opts));
  if (lang === "en" || lang === "es") return tryParse(lang);
  const en = tryParse("en");
  return en.length ? en : tryParse("es");
}

/** "...@ Dr Lopez office" at the end of the words is the place. */
function extractLocation(text: string): { text: string; location: string | null } {
  const m = /\s@\s?([^@$]{2,120})$/.exec(text);
  if (!m) return { text, location: null };
  return { text: text.slice(0, m.index), location: m[1].trim() };
}

/** Which of the person's classes the words name: a word of the class name (3+ letters) found in the text, if only one class fits. */
export function matchCourse(text: string, courses: string[]): string | null {
  const words = new Set(norm(text).split(/[^a-z0-9]+/).filter(Boolean));
  const hits = courses.filter((c) =>
    norm(c)
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 3 && !/^\d+$/.test(w) && words.has(w)),
  );
  return hits.length === 1 ? hits[0] : null;
}

export function parseQuickAdd(input: string, opts: { now: Date; tz: string; lang: Lang | "auto"; courses?: string[] }): ParsedItem {
  const { now, tz } = opts;
  let text = input.trim().replace(/\s+/g, " ");
  const warnings: ParsedItem["warnings"] = [];
  const place = extractLocation(text);
  text = place.text;

  // Tracking numbers first, so their digits are not mistaken for dates or money.
  let trackingNumber: string | null = null;
  for (const re of TRACKING_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      trackingNumber = m[0].toUpperCase();
      text = cut(text, m.index, m[0].length);
      warnings.push("package_later");
      break;
    }
  }

  const reminder = extractReminder(text);
  text = reminder.text;
  const amount = extractAmount(text);
  text = amount.text;
  const repeat = extractRepeat(text);
  text = repeat.text;

  // Work in the person's wall-clock time so daylight saving can never shift the answer.
  const nowWall = instantToWall(now, tz);
  const ref = new Date(nowWall.y, nowWall.m - 1, nowWall.d, nowWall.h, nowWall.mi, 0);
  const results = pickChrono(text, ref, opts.lang);
  const hit = results[0];

  let dueAt: Date | null = null;
  let allDay = false;
  if (hit) {
    const g = (k: "year" | "month" | "day" | "hour" | "minute") => hit.start.get(k);
    const hasTime = hit.start.isCertain("hour");
    let year = g("year") ?? nowWall.y;
    if (hit.start.isCertain("month") && !hit.start.isCertain("year")) {
      // "oct 1" typed on Oct 14 means the one just gone (flagged as past), not next year.
      const thisYear = wallToInstant({ y: nowWall.y, m: g("month")!, d: g("day") ?? 1, h: 23, mi: 59 }, tz);
      const ageDays = (now.getTime() - thisYear.getTime()) / 86400000;
      year = thisYear.getTime() >= now.getTime() || ageDays > 60 ? (thisYear.getTime() >= now.getTime() ? nowWall.y : nowWall.y + 1) : nowWall.y;
    }
    const wall: Wall = {
      y: year,
      m: g("month") ?? nowWall.m,
      d: g("day") ?? nowWall.d,
      h: hasTime ? (g("hour") ?? 0) : 23,
      mi: hasTime ? (g("minute") ?? 0) : 59,
    };
    allDay = !hasTime;
    dueAt = wallToInstant(wall, tz);
    text = cut(text, hit.index, hit.text.length);
  } else if (repeat.rule) {
    // "rent every month on the 1st" with no date: start at the next matching day.
    dueAt = firstDayFor(repeat.rule, now, tz);
    allDay = true;
  } else {
    warnings.push("no_date");
  }

  if (dueAt && repeat.rule?.freq === "WEEKLY" && repeat.rule.byDay?.length) {
    const explicitDay = hit && (hit.start.isCertain("day") || hit.start.isCertain("weekday") || hit.start.isCertain("month"));
    if (!hit) {
      dueAt = firstDayFor(repeat.rule, now, tz);
    } else if (!explicitDay) {
      // "every monday 6pm": first matching weekday whose time is still ahead.
      const w = instantToWall(dueAt, tz);
      for (let add = 0; add < 14; add++) {
        const probe = new Date(Date.UTC(nowWall.y, nowWall.m - 1, nowWall.d + add));
        if (!repeat.rule.byDay.includes(probe.getUTCDay())) continue;
        const cand = wallToInstant({ y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate(), h: w.h, mi: w.mi }, tz);
        if (cand.getTime() >= now.getTime()) { dueAt = cand; break; }
      }
    }
  }
  if (dueAt && !repeat.rule && dueAt.getTime() < now.getTime() - 60_000) warnings.push("past");

  const type = detectType(`${input}`, { hasAmount: amount.cents !== null, hasDate: dueAt !== null, hasRepeat: !!repeat.rule });
  const title = tidyTitle(text) || tidyTitle(input);
  // A birthday comes back every year, without having to say so.
  const rrule = repeat.rule ? ruleToString(repeat.rule) : type === "birthday" && dueAt ? "FREQ=YEARLY" : null;
  const courseName = type === "homework" && opts.courses?.length ? matchCourse(input, opts.courses) : null;

  return {
    title,
    type,
    dueAt,
    allDay,
    amountCents: amount.cents,
    rrule,
    reminderOffsetMinutes: reminder.minutes,
    trackingNumber,
    subtype: type === "work" ? workKind(norm(input)) : null,
    courseName,
    location: place.location,
    warnings,
  };
}

/** The next day (today counts) that fits a repeat rule, as an end-of-day time. */
function firstDayFor(rule: Rule, now: Date, tz: string): Date {
  const w = instantToWall(now, tz);
  for (let add = 0; add < 400; add++) {
    const probe = new Date(Date.UTC(w.y, w.m - 1, w.d + add));
    const ok =
      rule.freq === "MONTHLY" && rule.byMonthDay
        ? probe.getUTCDate() === rule.byMonthDay
        : rule.freq === "WEEKLY" && rule.byDay?.length
          ? rule.byDay.includes(probe.getUTCDay())
          : true;
    if (ok) {
      return endOfLocalDay(
        wallToInstant({ y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate(), h: 12, mi: 0 }, tz),
        tz,
      );
    }
  }
  return endOfLocalDay(now, tz);
}
