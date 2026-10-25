// Grades: a class average is total points earned over total points possible (so a 5/5 quiz does not
// count as much as a 90/100 test). Scores are shown to one decimal, never rounded up to look better.

import { instantToWall } from "./time";

export type GradeLike = { score: number; out_of: number };

export function classAverage(grades: GradeLike[]): number | null {
  const possible = grades.reduce((n, g) => n + g.out_of, 0);
  if (!grades.length || possible <= 0) return null;
  const earned = grades.reduce((n, g) => n + g.score, 0);
  return Math.round((earned / possible) * 1000) / 10;
}

export function percentOf(score: number, outOf: number): number | null {
  return outOf > 0 ? Math.round((score / outOf) * 1000) / 10 : null;
}

/** A, B, C... for the usual US cut-offs. */
export function letterFor(percent: number): string {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

// Some schools (Dade / Pinnacle) report a class average as a letter on a 4.0 scale ("B 2.72"). That
// is shown as it came, never turned into a percent (2.72/4 would read as 68% and a wrong "D").

export type LetterLike = { letter?: string | null; points?: number | string | null };

export const hasLetter = <T extends LetterLike>(g: T): g is T & { letter: string } => !!g.letter;

/** "B 2.72" or just "B". */
export function letterText(letter: string, points?: number | string | null): string {
  const p = points === null || points === undefined || points === "" ? null : Number(points);
  return p === null || Number.isNaN(p) ? letter : `${letter} ${p.toFixed(2)}`;
}

/** Reads "(B, 2.72)" out of a title; used to repair averages that were imported before letters existed. */
export function letterFromTitle(title: string): { letter: string; points: number } | null {
  const m = /\(([A-Fa-f][+-]?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)\)/.exec(title);
  if (!m) return null;
  const points = Number(m[2]);
  return points <= 10 ? { letter: m[1].toUpperCase(), points } : null;
}

export type Headline = { kind: "letter"; letter: string; points: number | null } | { kind: "percent"; percent: number; letter: string };

/** What to show big for a class: its newest letter grade if it has one, else the points-based percent. */
export function classHeadline(grades: (GradeLike & LetterLike & { posted_at?: string })[]): Headline | null {
  const lettered = grades.filter(hasLetter).sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
  if (lettered.length) {
    const g = lettered[0];
    return { kind: "letter", letter: g.letter, points: g.points == null || g.points === "" ? null : Number(g.points) };
  }
  const avg = classAverage(grades);
  return avg === null ? null : { kind: "percent", percent: avg, letter: letterFor(avg) };
}

// Quarters and school years. A school year runs August to July and is written "2026-2027".

export const TERMS = ["q1", "q2", "q3", "q4", "s1", "s2", "final"] as const;
export type Term = (typeof TERMS)[number];
/** The chips on the Grades screen (semesters still count under "All"). */
export const TERM_CHIPS: Term[] = ["q1", "q2", "q3", "q4", "final"];
export const TERM_LABEL: Record<Term, string> = { q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4", s1: "S1", s2: "S2", final: "Final" };
export const isTerm = (v: unknown): v is Term => typeof v === "string" && (TERMS as readonly string[]).includes(v);
export const isSchoolYear = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{4}$/.test(v);

/** "2026-2027" for any day from August 2026 to July 2027. */
export function currentSchoolYear(now: Date, tz: string): string {
  const w = instantToWall(now, tz);
  const start = w.m >= 8 ? w.y : w.y - 1;
  return `${start}-${start + 1}`;
}

type Dated = { school_year?: string | null };

/** Which year something counts in: its own, else its class's, else this year (nothing is lost for lack of a label). */
export const yearOf = (own: Dated | null | undefined, course: Dated | null | undefined, current: string): string => own?.school_year || course?.school_year || current;

export const isPastYear = (year: string, current: string) => year < current;

type TermGrade = GradeLike & LetterLike & { term?: string | null; posted_at?: string };

/** The grade shown for one quarter: that quarter's letter, else its percent. Null when it has no grades. */
export function termHeadline(grades: TermGrade[], term: Term | "all"): Headline | null {
  return classHeadline(term === "all" ? grades : grades.filter((g) => g.term === term));
}

/** Short text for a small chip: "B", "A-", "87%". */
export function shortGrade(h: Headline | null): string | null {
  return h === null ? null : h.kind === "letter" ? h.letter : `${h.percent}%`;
}

/** The quarters that have a grade, in order, e.g. [Q1 B, Q2 A] - for "B → A". */
export function trend(grades: TermGrade[]): { term: Term; text: string }[] {
  const out: { term: Term; text: string }[] = [];
  for (const term of TERM_CHIPS) {
    const text = shortGrade(termHeadline(grades, term));
    if (text) out.push({ term, text });
  }
  return out;
}

/** The quarter to open on: the latest one that has a grade, else "all". */
export function defaultTerm(grades: TermGrade[]): Term | "all" {
  const have = trend(grades);
  return have.length ? have[have.length - 1].term : "all";
}

/** The quarter it is now, by the usual school calendar (Aug-mid Oct, mid Oct-Dec, Jan-mid Mar, mid Mar-Jul). */
export function currentTerm(now: Date, tz: string): Term {
  const w = instantToWall(now, tz);
  const md = w.m * 100 + w.d;
  if (md >= 801 && md <= 1015) return "q1";
  if (md > 1015) return "q2";
  if (md <= 315) return "q3";
  return md <= 731 ? "q4" : "q1";
}

/** Grade points on the 4.0 scale for the letters a person can tap (A, A-, B+ ...). */
export const LETTER_POINTS: Record<string, number> = {
  A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7, F: 0,
};

/** How good a grade is on a 0-100 scale, for rings and "up or down" arrows. Null when it cannot be told. */
export function gradeValue(g: { score: number; out_of: number; letter?: string | null; points?: number | string | null }): number | null {
  if (g.letter) {
    const p = g.points === null || g.points === undefined || g.points === "" ? LETTER_POINTS[g.letter.toUpperCase()] : Number(g.points);
    return p === undefined || Number.isNaN(p) ? null : Math.round((p / 4) * 1000) / 10;
  }
  return g.out_of > 0 ? Math.round((g.score / g.out_of) * 1000) / 10 : null;
}

/** Reads what a person typed as a score: "18/20", "92", "92%" or a letter "B+". */
export type ParsedScore = { score: number; outOf: number; letter: string | null };
export function parseScoreText(text: string): ParsedScore | null {
  const s = text.trim().replace(/\s+/g, "");
  if (!s) return null;
  const letter = /^([A-Fa-f])([+-]?)$/.exec(s);
  if (letter) {
    const l = `${letter[1].toUpperCase()}${letter[2]}`;
    return l in LETTER_POINTS ? { score: LETTER_POINTS[l], outOf: 4, letter: l } : null;
  }
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const [score, outOf] = [Number(frac[1]), Number(frac[2])];
    return outOf > 0 && score <= 1_000_000 && outOf <= 1_000_000 ? { score, outOf, letter: null } : null;
  }
  const pct = /^(\d+(?:\.\d+)?)%?$/.exec(s);
  if (pct) return Number(pct[1]) <= 1000 ? { score: Number(pct[1]), outOf: 100, letter: null } : null;
  return null;
}
