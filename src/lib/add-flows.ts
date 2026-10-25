// The short "add" flows: a few steps each, chips instead of typing. Everything here is plain data in,
// a complete item (or grade) out, so each flow's save can be tested without a screen.

import { currentTerm, LETTER_POINTS, parseScoreText, type Term } from "./grades";
import type { HwWhere, ItemInput } from "./item-input";
import { ruleToString } from "./recurrence";
import type { NudgeStyle, ReminderSpec } from "./reminders";
import { defaultReminders } from "./reminders";
import { dueInstant } from "./item-input";
import { findQuietClash, type QuietSettings } from "./quiet";
import { addLocalDays, instantToWall, localDateKey } from "./time";

export const ADD_KINDS = ["homework", "task", "payment", "event", "birthday", "habit", "renewal", "grade"] as const;
export type AddKind = (typeof ADD_KINDS)[number];
export const isAddKind = (v: unknown): v is AddKind => typeof v === "string" && (ADD_KINDS as readonly string[]).includes(v);

/** How many steps a flow has (the Step pill reads "Step 1 of 3"). */
export const STEPS: Record<AddKind, number> = { homework: 3, task: 2, payment: 3, event: 3, birthday: 3, habit: 3, renewal: 3, grade: 3 };

export type DueChip = "today" | "tonight" | "tomorrow" | "mon" | "fri" | "first" | "fifteenth" | "m1" | "m3" | "m6" | "y1" | "pick";
export type HwReminder = "night" | "2h" | "both";
export type Repeat = "none" | "weekly" | "monthly" | "yearly";
export type GradeType = "test" | "quiz" | "hw" | "project";
export type ScoreMode = "points" | "percent" | "letter";

export type Draft = {
  title: string;
  emoji: string;
  courseId: string | null;
  dueChip: DueChip | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  hwReminder: HwReminder;
  link: string;
  where: HwWhere | null;
  amount: string; // "45.50", typed on the number pad
  repeat: Repeat;
  autopay: boolean;
  days: number[]; // habit: 0 = Sunday ... 6 = Saturday
  yearly: boolean;
  headsUp: number; // days before
  remindDays: 7 | 30;
  allDay: boolean;
  gradeType: GradeType | null;
  scoreMode: ScoreMode;
  score: string;
  outOf: string;
  percent: string;
  letter: string; // "A".."F"
  sign: "" | "+" | "-";
  term: Term;
};

export function emptyDraft(kind: AddKind, now: Date, tz: string): Draft {
  return {
    title: "",
    emoji: "🌱",
    courseId: null,
    dueChip: null,
    date: "",
    time: "08:00",
    hwReminder: "both",
    link: "",
    where: null,
    amount: "",
    repeat: kind === "payment" ? "monthly" : "none",
    autopay: false,
    days: [1, 2, 3, 4, 5],
    yearly: kind === "birthday",
    headsUp: kind === "birthday" ? 3 : 1,
    remindDays: 7,
    allDay: true,
    gradeType: null,
    scoreMode: "points",
    score: "",
    outOf: "100",
    percent: "",
    letter: "",
    sign: "",
    term: currentTerm(now, tz),
  };
}

// ---------------------------------------------------------------------------------------- dates
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function addMonths(y: number, m: number, d: number, n: number) {
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return ymd(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
}

const weekdayOf = (date: Date, tz: string) => {
  const w = instantToWall(date, tz);
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
};

/** The next time that weekday comes (0 = Sunday), counting from tomorrow so "Mon" on a Monday means next Monday. */
export function nextWeekday(now: Date, tz: string, weekday: number): string {
  const ahead = ((weekday - weekdayOf(now, tz) + 7) % 7) || 7;
  return localDateKey(addLocalDays(now, tz, ahead), tz);
}

/** The first day a weekly habit runs: today if today qualifies and the time has not passed, else the next matching day. */
export function firstOccurrence(now: Date, tz: string, days: number[], time: string): string {
  const w = instantToWall(now, tz);
  const [h, mi] = time.split(":").map(Number);
  if (days.includes(weekdayOf(now, tz)) && (w.h < h || (w.h === h && w.mi < mi))) return localDateKey(now, tz);
  for (let i = 1; i <= 7; i++) {
    const d = addLocalDays(now, tz, i);
    if (days.includes(weekdayOf(d, tz))) return localDateKey(d, tz);
  }
  return localDateKey(now, tz);
}

/** What a date chip means. `time` is only a suggestion, for flows that have a clock time (homework, tonight). */
export function dueFromChip(chip: DueChip, now: Date, tz: string): { date: string; time: string | null } {
  const w = instantToWall(now, tz);
  switch (chip) {
    case "today":
      return { date: localDateKey(now, tz), time: null };
    case "tonight":
      return { date: localDateKey(now, tz), time: w.h >= 20 ? "23:00" : "20:00" };
    case "tomorrow":
      return { date: localDateKey(addLocalDays(now, tz, 1), tz), time: null };
    case "mon":
      return { date: nextWeekday(now, tz, 1), time: null };
    case "fri":
      return { date: nextWeekday(now, tz, 5), time: null };
    case "first":
      return { date: addMonths(w.y, w.m, 1, 1), time: null };
    case "fifteenth":
      return { date: w.d < 15 ? ymd(w.y, w.m, 15) : addMonths(w.y, w.m, 15, 1), time: null };
    case "m1":
      return { date: addMonths(w.y, w.m, w.d, 1), time: null };
    case "m3":
      return { date: addMonths(w.y, w.m, w.d, 3), time: null };
    case "m6":
      return { date: addMonths(w.y, w.m, w.d, 6), time: null };
    case "y1":
      return { date: addMonths(w.y, w.m, w.d, 12), time: null };
    case "pick":
      return { date: "", time: null };
  }
}

/** Picks a chip: sets the date, and the time too when the chip carries one. */
export function pickChip(d: Draft, chip: DueChip, now: Date, tz: string): Draft {
  const r = dueFromChip(chip, now, tz);
  const wasTonight = d.dueChip === "tonight";
  const next: Draft = { ...d, dueChip: chip, date: chip === "pick" ? d.date : r.date, time: r.time ?? (wasTonight ? "08:00" : d.time) };
  // Due tonight leaves no "night before" to remind about.
  if (chip === "tonight" || chip === "today") next.hwReminder = "2h";
  else if (d.hwReminder === "2h" && (d.dueChip === "tonight" || d.dueChip === "today")) next.hwReminder = "both";
  return next;
}

// ------------------------------------------------------------------------------------- reminders
const NIGHT_BEFORE: ReminderSpec = { daysBefore: 1, atTime: "18:00" };
const TWO_HOURS: ReminderSpec = { offsetMinutes: 120 };

export function homeworkReminders(choice: HwReminder): ReminderSpec[] {
  return choice === "night" ? [NIGHT_BEFORE] : choice === "2h" ? [TWO_HOURS] : [NIGHT_BEFORE, TWO_HOURS];
}

const nineAm = (daysBefore: number): ReminderSpec => ({ daysBefore, atTime: "09:00" });
export const headsUpReminders = (n: number): ReminderSpec[] => (n > 0 ? [nineAm(n), nineAm(0)] : [nineAm(0)]);

// ------------------------------------------------------------------------------------ the number pad
/** One key press on the payment number pad. Two decimals at most, seven digits at most. */
export function padPress(amount: string, k: string): string {
  if (k === "back") return amount.slice(0, -1);
  if (k === ".") return amount.includes(".") ? amount : `${amount || "0"}.`;
  if (!/^\d$/.test(k)) return amount;
  if (amount === "0") return k;
  const [whole, frac] = amount.split(".");
  if (frac !== undefined) return frac.length >= 2 ? amount : amount + k;
  return whole.length >= 7 ? amount : amount + k;
}

export function amountToCents(amount: string): number | null {
  if (!amount || amount === ".") return null;
  const n = Math.round(parseFloat(amount) * 100);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------------------- building
export type FlowCtx = { nudgeStyle: NudgeStyle; spaceId: string | null; now: Date; tz: string };

function blank(type: ItemInput["type"], title: string, spaceId: string | null): ItemInput {
  return {
    title,
    type,
    dueLocal: null,
    allDay: true,
    amountCents: null,
    rrule: null,
    spaceId,
    autopay: false,
    courseId: null,
    notes: null,
    location: null,
    link: null,
    where: null,
    subtype: null,
    checklist: [],
    reminders: [],
  };
}

/** Monday first, as a week reads in the US. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The repeat rule for the weekdays a habit runs on. */
export function habitRule(days: number[]): string | null {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 0) return null;
  if (set.length === 7) return "FREQ=DAILY";
  return ruleToString({ freq: "WEEKLY", interval: 1, byDay: set });
}

/** Builds the item a flow saves, or null while a required field is still missing. */
export function buildItem(kind: Exclude<AddKind, "grade">, d: Draft, c: FlowCtx): ItemInput | null {
  const title = d.title.trim();
  if (!title) return null;
  const item = blank(kind, title, c.spaceId);
  switch (kind) {
    case "homework": {
      if (!d.date) return null;
      return {
        ...item,
        courseId: d.courseId,
        dueLocal: `${d.date}T${d.time || "08:00"}`,
        allDay: false,
        link: d.link.trim() || null,
        where: d.where,
        reminders: homeworkReminders(d.hwReminder),
      };
    }
    case "task": {
      if (!d.date) return item;
      const timed = d.dueChip === "tonight";
      return {
        ...item,
        dueLocal: timed ? `${d.date}T${d.time || "20:00"}` : d.date,
        allDay: !timed,
        reminders: defaultReminders("task", !timed, c.nudgeStyle),
      };
    }
    case "payment": {
      if (!d.date) return null;
      return {
        ...item,
        amountCents: amountToCents(d.amount),
        dueLocal: d.date,
        allDay: true,
        rrule: d.repeat === "weekly" ? "FREQ=WEEKLY" : d.repeat === "monthly" ? "FREQ=MONTHLY" : d.repeat === "yearly" ? "FREQ=YEARLY" : null,
        autopay: d.autopay,
        reminders: defaultReminders("payment", true, c.nudgeStyle),
      };
    }
    case "event":
    case "birthday": {
      if (!d.date) return null;
      const timed = kind === "event" && !d.allDay;
      return {
        ...item,
        dueLocal: timed ? `${d.date}T${d.time || "09:00"}` : d.date,
        allDay: !timed,
        rrule: d.yearly ? "FREQ=YEARLY" : null,
        reminders: timed && d.headsUp === 0 ? [{ offsetMinutes: 0 }] : headsUpReminders(d.headsUp),
      };
    }
    case "habit": {
      const rrule = habitRule(d.days);
      if (!rrule) return null;
      const time = d.time || "08:00";
      return {
        ...item,
        title: `${d.emoji ? `${d.emoji} ` : ""}${title}`.slice(0, 200),
        dueLocal: `${firstOccurrence(c.now, c.tz, d.days, time)}T${time}`,
        allDay: false,
        rrule,
        reminders: defaultReminders("habit", false, c.nudgeStyle),
      };
    }
    case "renewal": {
      if (!d.date) return null;
      return { ...item, dueLocal: d.date, allDay: true, reminders: [nineAm(d.remindDays), nineAm(0)] };
    }
  }
}

export const GRADE_TYPES: GradeType[] = ["test", "quiz", "hw", "project"];
export const GRADE_TYPE_LABEL: Record<GradeType, string> = { test: "Test", quiz: "Quiz", hw: "HW", project: "Project" };

export type GradeInput = { courseId: string; title: string; score: number; outOf: number; letter: string | null; points: number | null; term: Term };

/** What the score step has typed so far, as a grade, or null while it is empty or not a number. */
export function readScore(d: Draft): { score: number; outOf: number; letter: string | null } | null {
  if (d.scoreMode === "letter") {
    if (!d.letter) return null;
    return parseScoreText(`${d.letter}${d.letter === "F" ? "" : d.sign}`);
  }
  if (d.scoreMode === "percent") return d.percent.trim() ? parseScoreText(`${d.percent.replace(/%/g, "")}%`) : null;
  if (!d.score.trim()) return null;
  return parseScoreText(`${d.score}/${d.outOf || "100"}`);
}

export function buildGrade(d: Draft): GradeInput | null {
  if (!d.courseId) return null;
  const s = readScore(d);
  if (!s) return null;
  const label = d.gradeType ? GRADE_TYPE_LABEL[d.gradeType] : "";
  const typed = d.title.trim();
  const title = typed ? (label && !typed.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${typed}` : typed) : label;
  if (!title) return null;
  return { courseId: d.courseId, title: title.slice(0, 200), score: s.score, outOf: s.outOf, letter: s.letter, points: s.letter ? (LETTER_POINTS[s.letter] ?? null) : null, term: d.term };
}

// --------------------------------------------------------------------------------------- stepping
/** Whether the step the person is on has what it needs, so Next can light up. */
export function stepReady(kind: AddKind, step: number, d: Draft): boolean {
  switch (kind) {
    case "homework":
      return step === 1 ? true : step === 2 ? !!d.title.trim() && !!d.date : true;
    case "task":
      return step === 1 ? !!d.title.trim() : true;
    case "payment":
    case "event":
    case "birthday":
    case "renewal":
      return step === 1 ? !!d.title.trim() : step === 2 ? !!d.date : true;
    case "habit":
      return step === 1 ? !!d.title.trim() : step === 2 ? d.days.length > 0 : true;
    case "grade":
      return step === 1 ? !!d.courseId : step === 2 ? !!(d.gradeType || d.title.trim()) : !!readScore(d);
  }
}

/** True once everything a flow needs is filled in, so "Save now" can show before the last step. */
export function canSaveNow(kind: AddKind, d: Draft, c: FlowCtx): boolean {
  return kind === "grade" ? buildGrade(d) !== null : buildItem(kind, d, c) !== null;
}

// ---------------------------------------------------------------------------------- recent and again
export type RecentItem = { type: string; title: string; course_id: string | null; created_at: string };
export type Again = { kind: AddKind; title: string; courseId: string | null; count: number };

const norm = (s: string) => s.toLowerCase().replace(/[\d#.:/-]+/g, " ").replace(/\s+/g, " ").trim();
const asKind = (t: string): AddKind | null => (t === "package" ? "task" : isAddKind(t) ? t : null);

/** The last three kinds you added, newest first. */
export function recentKinds(items: RecentItem[]): AddKind[] {
  const out: AddKind[] = [];
  for (const it of [...items].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))) {
    const k = asKind(it.type);
    if (k && k !== "grade" && !out.includes(k)) out.push(k);
    if (out.length === 3) break;
  }
  return out;
}

/** Things you add again and again ("Algebra homework"): the same words (numbers ignored) in the same class, twice or more. */
export function againChips(items: RecentItem[], limit = 3): Again[] {
  const groups = new Map<string, Again & { latest: string }>();
  for (const it of items) {
    const kind = asKind(it.type);
    if (!kind || kind === "habit" || kind === "birthday") continue;
    const words = norm(it.title);
    if (!words) continue;
    const k = `${kind}|${it.course_id ?? ""}|${words}`;
    const g = groups.get(k);
    if (g) {
      g.count++;
      if ((it.created_at ?? "") > g.latest) {
        g.latest = it.created_at ?? "";
        g.title = it.title;
      }
    } else groups.set(k, { kind, title: it.title, courseId: it.course_id, count: 1, latest: it.created_at ?? "" });
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))
    .slice(0, limit)
    .map((g) => ({ kind: g.kind, title: g.title, courseId: g.courseId, count: g.count }));
}

/** When a just-saved item's reminder would be held for quiet hours: the moment it will ring instead, or null if it rings on time. */
export function quietRelease(item: ItemInput, quiet: QuietSettings, tz: string, now: Date): Date | null {
  if (item.ringAnyway) return null;
  const dueAt = dueInstant(item.dueLocal, item.allDay, tz);
  return findQuietClash({ dueAt, reminders: item.reminders, tz, quiet, now })?.releaseAt ?? null;
}
