"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveItem, markDone, markSkipped, reopenOccurrence, restoreItem, snoozeOccurrence, unsnoozeOccurrence } from "@/app/actions";
import { SnoozeSheet, type SnoozeOption } from "@/components/snooze-sheet";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";

export function ItemActions({
  occId,
  status,
  recurring,
  itemId,
  title,
  habit = false,
}: {
  occId: string | null;
  status: string;
  recurring: boolean;
  itemId: string;
  title: string;
  habit?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const [sheet, setSheet] = useState(false);
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

  /** Runs an action, then offers Undo for a few seconds. */
  const withUndo = (fn: () => Promise<{ ok: boolean; error?: Key | "setup" }>, message: string, undo: () => Promise<unknown>, after?: () => void) =>
    run(fn, () => {
      toast({
        message,
        undo: async () => {
          await undo();
          router.refresh();
        },
      });
      if (after) after();
      else router.refresh();
    });

  const open = status === "open";
  return (
    <section className="flex flex-col gap-3" aria-label={t("action.done")}>
      {occId && open && (
        <>
          <button className="btn-primary" disabled={pending} onClick={() => withUndo(() => markDone(occId), t("toast.done", { title }), () => reopenOccurrence(occId))}>
            ✓ {t("action.done")}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-quiet" disabled={pending} onClick={() => setSheet(true)}>
              ⏰ {t("action.snooze")}
            </button>
            <button className="btn-quiet" disabled={pending} onClick={() => withUndo(() => markSkipped(occId), t("toast.skipped", { title }), () => reopenOccurrence(occId))}>
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

      <button
        className="btn-quiet w-full text-late-ink"
        disabled={pending}
        onClick={() =>
          withUndo(
            () => archiveItem(itemId),
            t("toast.deleted", { title }),
            () => restoreItem(itemId),
            () => router.push("/"),
          )
        }
      >
        {recurring ? t("item.deleteSeries") : t("action.delete")}
      </button>
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
          if (occId) withUndo(() => snoozeOccurrence(occId, o), t("toast.snoozed", { title }), () => unsnoozeOccurrence(occId));
        }}
      />
    </section>
  );
}
