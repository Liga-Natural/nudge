"use client";

import Link from "next/link";
import { useState } from "react";
import { markDone, reopenOccurrence } from "@/app/actions";
import { CourseBadge } from "@/components/course-badge";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";
import { fireConfetti } from "@/lib/motion";

export type TonightItem = { occId: string; itemId: string; title: string; courseId: string | null; link: string | null; late: boolean; label: string };
type Course = { name: string; color: string; emoji: string };

/** Tonight's homework, one big row each, in the order it is due. Tick them off; the ring fills as you go. */
export function TonightList({ items: fresh, courses }: { items: TonightItem[]; courses: Record<string, Course> }) {
  const { t } = useI18n();
  const { toast } = useToast();
  // The list you start with stays put while you tick things off (a refresh from the server must not make it vanish).
  const [items] = useState(fresh);
  const [done, setDone] = useState<Set<string>>(new Set());
  const total = items.length;
  const finished = done.size;
  const left = items.filter((i) => !done.has(i.occId));

  function flip(id: string, on: boolean) {
    setDone((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function tick(item: TonightItem) {
    flip(item.occId, true);
    if (left.length === 1) fireConfetti();
    markDone(item.occId).then((r) => {
      if (!r.ok) {
        flip(item.occId, false);
        return toast({ message: t("common.error") });
      }
      toast({
        message: t("toast.done", { title: item.title }),
        undo: async () => {
          flip(item.occId, false);
          await reopenOccurrence(item.occId);
        },
      });
    });
  }

  if (total === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-8 text-center">
        <span aria-hidden className="text-5xl">
          🌙
        </span>
        <h2 className="text-xl font-bold">{t("tonight.empty.title")}</h2>
        <p className="text-muted">{t("tonight.empty.body")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="card flex items-center gap-4 p-4">
        <ProgressRing value={finished / total} size={72} stroke={8} label={t("hero.ringLabel", { done: finished, total })}>
          <span className="text-lg font-extrabold tabular-nums">
            {finished}/{total}
          </span>
        </ProgressRing>
        <p className="text-lg font-bold">{left.length === 0 ? t("tonight.allDone") : t("tonight.left", { n: left.length })}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {items.map((i, n) => {
          const c = i.courseId ? courses[i.courseId] : null;
          const isDone = done.has(i.occId);
          return (
            <li key={i.occId} className="card stagger flex items-center gap-3 p-3" style={{ "--i": n } as React.CSSProperties} data-testid="tonight-row">
              <button
                type="button"
                aria-pressed={isDone}
                aria-label={`${t("action.done")}: ${i.title}`}
                disabled={isDone}
                onClick={() => tick(i)}
                className={`flex h-14 w-14 flex-none items-center justify-center rounded-full border-2 text-2xl font-extrabold ${isDone ? "circle-pop border-transparent text-white" : "border-line bg-card"}`}
                style={isDone ? { backgroundImage: "linear-gradient(135deg, #e8590c, #e5484d)" } : undefined}
              >
                <span aria-hidden>{isDone ? "✓" : ""}</span>
              </button>
              <span className="min-w-0 flex-1">
                <span className={`block break-words text-lg font-bold leading-snug ${isDone ? "text-muted line-through" : ""}`}>{i.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  {c && (
                    <span className="inline-flex items-center gap-1">
                      <CourseBadge emoji={c.emoji} color={c.color} size={20} /> {c.name}
                    </span>
                  )}
                  <span className={i.late ? "font-semibold text-late-ink" : ""}>{i.late ? `${t("today.section.late")} · ` : ""}{i.label}</span>
                </span>
              </span>
              {i.link && !isDone && (
                <a className="btn-quiet flex-none" href={i.link} target="_blank" rel="noopener noreferrer" aria-label={`${t("hw.open")}: ${i.title}`}>
                  {t("hw.open")} ↗
                </a>
              )}
            </li>
          );
        })}
      </ol>
      <Link href="/" className="btn-quiet w-fit self-center">
        {t("nav.today")}
      </Link>
    </>
  );
}
