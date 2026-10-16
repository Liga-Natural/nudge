"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { addLocalDays, formatDay, localDateKey } from "@/lib/time";
import { Sheet } from "./sheet";

/** "Move to...": tomorrow, in 3 days, next week, or a day you pick. Calls back with YYYY-MM-DD. */
export function RescheduleSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (day: string, label: string) => void;
}) {
  const { t, tz, lang } = useI18n();
  const [custom, setCustom] = useState("");
  const options = () => {
    const now = new Date();
    const mk = (n: number, emoji: string, label: string): [string, string, string] => [localDateKey(addLocalDays(now, tz, n), tz), emoji, label];
    return [mk(1, "🌅", t("reschedule.tomorrow")), mk(3, "🗓️", t("reschedule.in3")), mk(7, "📆", t("reschedule.nextWeek"))];
  };
  const labelFor = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return formatDay(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", lang);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("reschedule.title")}>
      <div className="grid grid-cols-3 gap-3">
        {open &&
          options().map(([day, emoji, label]) => (
            <button key={day} className="tile !min-h-[96px]" onClick={() => onPick(day, label)}>
              <span aria-hidden className="text-2xl">
                {emoji}
              </span>
              <span className="text-sm">{label}</span>
            </button>
          ))}
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="move-date" className="mb-1 block text-sm font-semibold text-muted">
            {t("reschedule.pick")}
          </label>
          <input id="move-date" type="date" className="field" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <button className="btn-quiet flex-none" disabled={!custom} onClick={() => onPick(custom, labelFor(custom))}>
          {t("reschedule.go")}
        </button>
      </div>
      <button className="btn-quiet mt-3 w-full" onClick={onClose}>
        {t("action.cancel")}
      </button>
    </Sheet>
  );
}
