import { localDateKey } from "./time";

// Habit streaks, worked out from the habit's own days. Rules:
//   - a day you marked Done adds 1 to the streak;
//   - a day you chose "Skip today" neither adds nor breaks it;
//   - a day that passed with neither (still open) breaks it;
//   - today does not break it until the day is over.

export type HabitDay = { dueAt: string; status: "open" | "done" | "skipped" };

export type Streak = { current: number; best: number; doneToday: boolean; skippedToday: boolean };

export function computeStreak(days: HabitDay[], now: Date, tz: string): Streak {
  const today = localDateKey(now, tz);
  // One entry per calendar day (a day with two entries counts as done if any is done).
  const byDay = new Map<string, "open" | "done" | "skipped">();
  for (const d of days) {
    const key = localDateKey(new Date(d.dueAt), tz);
    if (key > today) continue; // the future has not happened yet
    const seen = byDay.get(key);
    const rank = { done: 3, skipped: 2, open: 1 } as const;
    if (!seen || rank[d.status] > rank[seen]) byDay.set(key, d.status);
  }
  const keys = [...byDay.keys()].sort();
  let best = 0;
  let run = 0;
  for (const k of keys) {
    const st = byDay.get(k)!;
    if (st === "done") {
      run++;
      best = Math.max(best, run);
    } else if (st === "open" && k < today) {
      run = 0;
    } // skipped days, and today while it is still open, leave the run as it is
  }
  // The current streak is the run as it stands at the end of the list.
  let current = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    const st = byDay.get(k)!;
    if (st === "done") current++;
    else if (st === "skipped") continue;
    else if (k === today) continue; // today is not over yet
    else break;
  }
  return { current, best, doneToday: byDay.get(today) === "done", skippedToday: byDay.get(today) === "skipped" };
}
