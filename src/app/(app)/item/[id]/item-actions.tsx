"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteItem, markDone, markSkipped, reopenOccurrence, snoozeOccurrence } from "@/app/actions";
import { SnoozeSheet, type SnoozeOption } from "@/components/snooze-sheet";
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";

export function ItemActions({
  occId,
  status,
  recurring,
  itemId,
  habit = false,
}: {
  occId: string | null;
  status: string;
  recurring: boolean;
  itemId: string;
  habit?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: Key | "setup" }>, after?: () => void) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (!r.ok) return setError(r.error && r.error !== "setup" ? t(r.error) : t("common.error"));
      if (after) after();
      else router.refresh();
    });

  const open = status === "open";
  return (
    <section className="flex flex-col gap-3" aria-label={t("action.done")}>
      {occId && open && (
        <>
          <button className="btn-primary" disabled={pending} onClick={() => run(() => markDone(occId))}>
            ✓ {t("action.done")}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-quiet" disabled={pending} onClick={() => setSheet(true)}>
              ⏰ {t("action.snooze")}
            </button>
            <button className="btn-quiet" disabled={pending} onClick={() => run(() => markSkipped(occId))}>
              {habit ? t("habits.skipToday") : t("action.skip")}
            </button>
          </div>
        </>
      )}
      {occId && !open && (
        <button className="btn-quiet w-full" disabled={pending} onClick={() => run(() => reopenOccurrence(occId))}>
          {t("action.reopen")}
        </button>
      )}

      {!confirm ? (
        <button className="btn-quiet w-full text-late-ink" onClick={() => setConfirm(true)}>
          {recurring ? t("item.deleteSeries") : t("action.delete")}
        </button>
      ) : (
        <div className="card flex flex-col gap-2 p-4" role="alertdialog" aria-label={t("item.confirmDelete")}>
          <p className="font-semibold">{t("item.confirmDelete")}</p>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-quiet" onClick={() => setConfirm(false)}>
              {t("action.cancel")}
            </button>
            <button className="btn-quiet border-late-ink text-late-ink" disabled={pending} onClick={() => run(() => deleteItem(itemId), () => router.push("/"))}>
              {t("action.delete")}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
      <SnoozeSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onPick={(o: SnoozeOption) => {
          setSheet(false);
          if (occId) run(() => snoozeOccurrence(occId, o));
        }}
      />
    </section>
  );
}
