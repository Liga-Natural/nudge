"use client";

import { useRef, useState, useTransition } from "react";
import { archiveItem, markDone, moveOccurrence, reopenOccurrence, restoreItem, snoozeOccurrence, unsnoozeOccurrence } from "@/app/actions";
import type { Key } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { fireConfetti } from "@/lib/motion";
import { countdownText, type DotState } from "@/lib/today";
import { TYPE_BG, TYPE_EMOJI, type AgendaEntry } from "@/lib/types";
import { PaidSheet } from "./paid-sheet";
import { RescheduleSheet } from "./reschedule-sheet";
import { Sheet } from "./sheet";
import { SnoozeSheet, type SnoozeOption } from "./snooze-sheet";
import { useToast } from "./ui/toast";
import { VTLink } from "./ui/vt-link";

const SWIPE_AT = 90;
const LONG_PRESS_MS = 450;

export type RowChange = { kind: "done" | "undo-done" | "removed" | "undo-removed"; entry: AgendaEntry };

export type RowReorder = {
  /** Called when the grip is pressed (starts the drag in the list). */
  onGripDown: (e: React.PointerEvent) => void;
  onMove: (dir: -1 | 1) => void;
  dragging: boolean;
  offsetY: number;
  dropBefore: boolean;
  dropAfter: boolean;
  canUp: boolean;
  canDown: boolean;
};

export type HabitInfo = { streak: number; dots: { key: string; state: DotState }[] };

export function ItemRow({
  entry,
  timeLabel,
  money,
  spaceName,
  late = false,
  snoozedLabel,
  index = 0,
  nowMs,
  course = null,
  habit = null,
  isLastOfDay = false,
  lateActions = false,
  reorder,
  onChange,
}: {
  entry: AgendaEntry;
  timeLabel: string;
  money: string | null;
  spaceName: string | null;
  late?: boolean;
  snoozedLabel: string | null;
  index?: number;
  /** Server time in ms, for the live countdown on homework. */
  nowMs?: number;
  course?: { name: string; color: string; emoji?: string } | null;
  habit?: HabitInfo | null;
  /** Finishing this one empties the day: celebrate. */
  isLastOfDay?: boolean;
  /** Late items get one-tap "Do today" and "Reschedule". */
  lateActions?: boolean;
  reorder?: RowReorder;
  onChange?: (c: RowChange) => void;
}) {
  const { t, tz } = useI18n();
  const { toast } = useToast();
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const [error, setError] = useState("");
  const [justSnoozed, setJustSnoozed] = useState(false);
  const [, start] = useTransition();
  const gesture = useRef({ x: 0, y: 0, dx: 0, active: false, down: false, long: false, crossed: false });
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragged = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const isPayment = entry.type === "payment";
  const isHomework = entry.type === "homework";
  const now = nowMs ?? 0;
  const dueMs = new Date(entry.dueAt).getTime();
  const countdown = now && dueMs > now && !entry.allDay ? t("hero.in", { time: countdownText(dueMs - now, t("hero.now")) }) : null;

  const buzz = (ms: number) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // not supported (iPhone): the animation is enough
    }
  };

  function finish(kind: "done" | "turned-in") {
    if (isPayment) return setPaidOpen(true);
    setError("");
    setLeaving(true);
    onChange?.({ kind: "done", entry });
    const rect = rowRef.current?.getBoundingClientRect();
    if (isLastOfDay) fireConfetti(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
    setTimeout(() => setGone(true), 400);
    start(async () => {
      const r = await markDone(entry.occId);
      if (!r.ok) {
        setGone(false);
        setLeaving(false);
        onChange?.({ kind: "undo-done", entry });
        return setError(t("common.error"));
      }
      toast({
        message: t(kind === "turned-in" ? "toast.turnedIn" : "toast.done", { title: entry.title }),
        undo: async () => {
          setGone(false);
          setLeaving(false);
          onChange?.({ kind: "undo-done", entry });
          await reopenOccurrence(entry.occId);
        },
      });
    });
  }

  function snooze(option: SnoozeOption) {
    setSnoozeOpen(false);
    setQuickOpen(false);
    setJustSnoozed(true);
    start(async () => {
      const r = await snoozeOccurrence(entry.occId, option);
      if (!r.ok) {
        setJustSnoozed(false);
        return setError(r.error === "setup" ? t("setup.title") : t(r.error));
      }
      toast({
        message: t("toast.snoozed", { title: entry.title }),
        undo: async () => {
          setJustSnoozed(false);
          await unsnoozeOccurrence(entry.occId);
        },
      });
    });
  }

  function move(day: string, label: string) {
    setMoveOpen(false);
    setQuickOpen(false);
    setLeaving(true);
    onChange?.({ kind: "removed", entry });
    setTimeout(() => setGone(true), 400);
    start(async () => {
      const r = await moveOccurrence(entry.occId, day);
      if (!r.ok) {
        setGone(false);
        setLeaving(false);
        onChange?.({ kind: "undo-removed", entry });
        return setError(r.error === "setup" ? t("setup.title") : t(r.error));
      }
      toast({ message: t("toast.moved", { title: entry.title, day: label }) });
    });
  }

  function remove() {
    setQuickOpen(false);
    setLeaving(true);
    onChange?.({ kind: "removed", entry });
    setTimeout(() => setGone(true), 400);
    start(async () => {
      const r = await archiveItem(entry.itemId);
      if (!r.ok) {
        setGone(false);
        setLeaving(false);
        onChange?.({ kind: "undo-removed", entry });
        return setError(t("common.error"));
      }
      toast({
        message: t("toast.deleted", { title: entry.title }),
        undo: async () => {
          setGone(false);
          setLeaving(false);
          onChange?.({ kind: "undo-removed", entry });
          await restoreItem(entry.itemId);
        },
      });
    });
  }

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  if (gone) return null;

  const g = gesture.current;
  const reveal = dx > 0 ? "right" : dx < 0 ? "left" : null;
  const crossed = Math.abs(dx) >= SWIPE_AT;

  return (
    <li
      className={`stagger relative list-none ${leaving ? "row-away" : ""} ${reorder?.dropBefore ? "border-t-4 border-accent" : ""} ${reorder?.dropAfter ? "border-b-4 border-accent" : ""}`}
      style={{ ["--i" as string]: index, transform: reorder?.dragging ? `translateY(${reorder.offsetY}px) scale(1.02)` : undefined, zIndex: reorder?.dragging ? 30 : undefined, position: "relative" }}
      data-occ={entry.occId}
      data-testid="item-row"
    >
      {/* what the swipe reveals */}
      <div aria-hidden className="absolute inset-0 flex items-center justify-between overflow-hidden rounded-[22px]">
        <span className={`flex h-full flex-1 items-center bg-ok-bg pl-5 text-lg font-extrabold text-ink transition-opacity ${reveal === "right" ? "opacity-100" : "opacity-0"}`}>
          {crossed && reveal === "right" ? "✓ " : ""}
          {isPayment ? t("payments.paid") : t("action.done")}
        </span>
        <span className={`flex h-full flex-1 items-center justify-end bg-warn-bg pr-5 text-lg font-extrabold text-ink transition-opacity ${reveal === "left" ? "opacity-100" : "opacity-0"}`}>
          ⏰ {t("action.snooze")}
        </span>
      </div>

      <div
        ref={rowRef}
        className={`card relative flex flex-col gap-2 p-3 ${late ? "bg-late-bg" : ""}`}
        style={{ transform: `translateX(${dx}px)`, touchAction: "pan-y", transition: dx === 0 ? "transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)" : "none" }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
          g.x = e.clientX;
          g.y = e.clientY;
          g.down = true;
          g.active = false;
          g.long = false;
          g.crossed = false;
          g.dx = 0;
          dragged.current = false;
          clearPress();
          pressTimer.current = setTimeout(() => {
            if (!g.active && g.down) {
              g.long = true;
              dragged.current = true;
              buzz(15);
              setQuickOpen(true);
            }
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          if (!g.down) return;
          const mx = e.clientX - g.x;
          const my = e.clientY - g.y;
          if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearPress();
          if (!g.active) {
            if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my)) {
              g.active = true;
              dragged.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            } else return;
          }
          const next = Math.max(-150, Math.min(150, mx));
          if (!g.crossed && Math.abs(next) >= SWIPE_AT) {
            g.crossed = true;
            buzz(10);
          } else if (g.crossed && Math.abs(next) < SWIPE_AT) g.crossed = false;
          g.dx = next;
          setDx(next);
        }}
        onPointerUp={() => {
          clearPress();
          const d = g.dx; // the ref, not state: the last move may not have re-rendered yet
          g.dx = 0;
          g.down = false;
          g.active = false;
          setDx(0);
          if (d >= SWIPE_AT) finish("done");
          else if (d <= -SWIPE_AT) setSnoozeOpen(true);
        }}
        onPointerCancel={() => {
          clearPress();
          g.down = false;
          g.active = false;
          setDx(0);
        }}
        onContextMenu={(e) => g.long && e.preventDefault()}
      >
        <div className="flex items-center gap-2.5">
          <button
            data-nodrag
            onClick={() => finish("done")}
            aria-label={`${isPayment ? t("payments.paid") : t("action.done")}: ${entry.title}`}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-line bg-card text-lg text-muted"
          >
            {leaving ? (
              <svg viewBox="0 0 24 24" width="22" height="22" className="check-draw text-accent" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span aria-hidden>✓</span>
            )}
          </button>

          <VTLink
            href={`/item/${entry.itemId}`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
            onClick={(e) => {
              if (dragged.current) {
                e.preventDefault();
                dragged.current = false;
              }
            }}
          >
            <span aria-hidden className={`flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-xl ${TYPE_BG[entry.type] ?? "bg-task"}`}>
              {TYPE_EMOJI[entry.type] ?? "✅"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 break-words font-semibold leading-snug text-ink">{entry.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <span className={late ? "font-semibold text-late-ink" : ""}>{timeLabel}</span>
                {isHomework && course && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-ink" style={{ background: course.color, color: "#1c1917" }}>
                    <span aria-hidden>{course.emoji ?? "•"}</span>
                    {course.name}
                  </span>
                )}
                {isHomework && entry.where && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-ink">{t(("hw.where." + entry.where) as Key)}</span>}
                {isHomework && countdown && !late && <span className="text-xs font-semibold text-accent-text">{countdown}</span>}
                {!isPayment && money && <span className="rounded-full bg-pay px-2 py-0.5 text-xs font-semibold text-ink">{money}</span>}
                {spaceName && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-ink">{spaceName}</span>}
                {snoozedLabel ? <span className="text-xs">{snoozedLabel}</span> : justSnoozed && <span className="text-xs">⏰ {t("action.snooze")}</span>}
              </span>
            </span>
          </VTLink>

          {isPayment && money && <span className="flex-none text-xl font-extrabold tabular-nums">{money}</span>}
          {habit && (
            <span className="flex flex-none items-center gap-1 rounded-full bg-habit px-3 py-1 text-sm font-extrabold" aria-label={t("habits.streak", { n: habit.streak })}>
              <span aria-hidden className="flame">
                🔥
              </span>{" "}
              {habit.streak}
            </span>
          )}

          <button data-nodrag onClick={() => setSnoozeOpen(true)} aria-label={`${t("action.snooze")}: ${entry.title}`} className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-lg">
            <span aria-hidden>⏰</span>
          </button>
          {reorder && (
            <button
              data-nodrag
              aria-label={`${t("row.reorder")}: ${entry.title}`}
              className="-ml-1.5 flex h-11 w-7 flex-none cursor-grab touch-none items-center justify-center rounded-full text-xl text-muted"
              onPointerDown={reorder.onGripDown}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && reorder.canUp) {
                  e.preventDefault();
                  reorder.onMove(-1);
                } else if (e.key === "ArrowDown" && reorder.canDown) {
                  e.preventDefault();
                  reorder.onMove(1);
                }
              }}
            >
              <span aria-hidden>⠿</span>
            </button>
          )}
        </div>

        {habit && (
          <div className="flex items-center gap-1.5 pl-14" role="img" aria-label={t("habits.week")}>
            {habit.dots.map((d) => (
              <span
                key={d.key}
                title={d.key}
                className={`h-2.5 w-2.5 rounded-full ${
                  d.state === "done"
                    ? "bg-accent"
                    : d.state === "skipped"
                      ? "bg-line ring-1 ring-accent"
                      : d.state === "today"
                        ? "border-2 border-accent bg-transparent"
                        : d.state === "missed"
                          ? "bg-late-ink/40"
                          : "bg-line"
                }`}
              />
            ))}
          </div>
        )}

        {(isHomework || isPayment || lateActions) && (
          <div className="flex flex-wrap gap-2 pl-14" data-nodrag>
            {isHomework && entry.link && (
              <a className="btn-quiet text-sm" href={entry.link} target="_blank" rel="noopener noreferrer">
                {t("hw.open")} ↗
              </a>
            )}
            {isHomework && (
              <button className="btn-quiet text-sm" onClick={() => finish("turned-in")}>
                📤 {t("hw.turnedIn")}
              </button>
            )}
            {isPayment && (
              <button className="btn-quiet text-sm" onClick={() => setPaidOpen(true)}>
                ✓ {t("payments.paid")}
              </button>
            )}
            {lateActions && (
              <>
                <button className="btn-quiet text-sm" onClick={() => move(todayKey(tz), t("reschedule.today"))}>
                  📌 {t("late.doToday")}
                </button>
                <button className="btn-quiet text-sm" onClick={() => setMoveOpen(true)}>
                  📅 {t("late.reschedule")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1 px-2 text-sm text-late-ink">
          {error}
        </p>
      )}

      <SnoozeSheet open={snoozeOpen} onClose={() => setSnoozeOpen(false)} onPick={snooze} />
      <RescheduleSheet open={moveOpen} onClose={() => setMoveOpen(false)} onPick={move} />
      {isPayment && (
        <PaidSheet
          open={paidOpen}
          onClose={() => setPaidOpen(false)}
          occId={entry.occId}
          title={entry.title}
          amountCents={entry.amountCents}
          onPaid={() => {
            setLeaving(true);
            onChange?.({ kind: "done", entry });
            if (isLastOfDay) fireConfetti();
            setTimeout(() => setGone(true), 400);
            toast({ message: t("toast.paid", { title: entry.title }) });
          }}
        />
      )}

      <Sheet open={quickOpen} onClose={() => setQuickOpen(false)} title={entry.title}>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="tile !min-h-[88px]"
            onClick={() => {
              setQuickOpen(false);
              finish("done");
            }}
          >
            <span aria-hidden className="text-2xl">
              ✓
            </span>
            {isPayment ? t("payments.paid") : t("action.done")}
          </button>
          <button
            className="tile !min-h-[88px]"
            onClick={() => {
              setQuickOpen(false);
              setSnoozeOpen(true);
            }}
          >
            <span aria-hidden className="text-2xl">
              ⏰
            </span>
            {t("action.snooze")}
          </button>
          <button
            className="tile !min-h-[88px]"
            onClick={() => {
              setQuickOpen(false);
              setMoveOpen(true);
            }}
          >
            <span aria-hidden className="text-2xl">
              📅
            </span>
            {t("late.reschedule")}
          </button>
          <VTLink href={`/item/${entry.itemId}`} className="tile !min-h-[88px]" onClick={() => setQuickOpen(false)}>
            <span aria-hidden className="text-2xl">
              ✏️
            </span>
            {t("row.open")}
          </VTLink>
          {reorder && (
            <>
              <button className="tile !min-h-[72px]" disabled={!reorder.canUp} onClick={() => reorder.onMove(-1)}>
                <span aria-hidden>↑</span> {t("row.moveUp")}
              </button>
              <button className="tile !min-h-[72px]" disabled={!reorder.canDown} onClick={() => reorder.onMove(1)}>
                <span aria-hidden>↓</span> {t("row.moveDown")}
              </button>
            </>
          )}
        </div>
        <button className="btn-quiet mt-3 w-full text-late-ink" onClick={remove}>
          🗑️ {t("action.delete")}
        </button>
        <button className="btn-quiet mt-2 w-full" onClick={() => setQuickOpen(false)}>
          {t("action.cancel")}
        </button>
      </Sheet>
    </li>
  );
}

function todayKey(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
