"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { markPaid } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { AgendaEntry } from "@/lib/types";

export function PaymentRow({ entry, timeLabel, money, today, late = false }: { entry: AgendaEntry; timeLabel: string; money: string | null; today: string; late?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [amount, setAmount] = useState(entry.amountCents != null ? (entry.amountCents / 100).toFixed(2) : "");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount.replace(/,/g, "")) * 100);
    if (Number.isNaN(cents) || cents < 0) return setError(t("common.error"));
    start(async () => {
      const r = await markPaid(entry.occId, cents, date);
      if (r.ok) {
        setOpen(false);
        setGone(true);
      } else setError(t("common.error"));
    });
  }

  if (gone) return null;
  return (
    <li className="slide-in list-none">
      <div className={`card flex items-center gap-3 p-3 ${late ? "bg-late-bg" : ""}`}>
        <Link href={`/item/${entry.itemId}`} className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{entry.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className={late ? "font-semibold text-late-ink" : ""}>{timeLabel}</span>
            {entry.autopay && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-ink">{t("payments.autopayChip")}</span>}
          </span>
        </Link>
        {money && <span className="flex-none font-bold">{money}</span>}
        <button className="btn-quiet flex-none" onClick={() => setOpen(true)} aria-label={`${t("payments.paid")}: ${entry.title}`}>
          ✓ {t("payments.paid")}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={() => setOpen(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label={t("payments.markPaid")}
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
            className="slide-in flex w-full max-w-md flex-col gap-3 rounded-t-[28px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            <h2 className="text-xl font-bold">{t("payments.markPaid")}</h2>
            <p className="text-muted">{entry.title}</p>
            <div>
              <label htmlFor="paid-amount" className="mb-1 block text-sm font-semibold text-muted">
                {t("payments.amountPaid")}
              </label>
              <input id="paid-amount" ref={first} className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="paid-date" className="mb-1 block text-sm font-semibold text-muted">
                {t("payments.paidOn")}
              </label>
              <input id="paid-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            {error && (
              <p role="alert" className="text-sm font-semibold text-late-ink">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={pending}>
              {t("payments.save")}
            </button>
            <button type="button" className="btn-quiet w-full" onClick={() => setOpen(false)}>
              {t("action.cancel")}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
