"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/client";

export type SnoozeOption = "10" | "60" | "180" | "tomorrow";

export function SnoozeSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (option: SnoozeOption) => void;
}) {
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const options: [SnoozeOption, string][] = [
    ["10", t("snooze.10")],
    ["60", t("snooze.60")],
    ["180", t("snooze.180")],
    ["tomorrow", t("snooze.tomorrow")],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("snooze.title")}
        className="slide-in w-full max-w-md rounded-t-[28px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-xl font-bold">{t("snooze.title")}</h2>
        <div className="flex flex-col gap-2">
          {options.map(([value, label], i) => (
            <button
              key={value}
              ref={i === 0 ? first : undefined}
              className="btn-quiet w-full justify-start text-left"
              onClick={() => onPick(value)}
            >
              {label}
            </button>
          ))}
          <button className="btn-quiet mt-1 w-full" onClick={onClose}>
            {t("action.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
