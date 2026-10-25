"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCourse, createItem, deleteItem, type Result } from "@/app/actions";
import { addGrade, deleteGrade } from "@/app/actions-p3";
import { loadAddContext, type AddContext, type AddCourse } from "@/app/actions-p6";
import { Sheet } from "@/components/sheet";
import { Chip, ChipRow } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import {
  ADD_KINDS,
  buildGrade,
  buildItem,
  canSaveNow,
  dueFromChip,
  emptyDraft,
  GRADE_TYPES,
  padPress,
  pickChip,
  readScore,
  stepReady,
  STEPS,
  WEEK_ORDER,
  type AddKind,
  type Draft,
  type DueChip,
} from "@/lib/add-flows";
import { courseLook } from "@/lib/course-look";
import type { FeatureKey } from "@/lib/features";
import { TERM_CHIPS, TERM_LABEL } from "@/lib/grades";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { HW_WHERE } from "@/lib/item-input";
import { parseQuickAdd } from "@/lib/parser";
import { buildQuickInput, quickPreview } from "@/lib/quick-add";
import { formatDay, formatMoney, formatTime } from "@/lib/time";
import { TYPE_EMOJI, TYPE_FEATURE } from "@/lib/types";

const TILE_BG: Record<AddKind, string> = {
  homework: "var(--hw)",
  task: "var(--task)",
  payment: "var(--pay)",
  event: "var(--event)",
  birthday: "var(--birthday)",
  habit: "var(--habit)",
  renewal: "var(--renewal)",
  grade: "var(--ok-bg)",
};
const KIND_EMOJI = (k: AddKind) => (k === "grade" ? "📝" : TYPE_EMOJI[k]);
const HABIT_EMOJIS = ["🌱", "🏃", "💧", "📖", "🧘", "🦷", "🛏️", "🎹", "🥗", "😴", "✍️", "🐕"];
const TIME_CHIPS: [string, Key][] = [
  ["08:00", "add.time.morning"],
  ["12:00", "add.time.noon"],
  ["18:00", "add.time.evening"],
  ["21:00", "add.time.night"],
];

const BASICS: AddContext = { courses: [], types: ["task", "homework", "payment", "event"], grades: false, nudgeStyle: "on_time", spaceId: null, recent: [], again: [] };

type Props = { open: boolean; onClose: () => void; startKind?: AddKind | null; /** When the sheet was opened (ms), taken in the tap handler so dates are right without a re-render. */ openedAt: number };

/** Mounted fresh every time it opens, so it always starts clean. */
export function AddSheet({ open, onClose, startKind = null, openedAt }: Props) {
  const { t, tz, lang } = useI18n();
  const { toast } = useToast();
  const [ctx, setCtx] = useState<AddContext | null>(null);
  const [kind, setKind] = useState<AddKind | null>(startKind);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(() => (startKind ? emptyDraft(startKind, new Date(openedAt), tz) : null));
  const [nowMs, setNowMs] = useState(openedAt);
  const [quick, setQuick] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [newClass, setNewClass] = useState("");
  const [creating, setCreating] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const now = useMemo(() => new Date(nowMs || 0), [nowMs]);
  const courses: AddCourse[] = useMemo(() => ctx?.courses ?? [], [ctx]);

  // Fetch the classes and your recent kinds as the sheet opens.
  useEffect(() => {
    let live = true;
    // If it cannot be fetched, the sheet still works with the basics (no classes, no recents).
    loadAddContext()
      .then((r) => live && setCtx(r.ok ? r.context : BASICS))
      .catch(() => live && setCtx(BASICS));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => void (closing.current && clearTimeout(closing.current)), []);

  const flowCtx = useMemo(
    () => ({ nudgeStyle: ctx?.nudgeStyle ?? "on_time", spaceId: ctx?.spaceId ?? null, now, tz }),
    [ctx, now, tz],
  );

  const begin = useCallback(
    (k: AddKind, seed?: Partial<Draft>, atStep = 1) => {
      const at = new Date();
      setNowMs(at.getTime());
      setKind(k);
      setStep(atStep);
      setDraft({ ...emptyDraft(k, at, tz), ...seed });
      setError("");
      setMore(false);
    },
    [tz],
  );

  const featureOn = useCallback((f: FeatureKey) => !!ctx?.types.some((ty) => TYPE_FEATURE[ty] === f), [ctx]);

  const preview = useMemo(
    () => (nowMs ? quickPreview(quick, { now, tz, courses, isOn: featureOn }) : null),
    [quick, now, tz, courses, featureOn, nowMs],
  );

  // ------------------------------------------------------------------------------- saving
  function finish(title: string, run: () => Promise<{ ok: boolean; undo?: () => Promise<unknown>; error?: Key | "setup" }>) {
    setSaved(title);
    // The success tick shows for a moment while the save happens in the background; if it fails, it says so.
    run()
      .then((r) => {
        if (r.ok) toast({ message: t("add.savedToast", { title }), undo: r.undo ? async () => void (await r.undo!()) : undefined });
        else toast({ message: r.error && r.error !== "setup" ? t(r.error) : t("add.saveFailed"), ms: 6000 });
      })
      .catch(() => toast({ message: t("add.saveFailed"), ms: 6000 }));
    closing.current = setTimeout(onClose, 650);
  }

  const asItem = (r: Result<{ id: string }>) => ({ ...r, undo: r.ok ? () => deleteItem(r.id) : undefined });

  function saveFlow() {
    if (!kind || !draft) return;
    setError("");
    if (kind === "grade") {
      const g = buildGrade(draft);
      if (!g) return setError(t("grades.error.invalid"));
      finish(g.title, async () => {
        const r = await addGrade(g);
        return { ...r, undo: r.ok ? () => deleteGrade(r.id) : undefined };
      });
      return;
    }
    const item = buildItem(kind, draft, flowCtx);
    if (!item) return setError(t("add.titleRequired"));
    finish(item.title, async () => asItem(await createItem(item)));
  }

  function saveQuick(e: React.FormEvent) {
    e.preventDefault();
    const text = quick.trim().slice(0, 500);
    if (!text) return;
    const c = ctx ?? BASICS;
    const p = parseQuickAdd(text, { now: new Date(), tz, lang: "auto", courses: courses.map((c) => c.name) });
    const { warnings: _w, ...form } = buildQuickInput(p, text, { tz, nudgeStyle: c.nudgeStyle, courses, isOn: featureOn });
    void _w;
    const item = { ...form, spaceId: c.spaceId };
    finish(item.title, async () => asItem(await createItem(item)));
  }

  async function addClass() {
    const name = newClass.trim();
    if (!name || creating) return;
    setCreating(true);
    const r = await createCourse(name);
    setCreating(false);
    if (!r.ok) return setError(t("common.error"));
    const look = courseLook({ id: r.id, name });
    setCtx((c) => (c ? { ...c, courses: [...c.courses, { id: r.id, name, color: look.color, emoji: look.emoji }] } : c));
    setNewClass("");
    set({ courseId: r.id });
    if (step === 1) setStep(2);
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const chipPick = (c: DueChip) => setDraft((d) => (d ? pickChip(d, c, new Date(), tz) : d));
  const total = kind ? STEPS[kind] : 0;
  const last = step >= total;

  function next(e?: React.FormEvent) {
    e?.preventDefault();
    if (!kind || !draft) return;
    if (!stepReady(kind, step, draft)) return;
    if (last) saveFlow();
    else setStep(step + 1);
  }

  const title = saved
    ? t("add.saved.short")
    : kind
      ? `${KIND_EMOJI(kind)} ${t(`type.${kind}` as Key)}`
      : t("add.sheet.title");

  // ------------------------------------------------------------------------------- pieces
  const typeKinds = ADD_KINDS.filter((k) => (k === "grade" ? !!ctx?.grades : k === "task" || k === "homework" || k === "payment" || k === "event" || (ctx?.types ?? []).includes(k as never)));
  const dayLabel = (chip: DueChip) => {
    const r = dueFromChip(chip, now, tz);
    if (!r.date) return "";
    const [y, m, d] = r.date.split("-").map(Number);
    return formatDay(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", lang);
  };

  const dueChips = (chips: DueChip[], opts: { time?: boolean } = {}) =>
    draft && (
      <div className="flex flex-col gap-3">
        <ChipRow label={t("add.when")}>
          {chips.map((c) => (
            <Chip key={c} on={draft.dueChip === c} onClick={() => chipPick(c)}>
              {t(`add.chip.${c}` as Key)}
              {(["first", "fifteenth", "m1", "m3", "m6", "y1"] as DueChip[]).includes(c) ? <span className="text-xs font-normal text-muted">{dayLabel(c)}</span> : null}
            </Chip>
          ))}
        </ChipRow>
        {draft.dueChip === "pick" && (
          <div>
            <label htmlFor="a-date" className="mb-1 block text-sm font-semibold text-muted">
              {t("add.field.date")}
            </label>
            <input id="a-date" type="date" className="field" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </div>
        )}
        {draft.date && draft.dueChip !== "pick" && <p className="text-sm text-muted">{formatDay(new Date(Date.UTC(+draft.date.slice(0, 4), +draft.date.slice(5, 7) - 1, +draft.date.slice(8, 10), 12)), "UTC", lang)}</p>}
        {opts.time && draft.date && (
          <div>
            <label htmlFor="a-time" className="mb-1 block text-sm font-semibold text-muted">
              {t("add.field.time")}
            </label>
            <input id="a-time" type="time" className="field" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
        )}
      </div>
    );

  const titleField = (labelKey: Key, placeholder?: string) =>
    draft && (
      <div>
        <label htmlFor="a-title" className="mb-1 block text-sm font-semibold text-muted">
          {t(labelKey)}
        </label>
        <input id="a-title" className="field" autoFocus value={draft.title} maxLength={200} placeholder={placeholder} onChange={(e) => set({ title: e.target.value })} />
      </div>
    );

  const courseChips = (required: boolean) =>
    draft && (
      <div className="flex flex-col gap-3">
        {courses.length > 0 && (
          <ChipRow label={t("add.class")}>
            {courses.map((c) => (
              <Chip
                key={c.id}
                on={draft.courseId === c.id}
                color={c.color}
                onClick={() => {
                  set({ courseId: draft.courseId === c.id && !required ? null : c.id });
                  if (step === 1 && draft.courseId !== c.id) setStep(2);
                }}
              >
                <span aria-hidden>{c.emoji}</span> {c.name}
              </Chip>
            ))}
          </ChipRow>
        )}
        <div className="flex gap-2">
          <label htmlFor="a-newclass" className="sr-only">
            {t("add.class.new")}
          </label>
          <input
            id="a-newclass"
            className="field"
            placeholder={`+ ${t("add.class.new")}`}
            value={newClass}
            maxLength={60}
            onChange={(e) => setNewClass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addClass();
              }
            }}
          />
          <button type="button" className="btn-quiet flex-none" disabled={!newClass.trim() || creating} onClick={() => void addClass()}>
            {t("school.addCourse")}
          </button>
        </div>
      </div>
    );

  const numberPad = () =>
    draft && (
      <div className="flex flex-col gap-3">
        <p className="text-center text-4xl font-extrabold tabular-nums" aria-live="polite" aria-label={t("add.field.amount")}>
          ${draft.amount || "0"}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
            <button key={k} type="button" className="btn-quiet !min-h-[52px] !text-xl" aria-label={k === "back" ? t("add.pad.back") : undefined} onClick={() => set({ amount: padPress(draft.amount, k) })}>
              {k === "back" ? "⌫" : k}
            </button>
          ))}
        </div>
      </div>
    );

  const weekdayFmt = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "short", timeZone: "UTC" });
  const weekdayLong = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", timeZone: "UTC" });

  const stepBody = () => {
    if (!kind || !draft) return null;
    switch (kind) {
      case "homework":
        if (step === 1) return courseChips(false);
        if (step === 2)
          return (
            <div className="flex flex-col gap-4">
              {titleField("add.field.title", t("add.hw.placeholder"))}
              {dueChips(["tonight", "tomorrow", "mon", "fri", "pick"], { time: true })}
            </div>
          );
        return (
          <div className="flex flex-col gap-4">
            <ChipRow label={t("add.remind")}>
              {(["night", "2h", "both"] as const).map((r) => (
                <Chip key={r} on={draft.hwReminder === r} onClick={() => set({ hwReminder: r })}>
                  {t(`add.hwr.${r}` as Key)}
                </Chip>
              ))}
            </ChipRow>
            <button type="button" className="btn-quiet w-fit" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? "−" : "+"} {t("add.more")}
            </button>
            {more && (
              <div className="flex flex-col gap-3">
                <div>
                  <label htmlFor="a-link" className="mb-1 block text-sm font-semibold text-muted">
                    {t("hw.link")} <span className="font-normal">({t("common.optional")})</span>
                  </label>
                  <input id="a-link" className="field" type="url" inputMode="url" placeholder="https://" value={draft.link} maxLength={500} onChange={(e) => set({ link: e.target.value })} />
                </div>
                <ChipRow label={t("hw.where")}>
                  {HW_WHERE.map((w) => (
                    <Chip key={w} on={draft.where === w} onClick={() => set({ where: draft.where === w ? null : w })}>
                      {t(`hw.where.${w}` as Key)}
                    </Chip>
                  ))}
                </ChipRow>
              </div>
            )}
          </div>
        );
      case "task":
        if (step === 1) return titleField("add.field.title");
        return dueChips(["today", "tonight", "tomorrow", "fri", "pick"], { time: draft.dueChip === "tonight" });
      case "payment":
        if (step === 1)
          return (
            <div className="flex flex-col gap-4">
              {titleField("add.pay.name", t("add.pay.placeholder"))}
              {numberPad()}
            </div>
          );
        if (step === 2)
          return (
            <div className="flex flex-col gap-4">
              {dueChips(["tomorrow", "fri", "first", "fifteenth", "pick"])}
              <ChipRow label={t("add.field.repeat")}>
                {(["none", "weekly", "monthly", "yearly"] as const).map((r) => (
                  <Chip key={r} on={draft.repeat === r} onClick={() => set({ repeat: r })}>
                    {t(`add.repeat.${r}` as Key)}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          );
        return (
          <ChipRow label={t("add.autopay")}>
            <Chip on={!draft.autopay} onClick={() => set({ autopay: false })}>
              {t("add.autopay.off")}
            </Chip>
            <Chip on={draft.autopay} onClick={() => set({ autopay: true })}>
              {t("add.autopay.on")}
            </Chip>
          </ChipRow>
        );
      case "event":
      case "birthday":
        if (step === 1) return titleField(kind === "birthday" ? "add.bday.name" : "add.field.title");
        if (step === 2)
          return (
            <div className="flex flex-col gap-4">
              {kind === "event" ? (
                dueChips(["today", "tomorrow", "fri", "pick"], { time: !draft.allDay })
              ) : (
                <div>
                  <label htmlFor="a-date" className="mb-1 block text-sm font-semibold text-muted">
                    {t("add.field.date")}
                  </label>
                  <input id="a-date" type="date" className="field" value={draft.date} onChange={(e) => set({ date: e.target.value, dueChip: "pick" })} />
                </div>
              )}
              {kind === "event" && (
                <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                  <input type="checkbox" className="h-5 w-5 accent-[#e8590c]" checked={draft.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
                  {t("common.allDay")}
                </label>
              )}
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                <input type="checkbox" className="h-5 w-5 accent-[#e8590c]" checked={draft.yearly} onChange={(e) => set({ yearly: e.target.checked })} />
                {t("add.yearly")}
              </label>
            </div>
          );
        return (
          <ChipRow label={t("add.headsUp")}>
            {[0, 1, 3, 7].map((n) => (
              <Chip key={n} on={draft.headsUp === n} onClick={() => set({ headsUp: n })}>
                {n === 0 ? t("add.headsUp.day") : n === 7 ? t("add.headsUp.week") : t("form.daysBefore", { n })}
              </Chip>
            ))}
          </ChipRow>
        );
      case "habit":
        if (step === 1)
          return (
            <div className="flex flex-col gap-4">
              {titleField("add.habit.name", t("add.habit.placeholder"))}
              <ChipRow label={t("add.emoji")}>
                {HABIT_EMOJIS.map((e) => (
                  <Chip key={e} on={draft.emoji === e} onClick={() => set({ emoji: e })} label={e} className="!px-3 text-xl">
                    <span aria-hidden>{e}</span>
                  </Chip>
                ))}
              </ChipRow>
            </div>
          );
        if (step === 2)
          return (
            <div className="flex flex-col gap-4">
              <ChipRow label={t("form.repeatOn")}>
                {WEEK_ORDER.map((d) => {
                  const on = draft.days.includes(d);
                  const ref = new Date(Date.UTC(2024, 0, 7 + d));
                  return (
                    <Chip key={d} on={on} label={weekdayLong.format(ref)} className="!px-3 !min-w-[44px] justify-center" onClick={() => set({ days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}>
                      {weekdayFmt.format(ref).slice(0, lang === "es" ? 2 : 3)}
                    </Chip>
                  );
                })}
              </ChipRow>
              <ChipRow>
                <Chip on={draft.days.length === 7} onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>
                  {t("add.habit.everyDay")}
                </Chip>
                <Chip on={draft.days.length === 5 && [1, 2, 3, 4, 5].every((d) => draft.days.includes(d))} onClick={() => set({ days: [1, 2, 3, 4, 5] })}>
                  {t("add.habit.weekdays")}
                </Chip>
              </ChipRow>
            </div>
          );
        return (
          <div className="flex flex-col gap-4">
            <ChipRow label={t("add.field.time")}>
              {TIME_CHIPS.map(([v, k]) => (
                <Chip key={v} on={draft.time === v} onClick={() => set({ time: v })}>
                  {t(k)}
                </Chip>
              ))}
            </ChipRow>
            <div>
              <label htmlFor="a-time" className="mb-1 block text-sm font-semibold text-muted">
                {t("add.field.time")}
              </label>
              <input id="a-time" type="time" className="field" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
            </div>
          </div>
        );
      case "renewal":
        if (step === 1) return titleField("add.renewal.what", t("add.renewal.placeholder"));
        if (step === 2) return dueChips(["m1", "m3", "m6", "y1", "pick"]);
        return (
          <ChipRow label={t("form.renewalDays")}>
            <Chip on={draft.remindDays === 7} onClick={() => set({ remindDays: 7 })}>
              {t("add.renewal.week")}
            </Chip>
            <Chip on={draft.remindDays === 30} onClick={() => set({ remindDays: 30 })}>
              {t("add.renewal.month")}
            </Chip>
          </ChipRow>
        );
      case "grade": {
        if (step === 1) return courseChips(true);
        if (step === 2)
          return (
            <div className="flex flex-col gap-4">
              <ChipRow label={t("add.grade.type")}>
                {GRADE_TYPES.map((g) => (
                  <Chip key={g} on={draft.gradeType === g} onClick={() => set({ gradeType: draft.gradeType === g ? null : g })}>
                    {t(`add.grade.${g}` as Key)}
                  </Chip>
                ))}
              </ChipRow>
              {titleField("grades.field.title", t("add.grade.placeholder"))}
            </div>
          );
        const sc = readScore(draft);
        return (
          <div className="flex flex-col gap-4">
            <ChipRow label={t("grades.field.score")}>
              <Chip on={draft.scoreMode === "points"} onClick={() => set({ scoreMode: "points" })}>
                18/20
              </Chip>
              <Chip on={draft.scoreMode === "percent"} onClick={() => set({ scoreMode: "percent" })}>
                %
              </Chip>
              <Chip on={draft.scoreMode === "letter"} onClick={() => set({ scoreMode: "letter" })}>
                A–F
              </Chip>
            </ChipRow>
            {draft.scoreMode === "points" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="a-score" className="mb-1 block text-sm font-semibold text-muted">
                    {t("grades.field.score")}
                  </label>
                  <input id="a-score" className="field" inputMode="decimal" autoFocus value={draft.score} onChange={(e) => set({ score: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="a-out" className="mb-1 block text-sm font-semibold text-muted">
                    {t("grades.field.outOf")}
                  </label>
                  <input id="a-out" className="field" inputMode="decimal" value={draft.outOf} onChange={(e) => set({ outOf: e.target.value })} />
                </div>
              </div>
            )}
            {draft.scoreMode === "percent" && (
              <div>
                <label htmlFor="a-pct" className="mb-1 block text-sm font-semibold text-muted">
                  %
                </label>
                <input id="a-pct" className="field" inputMode="decimal" autoFocus value={draft.percent} onChange={(e) => set({ percent: e.target.value })} />
              </div>
            )}
            {draft.scoreMode === "letter" && (
              <div className="flex flex-col gap-3">
                <ChipRow label={t("grades.field.letter")}>
                  {["A", "B", "C", "D", "F"].map((l) => (
                    <Chip key={l} on={draft.letter === l} onClick={() => set({ letter: l, sign: l === "F" ? "" : draft.sign })} className="!min-w-[44px] justify-center">
                      {l}
                    </Chip>
                  ))}
                </ChipRow>
                <ChipRow>
                  {(["+", "", "-"] as const).map((s) => (
                    <Chip key={s || "none"} on={draft.sign === s} onClick={() => set({ sign: s })} label={s === "+" ? "plus" : s === "-" ? "minus" : "no sign"} className="!min-w-[44px] justify-center">
                      {s === "" ? "·" : s === "-" ? "−" : s}
                    </Chip>
                  ))}
                </ChipRow>
              </div>
            )}
            <ChipRow label={t("grades.field.term")}>
              {TERM_CHIPS.filter((k) => k !== "final").map((k) => (
                <Chip key={k} on={draft.term === k} onClick={() => set({ term: k })}>
                  {TERM_LABEL[k]}
                </Chip>
              ))}
            </ChipRow>
            {sc && <p className="text-sm text-muted">{sc.letter ?? `${sc.score}/${sc.outOf}`}</p>}
          </div>
        );
      }
    }
  };

  const savedNow = !!kind && !!draft && !last && canSaveNow(kind, draft, flowCtx);
  const ready = !!kind && !!draft && stepReady(kind, step, draft);
  const previewChip = preview && (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite" data-testid="quick-preview">
      <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-ink">
        {KIND_EMOJI(preview.type as AddKind)} {t(`type.${preview.type === "package" ? "task" : preview.type}` as Key)}
      </span>
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${preview.past ? "bg-late-bg text-late-ink" : "bg-neutral-bg text-ink"}`}>
        {preview.dueAt ? `${formatDay(preview.dueAt, tz, lang)}${preview.allDay ? "" : ` · ${formatTime(preview.dueAt, tz, lang)}`}${preview.past ? ` · ${t("add.preview.past")}` : ""}` : t("add.field.noDate")}
      </span>
      {preview.courseId &&
        (() => {
          const c = courses.find((x) => x.id === preview.courseId);
          return c ? (
            <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: c.color, color: "#1c1917" }}>
              {c.emoji} {c.name}
            </span>
          ) : null;
        })()}
      {preview.amountCents != null && <span className="rounded-full bg-pay px-3 py-1 text-sm font-semibold text-ink">{formatMoney(preview.amountCents, "USD", lang)}</span>}
      {preview.link && <span className="rounded-full bg-neutral-bg px-3 py-1 text-sm font-semibold text-ink">↗ {t("hw.link")}</span>}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} tall focusFirst={false}>
      {saved ? (
        <div className="flex flex-col items-center gap-3 py-8" role="status">
          <span className="success-pop flex h-20 w-20 items-center justify-center rounded-full" style={{ backgroundImage: "linear-gradient(135deg, #e8590c, #e5484d)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="check-draw" aria-hidden>
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p className="max-w-full truncate text-lg font-extrabold">{saved}</p>
        </div>
      ) : !kind || !draft ? (
        <div className="flex flex-col gap-4">
          <form onSubmit={saveQuick}>
            <label htmlFor="quick-bar" className="sr-only">
              {t("add.quick.label")}
            </label>
            <div className="flex gap-2">
              <input
                id="quick-bar"
                className="field text-lg"
                placeholder={t("add.quick.placeholder")}
                value={quick}
                maxLength={500}
                enterKeyHint="send"
                autoComplete="off"
                onChange={(e) => setQuick(e.target.value)}
              />
              <button type="submit" className="btn-primary !w-auto flex-none !px-5" disabled={!quick.trim()} aria-label={t("add.quick.save")}>
                ↵
              </button>
            </div>
            {previewChip}
            {error && (
              <p role="alert" className="mt-2 text-sm font-semibold text-late-ink">
                {error}
              </p>
            )}
          </form>

          {ctx && ctx.recent.length > 0 && (
            <ChipRow label={t("add.recent")}>
              {ctx.recent.map((k) => (
                <Chip key={k} on={false} onClick={() => begin(k)}>
                  <span aria-hidden>{KIND_EMOJI(k)}</span> {t(`type.${k}` as Key)}
                </Chip>
              ))}
            </ChipRow>
          )}
          {ctx && ctx.again.length > 0 && (
            <ChipRow label={t("add.again")}>
              {ctx.again.map((a) => (
                <Chip key={`${a.kind}|${a.courseId}|${a.title}`} on={false} onClick={() => begin(a.kind, { title: a.title, courseId: a.courseId }, a.kind === "payment" ? 1 : 2)}>
                  <span aria-hidden>↻</span> {a.title}
                </Chip>
              ))}
            </ChipRow>
          )}

          <div role="group" aria-label={t("add.pick")} className="grid grid-cols-4 gap-2">
            {typeKinds.map((k) => (
              <button key={k} type="button" className="tile !min-h-[84px] !gap-1 !px-1 !py-2" style={{ background: TILE_BG[k], color: "#1c1917" }} onClick={() => begin(k)}>
                <span aria-hidden className="text-3xl leading-none">
                  {KIND_EMOJI(k)}
                </span>
                <span className="text-xs font-bold">{t(`type.${k}` as Key)}</span>
              </button>
            ))}
          </div>
          <Link href="/add" onClick={onClose} className="btn-quiet w-fit self-center text-sm">
            {t("add.fullForm")}
          </Link>
        </div>
      ) : (
        <form onSubmit={next} className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                if (step > 1) setStep(step - 1);
                else setKind(null);
              }}
            >
              ← {t("action.back")}
            </button>
            <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent-text">{t("onb.step", { n: step, total })}</span>
          </div>
          {stepBody()}
          {error && (
            <p role="alert" className="text-sm font-semibold text-late-ink">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <button type="submit" className="btn-primary" disabled={!ready}>
              {last ? t("add.save") : `${t("add.next")} →`}
            </button>
            {savedNow && (
              <button type="button" className="btn-quiet w-full" onClick={saveFlow}>
                {t("add.saveNow")}
              </button>
            )}
          </div>
        </form>
      )}
    </Sheet>
  );
}

