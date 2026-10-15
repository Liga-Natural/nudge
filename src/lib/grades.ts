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
