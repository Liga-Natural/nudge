"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markDone, snoozeOccurrence } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";

type Option = "10" | "60" | "tonight" | "tomorrow";

/**
 * Opened by tapping a notification (an iPhone cannot show buttons on the notification itself):
 * Done and Snooze sit on top of the item, one tap each.
 */
export function QuickActions({ occId }: { occId: string }) {
  const t = useT();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: Key | "setup" }>, doneText: string) {
    setMessage("");
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMessage(r.error && r.error !== "setup" ? t(r.error) : t("common.error"));
      setFinished(true);
      setMessage(doneText);
      router.refresh();
    });
  }

  const snoozeOptions: [Option, Key][] = [
    ["10", "snooze.10"],
    ["60", "snooze.60"],
    ["tonight", "snooze.tonight"],
    ["tomorrow", "snooze.tomorrow"],
  ];

  return (
    <section aria-label={t("quick.title")} className="card flex flex-col gap-3 border-2 border-accent p-4">
      <h2 className="text-lg font-bold">{t("quick.title")}</h2>
      {!finished && (
        <>
          <button className="btn-primary" disabled={pending} onClick={() => run(() => markDone(occId), t("quick.done"))}>
            ✓ {t("action.done")}
          </button>
          <div className="grid grid-cols-2 gap-2">
            {snoozeOptions.map(([o, label]) => (
              <button key={o} className="btn-quiet" disabled={pending} onClick={() => run(() => snoozeOccurrence(occId, o), t("quick.snoozed"))}>
                ⏰ {t(label)}
              </button>
            ))}
          </div>
        </>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </section>
  );
}
