"use client";

import { useState, useTransition } from "react";
import type { Result } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import type { ItemInput } from "@/lib/item-input";
import type { ItemType } from "@/lib/parser";
import { describeReminder } from "@/lib/reminder-labels";
import { describeRule, parseRule } from "@/lib/recurrence";
import { REMINDER_CHOICES, type ReminderSpec } from "@/lib/reminders";
import { ITEM_TYPES, TYPE_EMOJI, type Space } from "@/lib/types";

const REPEATS: { key: string; rrule: string | null; label: Key }[] = [
  { key: "none", rrule: null, label: "repeat.none" },
  { key: "daily", rrule: "FREQ=DAILY", label: "repeat.daily" },
  { key: "weekly", rrule: "FREQ=WEEKLY", label: "repeat.weekly" },
  { key: "monthly", rrule: "FREQ=MONTHLY", label: "repeat.monthly" },
  { key: "yearly", rrule: "FREQ=YEARLY", label: "repeat.yearly" },
];

const same = (a: ReminderSpec, b: ReminderSpec) => JSON.stringify(a) === JSON.stringify(b);

export type FormValues = Omit<ItemInput, "spaceId"> & { spaceId: string | null };

export function ItemForm({
  initial,
  spaces,
  showSpaces,
  submitLabel,
  warnings = [],
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  spaces: Space[];
  showSpaces: boolean;
  submitLabel: string;
  warnings?: string[];
  onSubmit: (values: ItemInput) => Promise<Result<object>>;
  onCancel?: () => void;
}) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<ItemType>(initial.type);
  const [date, setDate] = useState(initial.dueLocal?.slice(0, 10) ?? "");
  const [time, setTime] = useState(initial.dueLocal?.slice(11, 16) || "09:00");
  const [allDay, setAllDay] = useState(initial.allDay);
  const [amount, setAmount] = useState(initial.amountCents != null ? (initial.amountCents / 100).toFixed(2) : "");
  const [rrule, setRrule] = useState<string | null>(initial.rrule);
  const [spaceId, setSpaceId] = useState<string | null>(initial.spaceId);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [reminders, setReminders] = useState<ReminderSpec[]>(initial.reminders);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const presetRule = REPEATS.find((r) => r.rrule === rrule);
  const customRule = rrule && !presetRule ? parseRule(rrule) : null;
  const presets = REMINDER_CHOICES.map((c) => c.spec);
  const extras = reminders.filter((r) => !presets.some((p) => same(p, r)));

  function toggle(spec: ReminderSpec) {
    setReminders((cur) => (cur.some((r) => same(r, spec)) ? cur.filter((r) => !same(r, spec)) : [...cur, spec]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError(t("add.titleRequired"));
    const cents = amount.trim() === "" ? null : Math.round(parseFloat(amount.replace(/,/g, "")) * 100);
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return setError(t("common.error"));
    const dueLocal = date ? (allDay ? date : `${date}T${time || "09:00"}`) : null;
    start(async () => {
      const r = await onSubmit({
        title: title.trim(),
        type,
        dueLocal,
        allDay,
        amountCents: cents,
        rrule: date ? rrule : null,
        spaceId,
        notes: notes.trim() || null,
        reminders: date ? reminders : [],
      });
      if (!r.ok) setError(r.error === "setup" ? t("setup.title") : t(r.error));
    });
  }

  const chip = (on: boolean) =>
    `min-h-[44px] rounded-full border px-4 text-sm font-semibold ${on ? "border-accent bg-accent-soft text-ink" : "border-line bg-white text-ink"}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {warnings.map((w) => (
        <p key={w} role="note" className="rounded-2xl bg-pkg p-3 text-sm text-ink">
          {t(`add.warn.${w}` as Key)}
        </p>
      ))}

      <div>
        <label htmlFor="f-title" className="mb-1 block text-sm font-semibold text-muted">
          {t("add.field.title")}
        </label>
        <input id="f-title" className="field" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-muted">{t("add.field.type")}</legend>
        <div className="flex flex-wrap gap-2">
          {ITEM_TYPES.map((ty) => (
            <button key={ty} type="button" aria-pressed={type === ty} className={chip(type === ty)} onClick={() => setType(ty)}>
              <span aria-hidden>{TYPE_EMOJI[ty]}</span> {t(`type.${ty}` as Key)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="f-date" className="mb-1 block text-sm font-semibold text-muted">
            {t("add.field.date")}
          </label>
          <input id="f-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="f-time" className="mb-1 block text-sm font-semibold text-muted">
            {t("add.field.time")}
          </label>
          <input id="f-time" type="time" className="field" value={time} disabled={allDay || !date} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-[#e8590c]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        {t("common.allDay")}
      </label>

      <div>
        <label htmlFor="f-amount" className="mb-1 block text-sm font-semibold text-muted">
          {t("add.field.amount")} <span className="font-normal">({t("common.optional")})</span>
        </label>
        <input id="f-amount" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>

      <div>
        <label htmlFor="f-repeat" className="mb-1 block text-sm font-semibold text-muted">
          {t("add.field.repeat")}
        </label>
        <select
          id="f-repeat"
          className="field"
          disabled={!date}
          value={presetRule ? presetRule.key : "custom"}
          onChange={(e) => {
            const found = REPEATS.find((r) => r.key === e.target.value);
            if (found) setRrule(found.rrule);
          }}
        >
          {REPEATS.map((r) => (
            <option key={r.key} value={r.key}>
              {t(r.label)}
            </option>
          ))}
          {customRule && <option value="custom">{describeRule(customRule, lang)}</option>}
        </select>
      </div>

      {date && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-muted">{t("reminder.title")}</legend>
          <div className="flex flex-wrap gap-2">
            {REMINDER_CHOICES.map((c) => {
              const on = reminders.some((r) => same(r, c.spec));
              return (
                <button key={c.key} type="button" aria-pressed={on} className={chip(on)} onClick={() => toggle(c.spec)}>
                  {describeReminder(c.spec, t, lang)}
                </button>
              );
            })}
            {extras.map((r) => (
              <button
                key={JSON.stringify(r)}
                type="button"
                aria-pressed
                className={chip(true)}
                aria-label={`${describeReminder(r, t, lang)} — ${t("action.delete")}`}
                onClick={() => toggle(r)}
              >
                {describeReminder(r, t, lang)} <span aria-hidden>✕</span>
              </button>
            ))}
          </div>
          {reminders.length === 0 && <p className="mt-2 text-sm text-muted">{t("reminder.none")}</p>}
        </fieldset>
      )}

      {showSpaces && spaces.length > 1 && (
        <div>
          <label htmlFor="f-space" className="mb-1 block text-sm font-semibold text-muted">
            {t("add.field.space")}
          </label>
          <select id="f-space" className="field" value={spaceId ?? ""} onChange={(e) => setSpaceId(e.target.value || null)}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.is_default && s.name === "Personal" ? t("space.personal") : s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="f-notes" className="mb-1 block text-sm font-semibold text-muted">
          {t("add.field.notes")} <span className="font-normal">({t("common.optional")})</span>
        </label>
        <textarea id="f-notes" className="field min-h-[88px]" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("common.loading") : submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="btn-quiet w-full" onClick={onCancel}>
          {t("action.cancel")}
        </button>
      )}
    </form>
  );
}
