// What the Today dashboard cards show, worked out from plain data so it can be tested without a screen.

import { classHeadline, defaultTerm, gradeValue, LETTER_POINTS, letterText, shortGrade, termHeadline, yearOf, type GradeLike, type LetterLike } from "./grades";
import { daysBetweenLocal, localDateKey } from "./time";
import type { AgendaEntry, Course, GradeRowDb, OccurrenceRow } from "./types";

// ----------------------------------------------------------------------------- card order and hiding
export const CARD_IDS = ["school", "grades", "money", "habits", "coming", "week", "focus", "exam", "bills", "streaks", "win", "recap"] as const;
export type CardId = (typeof CARD_IDS)[number];
export type DashPref = { order?: string[]; hidden?: string[] };
export const isCardId = (v: unknown): v is CardId => typeof v === "string" && (CARD_IDS as readonly string[]).includes(v);

/** The cards to draw, in the person's order. Cards that are not available (feature off) never appear; new cards join the end. */
export function layoutFor(pref: DashPref | null | undefined, available: CardId[]): { shown: CardId[]; hidden: CardId[]; order: CardId[] } {
  const ok = new Set(available);
  const ordered: CardId[] = [];
  for (const id of pref?.order ?? []) if (isCardId(id) && ok.has(id) && !ordered.includes(id)) ordered.push(id);
  for (const id of CARD_IDS) if (ok.has(id) && !ordered.includes(id)) ordered.push(id);
  const hidden = ordered.filter((id) => (pref?.hidden ?? []).includes(id));
  return { shown: ordered.filter((id) => !hidden.includes(id)), hidden, order: ordered };
}

/** Moves one card a step up or down. */
export function moveCard(order: CardId[], id: CardId, dir: -1 | 1): CardId[] {
  const from = order.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// --------------------------------------------------------------------------------------------- school
export type SchoolCard = { next: AgendaEntry[]; missing: number; total: number };

/** The next three homework, and how many are already past due. */
export function schoolCard(entries: AgendaEntry[], now: Date): SchoolCard {
  const hw = entries.filter((e) => e.type === "homework");
  const snoozed = (e: AgendaEntry) => !!e.snoozedUntil && new Date(e.snoozedUntil) > now;
  const isPast = (e: AgendaEntry) => new Date(e.dueAt) < now && !snoozed(e);
  // A snoozed one counts from when it comes back.
  const when = (e: AgendaEntry) => (snoozed(e) ? (e.snoozedUntil as string) : e.dueAt);
  const ahead = hw.filter((e) => !isPast(e)).sort((a, b) => when(a).localeCompare(when(b)));
  return { next: ahead.slice(0, 3), missing: hw.filter(isPast).length, total: hw.length };
}

// ---------------------------------------------------------------------------------------------- money
export type MoneyCard = { next: AgendaEntry | null; overdue: boolean; more: number };

/** The payment that is due next (or the oldest unpaid one), and how many more are coming. */
export function moneyCard(entries: AgendaEntry[], now: Date): MoneyCard {
  const pays = entries.filter((e) => e.type === "payment").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const next = pays[0] ?? null;
  return { next, overdue: !!next && new Date(next.dueAt) < now, more: Math.max(0, pays.length - 1) };
}

// ------------------------------------------------------------------------------------------ coming up
export type Coming = { entry: AgendaEntry; days: number };
export const COMING_TYPES = ["birthday", "event", "renewal"] as const;

/** Birthdays, appointments and renewals in the next two weeks, soonest first, with how many days away. */
export function comingUp(entries: AgendaEntry[], now: Date, tz: string, days = 14): Coming[] {
  return entries
    .filter((e) => (COMING_TYPES as readonly string[]).includes(e.type))
    .map((entry) => ({ entry, days: daysBetweenLocal(now, new Date(entry.dueAt), tz) }))
    .filter((c) => c.days >= 0 && c.days <= days)
    .sort((a, b) => a.entry.dueAt.localeCompare(b.entry.dueAt));
}

// ---------------------------------------------------------------------------------------------- grades
export type GradeRing = { courseId: string; name: string; text: string; ring: number; count: number };
export type NewestGrade = { courseId: string | null; title: string; text: string; dir: "up" | "down" | "same" | null };
export type GradesCard = { rings: GradeRing[]; newest: NewestGrade | null; termLabel: string | null };

const signed = (n: number) => (Math.abs(n) < 0.05 ? "same" : n > 0 ? "up" : "down");
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

type Row = Pick<GradeRowDb, "id" | "course_id" | "title" | "score" | "out_of" | "posted_at" | "letter" | "points" | "term" | "school_year">;
const asLike = (g: Row): GradeLike & LetterLike & { posted_at: string; term: string | null | undefined } => ({
  score: Number(g.score),
  out_of: Number(g.out_of),
  letter: g.letter,
  points: g.points,
  posted_at: g.posted_at,
  term: g.term,
});

/** 0 to 1, for a ring: the points on the 4.0 scale if there are any, else the percent. */
export function ringFill(h: ReturnType<typeof classHeadline>): number {
  if (!h) return 0;
  if (h.kind === "letter") {
    const v = h.points ?? LETTER_POINTS[h.letter.toUpperCase()];
    return v === undefined || v === null ? 0 : Math.max(0, Math.min(1, v / 4));
  }
  return Math.max(0, Math.min(1, h.percent / 100));
}

/**
 * One ring per class in the current school year (its newest quarter with a grade), plus the newest grade
 * with an arrow for whether it went up or down from the one before it in that class.
 */
export function gradesCard(courses: Course[], grades: Row[], current: string): GradesCard {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const year = (g: Row) => yearOf(g, g.course_id ? byId.get(g.course_id) : null, current);
  const mine = grades.filter((g) => year(g) === current);
  const term = defaultTerm(mine.map(asLike));
  const rings: GradeRing[] = [];
  for (const c of courses) {
    if (yearOf(c, null, current) !== current) continue;
    const rows = mine.filter((g) => g.course_id === c.id).map(asLike);
    const h = termHeadline(rows, term);
    if (!h) continue;
    rings.push({ courseId: c.id, name: c.name, text: h.kind === "letter" ? h.letter : shortGrade(h) ?? "", ring: ringFill(h), count: rows.length });
  }
  const sorted = [...mine].sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  const top = sorted[0];
  let newest: NewestGrade | null = null;
  if (top) {
    const prev = sorted.slice(1).find((g) => g.course_id === top.course_id && !!g.letter === !!top.letter);
    const a = gradeValue({ score: Number(top.score), out_of: Number(top.out_of), letter: top.letter, points: top.points });
    const b = prev ? gradeValue({ score: Number(prev.score), out_of: Number(prev.out_of), letter: prev.letter, points: prev.points }) : null;
    newest = {
      courseId: top.course_id,
      title: top.title,
      text: top.letter ? letterText(top.letter, top.points) : `${num(Number(top.score))}/${num(Number(top.out_of))}`,
      dir: a !== null && b !== null ? signed(a - b) : null,
    };
  }
  return { rings, newest, termLabel: term === "all" ? null : term };
}

// ---------------------------------------------------------------------------------------------- habits
export type HabitCircle = { itemId: string; occId: string; title: string; emoji: string; done: boolean; streak: number };

/** A leading emoji in a title ("🏃 Run" -> "🏃"), or a plant. */
export function leadingEmoji(title: string): { emoji: string; rest: string } {
  const m = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u.exec(title.trim());
  return m ? { emoji: m[1], rest: m[2] || title.trim() } : { emoji: "🌱", rest: title.trim() };
}

/** Today's habits as tappable circles: each habit that has a time today, open or already done. */
export function habitCircles(
  habits: { id: string; title: string }[],
  occs: Pick<OccurrenceRow, "id" | "item_id" | "due_at" | "status">[],
  streaks: Record<string, number>,
  now: Date,
  tz: string,
): HabitCircle[] {
  const todayKey = localDateKey(now, tz);
  const out: HabitCircle[] = [];
  for (const h of habits) {
    const todays = occs.filter((o) => o.item_id === h.id && localDateKey(new Date(o.due_at), tz) === todayKey && o.status !== "skipped");
    if (!todays.length) continue;
    const open = todays.find((o) => o.status === "open");
    const o = open ?? todays[0];
    const { emoji, rest } = leadingEmoji(h.title);
    out.push({ itemId: h.id, occId: o.id, title: rest, emoji, done: !open, streak: streaks[h.id] ?? 0 });
  }
  return out;
}
