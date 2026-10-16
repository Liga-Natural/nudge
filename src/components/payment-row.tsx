"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { AgendaEntry } from "@/lib/types";
import { PaidSheet } from "./paid-sheet";
import { useToast } from "./ui/toast";
import { VTLink } from "./ui/vt-link";

/** A bill: the amount up front, when it is due, and one Paid button (a Joker link can sit next to it later). */
export function PaymentRow({ entry, timeLabel, money, late = false, index = 0 }: { entry: AgendaEntry; timeLabel: string; money: string | null; today?: string; late?: boolean; index?: number }) {
  const t = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  if (gone) return null;
  return (
    <li className={`stagger list-none ${leaving ? "row-away" : ""}`} style={{ ["--i" as string]: index }}>
      <div className={`card flex items-center gap-3 p-3 ${late ? "bg-late-bg" : ""}`}>
        <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-pay text-xl">
          💳
        </span>
        <VTLink href={`/item/${entry.itemId}`} className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{entry.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className={late ? "font-semibold text-late-ink" : ""}>{timeLabel}</span>
            {entry.autopay && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-ink">{t("payments.autopayChip")}</span>}
          </span>
        </VTLink>
        {money && <span className="flex-none text-xl font-extrabold tabular-nums">{money}</span>}
        <button className="btn-quiet flex-none" onClick={() => setOpen(true)} aria-label={`${t("payments.paid")}: ${entry.title}`}>
          ✓ {t("payments.paid")}
        </button>
      </div>
      <PaidSheet
        open={open}
        onClose={() => setOpen(false)}
        occId={entry.occId}
        title={entry.title}
        amountCents={entry.amountCents}
        onPaid={() => {
          setLeaving(true);
          setTimeout(() => setGone(true), 400);
          toast({ message: t("toast.paid", { title: entry.title }) });
        }}
      />
    </li>
  );
}
