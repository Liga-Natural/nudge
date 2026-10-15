export type HealthInput = {
  /** null when the database answered; otherwise what went wrong. */
  databaseError: string | null;
  /** When the reminder clock last wrote to its log, or null if it never has. */
  lastClockRun: Date | null;
  now: Date;
};

export type HealthVerdict = { ok: boolean; problems: { subject: string; text: string }[] };

/** Decides whether the owner needs an email. Pure, so it is easy to test. */
export function judgeHealth({ databaseError, lastClockRun, now }: HealthInput): HealthVerdict {
  if (databaseError) {
    return {
      ok: false,
      problems: [
        {
          subject: "Nudge's database is not answering",
          text:
            "Nudge's database is paused, restore it in the Supabase dashboard.\n\n" +
            "Until it is back, reminders cannot be sent. Open supabase.com/dashboard, pick the nudge project and press Restore.\n\n" +
            `What the check saw: ${databaseError}`,
        },
      ],
    };
  }
  if (lastClockRun) {
    const minutes = (now.getTime() - lastClockRun.getTime()) / 60000;
    if (minutes > 15) {
      return {
        ok: false,
        problems: [
          {
            subject: "Nudge's reminder clock has stopped",
            text:
              `The reminder clock last ran ${Math.round(minutes)} minutes ago. Reminders may be late until it runs again.\n\n` +
              "Check Supabase > Integrations > Cron for the nudge-dispatch job, and Vercel for a failing /api/dispatch.",
          },
        ],
      };
    }
  }
  return { ok: true, problems: [] };
}
