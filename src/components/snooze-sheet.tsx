"use client";

import { useT } from "@/lib/i18n/client";
import { Sheet } from "./sheet";

export type SnoozeOption = "10" | "60" | "180" | "tonight" | "tomorrow";

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
  const options: [SnoozeOption, string, string][] = [
    ["10", "⏱️", t("snooze.10")],
    ["60", "🕐", t("snooze.60")],
    ["tonight", "🌙", t("snooze.tonight")],
    ["tomorrow", "🌅", t("snooze.tomorrow")],
  ];
  return (
    <Sheet open={open} onClose={onClose} title={t("snooze.title")}>
      <div className="grid grid-cols-2 gap-3">
        {options.map(([value, emoji, label]) => (
          <button key={value} className="tile" onClick={() => onPick(value)}>
            <span aria-hidden className="text-3xl">
              {emoji}
            </span>
            {label}
          </button>
        ))}
      </div>
      <button className="btn-quiet mt-3 w-full" onClick={onClose}>
        {t("action.cancel")}
      </button>
    </Sheet>
  );
}
