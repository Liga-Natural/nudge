import { translate, type Lang } from "@/lib/i18n";

const FILES = [
  "0001_push_subscriptions.sql",
  "0002_grant_push_subscriptions.sql",
  "0003_core_tables.sql",
  "0004_reminder_clock.sql",
  "0005_clock_schedule.sql (see NIGHT_LOG.md first)",
  "0006_payments_school_feeds.sql (only for Payments, School, Updates and calendar feeds)",
];

// Shown instead of the app until the new SQL has been run, so nothing crashes.
export function SetupNeeded({ lang }: { lang: Lang }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
      <h1 className="text-[2rem] font-extrabold leading-tight">{translate(lang, "setup.title")}</h1>
      <p className="text-muted">{translate(lang, "setup.body")}</p>
      <ol className="card flex list-decimal flex-col gap-2 p-5 pl-9 font-mono text-sm">
        {FILES.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ol>
      <p className="text-muted">{translate(lang, "setup.after")}</p>
    </main>
  );
}
