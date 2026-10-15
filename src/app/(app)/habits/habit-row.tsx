"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markDone, markSkipped } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { Streak } from "@/lib/streak";

type Status = "open" | "done" | "skipped" | null;

/** One habit: its streak, and Done / Skip today. Taps show at once and roll back with a message if they fail. */
export function HabitRow({ itemId, title, occId, todayStatus, streak }: { itemId: string; title: string; occId: string | null; todayStatus: Status; streak: Streak }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(todayStatus);
  const [current, setCurrent] = useState(streak.current);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function act(kind: "done" | "skipped") {
    if (!occId) return;
    const before = { status, current };
    setStatus(kind);
    // Done adds a day to the streak; skipping leaves it as it is.
    if (kind === "done") setCurrent(current + 1);
    setError("");
    start(async () => {
      const r = await (kind === "done" ? markDone(occId) : markSkipped(occId));
      if (!r.ok) {
        setStatus(before.status);
        setCurrent(before.current);
        setError(r.error === "setup" ? t("setup.title") : t(r.error));
      } else router.refresh();
    });
  }

  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/item/${itemId}`} className="min-w-0 font-bold">
          <span aria-hidden>🌱 </span>
          {title}
        </Link>
        <span className="flex-none rounded-full bg-habit px-3 py-1 text-sm font-semibold" aria-label={t("habits.streak", { n: current })}>
          🔥 {current}
        </span>
      </div>
      <p className="text-sm text-muted">{t("habits.best", { n: Math.max(streak.best, current) })}</p>
      {!occId ? (
        <p className="text-sm text-muted">{t("habits.notToday")}</p>
      ) : status === "done" ? (
        <p className="font-semibold">✓ {t("habits.doneToday")}</p>
      ) : status === "skipped" ? (
        <p className="font-semibold">{t("habits.skippedToday")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary" disabled={pending} aria-label={`${t("action.done")}: ${title}`} onClick={() => act("done")}>
            ✓ {t("action.done")}
          </button>
          <button className="btn-quiet" disabled={pending} aria-label={`${t("habits.skipToday")}: ${title}`} onClick={() => act("skipped")}>
            {t("habits.skipToday")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
    </li>
  );
}
