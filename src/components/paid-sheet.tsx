"use client";

import { useState, useTransition } from "react";
import { markPaid } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import { localDateKey } from "@/lib/time";
import { Sheet } from "./sheet";

/** "Mark paid": the amount (filled in) and the day it was paid. Used on Payments and on Today. */
export function PaidSheet({
  open,
  onClose,
  occId,
  title,
  amountCents,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  occId: string;
  title: string;
  amountCents: number | null;
  onPaid: () => void;
}) {
  const { t, tz } = useI18n();
  const [amount, setAmount] = useState(amountCents != null ? (amountCents / 100).toFixed(2) : "");
  const [date, setDate] = useState(() => localDateKey(new Date(), tz));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount.replace(/,/g, "")) * 100);
    if (Number.isNaN(cents) || cents < 0) return setError(t("common.error"));
    start(async () => {
      const r = await markPaid(occId, cents, date);
      if (r.ok) {
        onClose();
        onPaid();
      } else setError(t("common.error"));
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("payments.markPaid")}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="-mt-2 text-muted">{title}</p>
        <div>
          <label htmlFor="paid-amount" className="mb-1 block text-sm font-semibold text-muted">
            {t("payments.amountPaid")}
          </label>
          <input id="paid-amount" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
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
        <button type="button" className="btn-quiet w-full" onClick={onClose}>
          {t("action.cancel")}
        </button>
      </form>
    </Sheet>
  );
}
