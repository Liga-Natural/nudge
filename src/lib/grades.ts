// Grades: a class average is total points earned over total points possible (so a 5/5 quiz does not
// count as much as a 90/100 test). Scores are shown to one decimal, never rounded up to look better.

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
