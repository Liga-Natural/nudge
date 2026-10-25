"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { markDone, reopenOccurrence, saveDayOrder } from "@/app/actions";
import { groupByDay } from "@/lib/agenda";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import { formatDay, formatDayLong, formatTime, instantToWall, localDateKey } from "@/lib/time";
import { countdownText, groupTimeline, nextUp, nowLineIndex, PERIODS, periodNow, splitViews, type DotState, type Period } from "@/lib/today";
import type { CardId, DashPref, GradesCard, HabitCircle } from "@/lib/dashboard";
import type { AgendaEntry } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { Bento, type BentoCourse, type JokerStatus } from "./bento";
import { ItemRow, type HabitInfo, type RowChange } from "./item-row";
import { CountUp } from "./ui/count-up";
import { NudgeMark } from "./ui/nudge-mark";
import { ProgressRing } from "./ui/progress-ring";
import { useToast } from "./ui/toast";

type View = "today" | "tomorrow" | "week";

export type TodayViewProps = {
  entries: AgendaEntry[];
  nowMs: number;
  /** Reminders due today that are already done (so the ring can show progress). */
  doneToday: number;
  firstName: string | null;
  spaceNames: Record<string, string>;
  showSpaces: boolean;
  courses: Record<string, BentoCourse>;
  /** The dashboard cards under the hero. */
  bento: { available: CardId[]; layout: DashPref | undefined; grades: GradesCard | null; habits: HabitCircle[]; joker: JokerStatus };
  habits: Record<string, { streak: number; dots: { key: string; state: DotState }[] }>;
  dayOrder: Record<string, string[]>;
  /** The shortcut row and space chips, drawn by the server. */
  top: React.ReactNode;
  /** The settings gear (simple mode). */
  gear: React.ReactNode;
  simple: boolean;
};

export function TodayView(props: TodayViewProps) {
  const { t, tz, lang } = useI18n();
  const { toast } = useToast();
  const nowMs = useNow(props.nowMs);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [view, setView] = useState<View>("today");
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [goneIds, setGoneIds] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState(props.dayOrder);
  const todayKey = localDateKey(now, tz);

  // Habit circles ticked here before the server has caught up.
  const [habitDone, setHabitDone] = useState<Set<string>>(new Set());

  // A fresh server answer replaces what we guessed.
  useEffect(() => setOrder(props.dayOrder), [props.dayOrder]);

  const visible = useMemo(() => props.entries.filter((e) => !doneIds.has(e.occId) && !goneIds.has(e.occId)), [props.entries, doneIds, goneIds]);
  const views = useMemo(() => splitViews(visible, now, tz), [visible, now, tz]);

  // Done today = the server's count + the ones finished here that the server has not caught up on yet.
  const todayRange = useMemo(() => splitViews(props.entries, now, tz).today, [props.entries, now, tz]);
  const extraDone = todayRange.filter((e) => doneIds.has(e.occId)).length;
  const done = props.doneToday + extraDone;
  const remaining = views.today.length;
  const total = done + remaining;

  const next = useMemo(() => nextUp([...views.today, ...views.tomorrow, ...views.week], now), [views, now]);

  function onChange(c: RowChange) {
    const id = c.entry.occId;
    const flip = (set: Set<string>, add: boolean) => {
      const n = new Set(set);
      if (add) n.add(id);
      else n.delete(id);
      return n;
    };
    if (c.kind === "done") setDoneIds((s) => flip(s, true));
    else if (c.kind === "undo-done") setDoneIds((s) => flip(s, false));
    else if (c.kind === "removed") setGoneIds((s) => flip(s, true));
    else setGoneIds((s) => flip(s, false));
  }

  const circles = useMemo(
    () => props.bento.habits.map((h) => (habitDone.has(h.occId) && !h.done ? { ...h, done: true, streak: h.streak + 1 } : h)),
    [props.bento.habits, habitDone],
  );

  function tapHabit(h: HabitCircle) {
    const entry = props.entries.find((e) => e.occId === h.occId);
    const flip = (add: boolean) =>
      setHabitDone((s) => {
        const n = new Set(s);
        if (add) n.add(h.occId);
        else n.delete(h.occId);
        return n;
      });
    const undoHere = () => {
      flip(false);
      if (entry) onChange({ kind: "undo-done", entry });
    };
    flip(true);
    if (entry) onChange({ kind: "done", entry });
    markDone(h.occId).then((r) => {
      if (!r.ok) {
        undoHere();
        return toast({ message: t("common.error") });
      }
      toast({
        message: t("toast.done", { title: h.title }),
        undo: async () => {
          undoHere();
          await reopenOccurrence(h.occId);
        },
      });
    });
  }

  const hour = instantToWall(now, tz).h;
  const greeting = hour < 12 ? t("today.greeting.morning") : hour < 18 ? t("today.greeting.afternoon") : t("today.greeting.evening");
  const name = props.firstName?.trim();

  const label = (e: AgendaEntry) => dueLabel(e, now, tz, lang, t);
  const snoozedLabel = (e: AgendaEntry) =>
    e.snoozedUntil && new Date(e.snoozedUntil) > now ? t("today.snoozedUntil", { time: formatTime(new Date(e.snoozedUntil), tz, lang) }) : null;

  // --- drag to reorder (within one part of the day) -------------------------------------------
  const [drag, setDrag] = useState<{ period: Period; id: string; dy: number; target: number } | null>(null);
  const timeline = useMemo(() => groupTimeline(views.today, tz, order[todayKey]), [views.today, tz, order, todayKey]);

  function commitOrder(period: Period, ids: string[]) {
    const flat = PERIODS.flatMap((p) => (p === period ? ids : timeline[p].map((e) => e.occId)));
    setOrder((o) => ({ ...o, [todayKey]: flat }));
    saveDayOrder(todayKey, flat).then((r) => !r.ok && toast({ message: t("common.error") }));
  }
  function moveBy(period: Period, id: string, dir: -1 | 1) {
    const ids = timeline[period].map((e) => e.occId);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    commitOrder(period, ids);
  }
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  function gripDown(period: Period, id: string) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      const ul = (e.currentTarget as HTMLElement).closest("ul");
      if (!ul) return;
      const ids = timeline[period].map((x) => x.occId);
      const from = ids.indexOf(id);
      const startY = e.clientY;
      const targetFor = (y: number) => {
        const mids = ids.map((x) => {
          const r = ul.querySelector(`[data-occ="${x}"]`)?.getBoundingClientRect();
          return r ? r.top + r.height / 2 : 0;
        });
        let target = 0;
        for (let i = 0; i < mids.length; i++) if (y > mids[i]) target = i;
        return target;
      };
      setDrag({ period, id, dy: 0, target: from });
      const move = (ev: PointerEvent) => setDrag({ period, id, dy: ev.clientY - startY, target: targetFor(ev.clientY) });
      const up = (ev: PointerEvent) => {
        cleanup();
        const target = targetFor(ev.clientY);
        setDrag(null);
        if (target !== from) {
          const next = [...ids];
          next.splice(target, 0, next.splice(from, 1)[0]);
          commitOrder(period, next);
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        dragCleanup.current = null;
      };
      const cancel = () => {
        cleanup();
        setDrag(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      dragCleanup.current = cleanup;
    };
  }

  // --- rows -------------------------------------------------------------------------------------
  let rowIndex = 0;
  const row = (e: AgendaEntry, opts: { late?: boolean; period?: Period; position?: number; count?: number } = {}) => {
    const i = rowIndex++;
    const habit: HabitInfo | null = e.type === "habit" ? (props.habits[e.itemId] ?? null) : null;
    const canReorder = !!opts.period && (opts.count ?? 0) > 1;
    const dragging = drag?.id === e.occId;
    const from = opts.period ? timeline[opts.period].findIndex((x) => x.occId === drag?.id) : -1;
    const insertBefore = drag && opts.period === drag.period ? (drag.target <= from ? drag.target : drag.target + 1) : -1;
    return (
      <ItemRow
        key={e.occId}
        entry={e}
        index={i}
        late={!!opts.late}
        lateActions={!!opts.late}
        nowMs={nowMs}
        timeLabel={label(e)}
        money={moneyLabel(e, lang)}
        spaceName={props.showSpaces ? (props.spaceNames[e.spaceId ?? ""] ?? null) : null}
        snoozedLabel={snoozedLabel(e)}
        course={e.courseId ? (props.courses[e.courseId] ?? null) : null}
        habit={habit}
        isLastOfDay={!opts.late && view === "today" && remaining === 1 && views.today[0]?.occId === e.occId}
        onChange={onChange}
        reorder={
          canReorder && opts.period
            ? {
                onGripDown: gripDown(opts.period, e.occId),
                onMove: (dir) => moveBy(opts.period!, e.occId, dir),
                dragging,
                offsetY: dragging ? (drag?.dy ?? 0) : 0,
                dropBefore: !!drag && opts.period === drag.period && !dragging && insertBefore === opts.position,
                dropAfter: !!drag && opts.period === drag.period && !dragging && insertBefore === (opts.count ?? 0) && opts.position === (opts.count ?? 0) - 1,
                canUp: (opts.position ?? 0) > 0,
                canDown: (opts.position ?? 0) < (opts.count ?? 0) - 1,
              }
            : undefined
        }
      />
    );
  };

  const counts: [View, number][] = [
    ["today", views.today.length],
    ["tomorrow", views.tomorrow.length],
    ["week", views.week.length],
  ];
  const previewOf = (v: View) => (v === "today" ? views.today : v === "tomorrow" ? views.tomorrow : views.week)[0]?.title ?? null;

  const empty = !views.late.length && !views.today.length && !views.tomorrow.length && !views.week.length;
  const nowPeriod = periodNow(now, tz);
  const nowLabel = formatTime(now, tz, lang);

  const section = (p: Period) => {
    const items = timeline[p];
    if (!items.length && p !== nowPeriod) return null;
    const idx = p === nowPeriod ? nowLineIndex(items, now) : -1;
    return (
      <section key={p} aria-labelledby={`tl-${p}`} className="flex flex-col gap-2">
        <h3 id={`tl-${p}`} className="text-sm font-extrabold uppercase tracking-wide text-muted">
          {t(`period.${p}` as Key)}
        </h3>
        <ul className="flex flex-col gap-2">
          {items.map((e, i) => (
            <FragmentWithNow key={e.occId} showNow={idx === i} label={`${t("now.label")} ${nowLabel}`}>
              {row(e, { period: p, position: i, count: items.length })}
            </FragmentWithNow>
          ))}
          {idx === items.length && <NowLine label={`${t("now.label")} ${nowLabel}`} />}
        </ul>
      </section>
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">{formatDayLong(now, tz, lang)}</p>
          <h1 className="text-[2rem] font-extrabold leading-tight tracking-tight">
            {greeting}
            {name ? `, ${name}` : ""}
            <span className="text-accent-text">.</span>
          </h1>
          <p className="mt-1 text-muted">
            {views.today.length === 0 && views.late.length === 0 && done === 0 ? (
              t("today.summary.nothing")
            ) : (
              <>
                {views.today.length > 0 || done > 0 ? (
                  <>
                    <CountUp value={views.today.length} className="font-bold text-ink" /> {t(views.today.length === 1 ? "today.due.one" : "today.due.many")}
                  </>
                ) : null}
                {views.late.length > 0 && (
                  <>
                    {views.today.length > 0 || done > 0 ? " · " : ""}
                    {t("today.summary.late", { n: views.late.length })}
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {props.gear}
          <span id="header-mark" className="block">
            <NudgeMark size={44} id="hm" />
          </span>
        </div>
      </header>

      {props.top}

      {/* The hero: ring, next up, and the swipeable Today · Tomorrow · This week strip. */}
      <section aria-label={t("hero.label")} className="card overflow-hidden p-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={total ? done / total : 0} label={t("hero.ringLabel", { done, total })}>
            <span className="text-2xl font-extrabold leading-none tabular-nums">
              <CountUp value={done} />
              <span className="text-muted">/{total}</span>
            </span>
            <span className="mt-1 text-xs font-semibold text-muted">{total && done === total ? t("hero.allDone") : t("hero.done")}</span>
          </ProgressRing>
          <div className="min-w-0 flex-1" aria-live="off">
            <p className="text-xs font-extrabold uppercase tracking-wide text-accent-text">{t("hero.nextUp")}</p>
            {next ? (
              <p className="mt-1 text-lg leading-snug">
                <span className="font-extrabold">{next.title}</span>{" "}
                <span className="font-bold text-accent-text">{t("hero.in", { time: countdownText(new Date(next.dueAt).getTime() - nowMs, t("hero.now")) })}</span>
              </p>
            ) : (
              <p className="mt-1 text-muted">{t("hero.nothingNext")}</p>
            )}
          </div>
        </div>

        <div role="group" aria-label={t("hero.strip")} className="-mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {counts.map(([v, n]) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="tile !min-h-[92px] min-w-[46%] flex-none snap-start !items-start !justify-start !gap-0.5 !px-4 !py-3 !text-left"
            >
              <span className="text-xs font-extrabold uppercase tracking-wide text-muted">{t(`view.${v}` as Key)}</span>
              <span className="text-3xl font-extrabold leading-tight">
                <CountUp value={n} />
              </span>
              <span className="max-w-full truncate text-xs font-semibold text-muted">{previewOf(v) ?? "—"}</span>
            </button>
          ))}
        </div>
      </section>

      <Bento
        entries={visible}
        now={now}
        courses={props.courses}
        available={props.bento.available}
        layout={props.bento.layout}
        grades={props.bento.grades}
        habits={circles}
        joker={props.bento.joker}
        onHabit={tapHabit}
      />

      {view === "today" && views.late.length > 0 && (
        <section aria-labelledby="h-late" className="late-pulse -mx-2 flex flex-col gap-2 rounded-[26px] p-2">
          <h2 id="h-late" className="text-lg font-bold text-late-ink">
            {t("today.section.late")} <span className="tabular-nums">· {views.late.length}</span>
          </h2>
          <ul className="flex flex-col gap-2">{views.late.map((e) => row(e, { late: true }))}</ul>
        </section>
      )}

      {view === "today" && (
        <section aria-labelledby="h-today" className="flex flex-col gap-3">
          <h2 id="h-today" className="text-lg font-bold">
            {t("today.section.today")}
          </h2>
          {PERIODS.map((p) => section(p))}
        </section>
      )}

      {view === "tomorrow" && (
        <section aria-labelledby="h-tomorrow" className="flex flex-col gap-2">
          <h2 id="h-tomorrow" className="text-lg font-bold">
            {t("view.tomorrow")}
          </h2>
          {views.tomorrow.length ? <ul className="flex flex-col gap-2">{views.tomorrow.map((e) => row(e))}</ul> : <p className="card p-4 text-muted">{t("view.nothing")}</p>}
        </section>
      )}

      {view === "week" && (
        <section aria-labelledby="h-week" className="flex flex-col gap-3">
          <h2 id="h-week" className="text-lg font-bold">
            {t("view.week")}
          </h2>
          {views.week.length ? (
            groupByDay(views.week, tz).map((g) => {
              const [y, m, d] = g.day.split("-").map(Number);
              return (
                <div key={g.day} className="flex flex-col gap-2">
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">{formatDay(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", lang)}</h3>
                  <ul className="flex flex-col gap-2">{g.entries.map((e) => row(e))}</ul>
                </div>
              );
            })
          ) : (
            <p className="card p-4 text-muted">{t("view.nothing")}</p>
          )}
        </section>
      )}

      {empty && (
        <div className="card slide-in flex flex-col items-center gap-2 p-8 text-center">
          <span aria-hidden className="text-5xl">
            🌤️
          </span>
          <h2 className="text-xl font-bold">{t("today.empty.title")}</h2>
          <p className="text-muted">{t("today.empty.body")}</p>
        </div>
      )}
    </main>
  );
}

/** The "now" line sits between two rows of the timeline. */
function NowLine({ label }: { label: string }) {
  return (
    <li aria-hidden className="now-line list-none py-1" data-testid="now-line">
      {label}
    </li>
  );
}

function FragmentWithNow({ showNow, label, children }: { showNow: boolean; label: string; children: React.ReactNode }) {
  return (
    <>
      {showNow && <NowLine label={label} />}
      {children}
    </>
  );
}
