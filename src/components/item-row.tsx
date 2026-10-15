"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { markDone, snoozeOccurrence } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { TYPE_BG, TYPE_EMOJI, type AgendaEntry } from "@/lib/types";
import { SnoozeSheet, type SnoozeOption } from "./snooze-sheet";

const SWIPE_AT = 90;

export function ItemRow({
  entry,
  timeLabel,
  money,
  spaceName,
  late = false,
  snoozedLabel,
}: {
  entry: AgendaEntry;
  timeLabel: string;
  money: string | null;
  spaceName: string | null;
  late?: boolean;
  snoozedLabel: string | null;
}) {
  const t = useT();
  const [gone, setGone] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [dx, setDx] = useState(0);
  const [error, setError] = useState("");
  const [, start] = useTransition();
  const startX = useRef<number | null>(null);
  const dragged = useRef(false);

  function done() {
    setGone(true);
    start(async () => {
      const r = await markDone(entry.occId);
      if (!r.ok) {
        setGone(false);
        setError(t("common.error"));
      }
    });
  }

  function snooze(option: SnoozeOption) {
    setSheet(false);
    start(async () => {
      const r = await snoozeOccurrence(entry.occId, option);
      if (!r.ok) setError(r.error === "setup" ? t("setup.title") : t(r.error));
    });
  }

  if (gone) return null;

  return (
    <li className="slide-in relative list-none">
      <div
        className={`card flex items-center gap-3 p-3 ${late ? "bg-late-bg" : ""}`}
        style={{ transform: `translateX(${dx}px)`, touchAction: "pan-y", transition: dx === 0 ? "transform 160ms ease" : "none" }}
        onPointerDown={(e) => {
          startX.current = e.clientX;
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          if (startX.current === null) return;
          const d = e.clientX - startX.current;
          if (Math.abs(d) > 10) {
            dragged.current = true;
            setDx(Math.max(-140, Math.min(140, d)));
          }
        }}
        onPointerUp={() => {
          const d = dx;
          startX.current = null;
          setDx(0);
          if (d >= SWIPE_AT) done();
          else if (d <= -SWIPE_AT) setSheet(true);
        }}
        onPointerCancel={() => {
          startX.current = null;
          setDx(0);
        }}
      >
        <button
          onClick={done}
          aria-label={`${t("action.done")}: ${entry.title}`}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-line bg-white text-lg text-muted"
        >
          <span aria-hidden>✓</span>
        </button>

        <Link
          href={`/item/${entry.itemId}`}
          className="flex min-w-0 flex-1 items-center gap-3"
          onClick={(e) => dragged.current && e.preventDefault()}
        >
          <span
            aria-hidden
            className={`flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-xl ${TYPE_BG[entry.type] ?? "bg-task"}`}
          >
            {TYPE_EMOJI[entry.type] ?? "✅"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-ink">{entry.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className={late ? "font-semibold text-late-ink" : ""}>{timeLabel}</span>
              {money && <span className="rounded-full bg-pay px-2 py-0.5 text-xs font-semibold text-ink">{money}</span>}
              {spaceName && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-ink">{spaceName}</span>}
              {snoozedLabel && <span className="text-xs">{snoozedLabel}</span>}
            </span>
          </span>
        </Link>

        <button
          onClick={() => setSheet(true)}
          aria-label={`${t("action.snooze")}: ${entry.title}`}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-lg"
        >
          <span aria-hidden>⏰</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 px-2 text-sm text-late-ink">
          {error}
        </p>
      )}
      <SnoozeSheet open={sheet} onClose={() => setSheet(false)} onPick={snooze} />
    </li>
  );
}
