"use client";

import { useState, useTransition } from "react";
import type { Result } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import type { ItemInput } from "@/lib/item-input";
import type { ItemType } from "@/lib/parser";
import { describeReminder } from "@/lib/reminder-labels";
import { describeRule, parseRule, ruleToString } from "@/lib/recurrence";
import { defaultReminders, REMINDER_CHOICES, type ReminderSpec } from "@/lib/reminders";
import { TYPE_EMOJI, type Course, type Space } from "@/lib/types";

const REPEATS: { key: string; rrule: string | null; label: Key }[] = [
  { key: "none", rrule: null, label: "repeat.none" },
  { key: "daily", rrule: "FREQ=DAILY", label: "repeat.daily" },
  { key: "weekly", rrule: "FREQ=WEEKLY", label: "repeat.weekly" },
  { key: "monthly", rrule: "FREQ=MONTHLY", label: "repeat.monthly" },
  { key: "yearly", rrule: "FREQ=YEARLY", label: "repeat.yearly" },
];

const START_EARLY: ReminderSpec = { daysBefore: 3, atTime: "09:00" };
const same = (a: ReminderSpec, b: ReminderSpec) => JSON.stringify(a) === JSON.stringify(b);
const WORK_KINDS = ["game_day", "registration", "sponsor", "posting"] as const;
const RENEWAL_DAYS = [3, 7, 14, 30, 60];
const WITH_PLACE: ItemType[] = ["event", "birthday", "work"];
// Monday first, as a week reads in the US.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export type FormValues = Omit<ItemInput, "spaceId"> & { spaceId: string | null };

const daysBeforeOf = (reminders: ReminderSpec[]) =>
  Math.max(0, ...reminders.map((r) => ("daysBefore" in r ? r.daysBefore : 0))) || 14;

export function ItemForm({
  initial,
  spaces,
  courses = [],
  enabledTypes,
  showSpaces,
  submitLabel,
  warnings = [],
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  spaces: Space[];
  courses?: Course[];
  /** The kinds of reminder that are switched on. The item's own kind is always shown. */
  enabledTypes: ItemType[];
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
  const [autopay, setAutopay] = useState(initial.autopay);
  const [courseId, setCourseId] = useState<string | null>(initial.courseId);
  const [reminders, setReminders] = useState<ReminderSpec[]>(initial.reminders);
  const [location, setLocation] = useState(initial.location ?? "");
  const [subtype, setSubtype] = useState<(typeof WORK_KINDS)[number] | null>(initial.subtype);
  const [checklist, setChecklist] = useState<{ text: string; done: boolean }[]>(initial.checklist);
  const [newCheck, setNewCheck] = useState("");
  const [renewalDays, setRenewalDays] = useState(daysBeforeOf(initial.reminders));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const types = enabledTypes.includes(type) ? enabledTypes : [...enabledTypes, type];
  const presetRule = REPEATS.find((r) => r.rrule === rrule);
  const customRule = rrule && !presetRule ? parseRule(rrule) : null;
  const presets = REMINDER_CHOICES.map((c) => c.spec);
  const extras = reminders.filter((r) => !presets.some((p) => same(p, r)));
  const weekdayFmt = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "short", timeZone: "UTC" });
  const parsedRule = rrule ? parseRule(rrule) : null;
  const pickedDays = parsedRule?.freq === "WEEKLY" ? (parsedRule.byDay ?? []) : parsedRule?.freq === "DAILY" ? WEEK : [];

  function toggle(spec: ReminderSpec) {
    setReminders((cur) => (cur.some((r) => same(r, spec)) ? cur.filter((r) => !same(r, spec)) : [...cur, spec]));
  }

  function changeType(next: ItemType) {
    // If the reminders are still the ones the old kind came with, swap in the new kind's own.
    const wasDefault = same2(reminders, defaultReminders(type, allDay, "on_time", subtype));
    setType(next);
    if (next === "birthday" && !rrule && date) setRrule("FREQ=YEARLY");
    if (next === "work" && !subtype) setSubtype("game_day");
    if (date && (wasDefault || reminders.length === 0)) {
      const fresh = defaultReminders(next, allDay, "on_time", next === "work" ? (subtype ?? "game_day") : null);
      setReminders(fresh);
      if (next === "renewal") setRenewalDays(daysBeforeOf(fresh));
    }
  }

  function pickRenewalDays(n: number) {
    setRenewalDays(n);
    setReminders([{ daysBefore: n, atTime: "09:00" }, { daysBefore: 0, atTime: "09:00" }]);
  }

  function pickWeekdays(days: number[]) {
    if (days.length === 0) return setRrule(null);
    if (days.length === 7) return setRrule("FREQ=DAILY");
    setRrule(ruleToString({ freq: "WEEKLY", interval: 1, byDay: [...days].sort((a, b) => a - b) }));
  }

  function addCheck() {
    const text = newCheck.trim();
    if (!text) return;
    setChecklist((cur) => (cur.length >= 40 ? cur : [...cur, { text: text.slice(0, 200), done: false }]));
    setNewCheck("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError(t("add.titleRequired"));
    const cents = amount.trim() === "" ? null : Math.round(parseFloat(amount.replace(/,/g, "")) * 100);
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return setError(t("common.error"));
    const dueLocal = date ? (allDay ? date : `${date}T${time || "09:00"}`) : null;
    // A half-typed checklist line is not lost.
    const pendingCheck = newCheck.trim();
    const finalChecklist = pendingCheck ? [...checklist, { text: pendingCheck.slice(0, 200), done: false }] : checklist;
    start(async () => {
      const r = await onSubmit({
        title: title.trim(),
        type,
        dueLocal,
        allDay,
        amountCents: cents,
        rrule: date ? rrule : null,
        spaceId,
        autopay: type === "payment" ? autopay : false,
        courseId: type === "homework" ? courseId : null,
        notes: notes.trim() || null,
        location: WITH_PLACE.includes(type) && location.trim() ? location.trim() : null,
        subtype: type === "work" ? subtype : null,
        checklist: finalChecklist,
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
          {types.map((ty) => (
            <button key={ty} type="button" aria-pressed={type === ty} className={chip(type === ty)} onClick={() => changeType(ty)}>
              <span aria-hidden>{TYPE_EMOJI[ty]}</span> {t(`type.${ty}` as Key)}
            </button>
          ))}
        </div>
      </fieldset>

      {type === "work" && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-muted">{t("form.workKind")}</legend>
          <div className="flex flex-wrap gap-2">
            {WORK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={subtype === k}
                className={chip(subtype === k)}
                onClick={() => {
                  setSubtype(k);
                  if (date && same2(reminders, defaultReminders("work", allDay, "on_time", subtype))) setReminders(defaultReminders("work", allDay, "on_time", k));
                }}
              >
                {t(`work.${k}` as Key)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="f-date" className="mb-1 block text-sm font-semibold text-muted">
            {type === "renewal" ? t("form.expires") : t("add.field.date")}
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

      {WITH_PLACE.includes(type) && (
        <div>
          <label htmlFor="f-place" className="mb-1 block text-sm font-semibold text-muted">
            {t("form.location")} <span className="font-normal">({t("common.optional")})</span>
          </label>
          <input id="f-place" className="field" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </div>
      )}

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

      {(type === "habit" || type === "work") && date && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-muted">{t("form.repeatOn")}</legend>
          <div className="flex flex-wrap gap-2">
            {WEEK.map((d) => {
              const on = pickedDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={`${chip(on)} !px-3`}
                  onClick={() => pickWeekdays(on ? pickedDays.filter((x) => x !== d) : [...pickedDays, d])}
                >
                  {weekdayFmt.format(new Date(Date.UTC(2024, 0, 7 + d)))}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {type === "renewal" && date && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-muted">{t("form.renewalDays")}</legend>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...RENEWAL_DAYS, renewalDays])]
              .sort((a, b) => a - b)
              .map((n) => (
                <button key={n} type="button" aria-pressed={renewalDays === n} className={chip(renewalDays === n)} onClick={() => pickRenewalDays(n)}>
                  {t("form.daysBefore", { n })}
                </button>
              ))}
          </div>
        </fieldset>
      )}

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
            {type === "homework" && (
              <button type="button" aria-pressed={reminders.some((r) => same(r, START_EARLY))} className={chip(reminders.some((r) => same(r, START_EARLY)))} onClick={() => toggle(START_EARLY)}>
                {t("form.startEarly")}
              </button>
            )}
            {extras.filter((r) => !(type === "homework" && same(r, START_EARLY))).map((r) => (
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

      {type === "payment" && (
        <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[#e8590c]" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          {t("form.autopay")}
        </label>
      )}

      {type === "homework" && courses.length > 0 && (
        <div>
          <label htmlFor="f-course" className="mb-1 block text-sm font-semibold text-muted">
            {t("form.course")}
          </label>
          <select id="f-course" className="field" value={courseId ?? ""} onChange={(e) => setCourseId(e.target.value || null)}>
            <option value="">{t("school.noCourse")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
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

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-muted">
          {t("form.checklist")} <span className="font-normal">({t("common.optional")})</span>
        </legend>
        {checklist.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1">
            {checklist.map((c, i) => (
              <li key={`${i}-${c.text}`} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-1">
                <span className="min-w-0 truncate">{c.text}</span>
                <button
                  type="button"
                  className="btn-quiet flex-none"
                  aria-label={`${t("action.delete")}: ${c.text}`}
                  onClick={() => setChecklist((cur) => cur.filter((_, n) => n !== i))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor="f-check" className="sr-only">
            {t("form.checklist.placeholder")}
          </label>
          <input
            id="f-check"
            className="field"
            placeholder={t("form.checklist.placeholder")}
            value={newCheck}
            maxLength={200}
            onChange={(e) => setNewCheck(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCheck();
              }
            }}
          />
          <button type="button" className="btn-quiet flex-none" onClick={addCheck}>
            {t("form.checklist.add")}
          </button>
        </div>
      </fieldset>

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

function same2(a: ReminderSpec[], b: ReminderSpec[]) {
  const key = (r: ReminderSpec) => JSON.stringify(r);
  return a.length === b.length && a.every((x) => b.some((y) => key(x) === key(y)));
}
