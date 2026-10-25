"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveDashboardLayout } from "@/app/actions-p6";
import { Sheet } from "@/components/sheet";
import { CourseBadge } from "@/components/course-badge";
import { CountUp } from "@/components/ui/count-up";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useToast } from "@/components/ui/toast";
import { openAdd } from "@/lib/add-events";
import type { AddKind } from "@/lib/add-flows";
import { comingUp, layoutFor, moneyCard, moveCard, schoolCard, type CardId, type DashPref, type GradesCard, type HabitCircle } from "@/lib/dashboard";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { dueLabel } from "@/lib/labels";
import { formatDay, formatMoney } from "@/lib/time";
import { TYPE_EMOJI, type AgendaEntry } from "@/lib/types";

export type BentoCourse = { name: string; color: string; emoji: string };
export type JokerStatus = { state: "ok" | "error"; at: string | null } | null;

export type BentoProps = {
  entries: AgendaEntry[];
  now: Date;
  courses: Record<string, BentoCourse>;
  /** The cards that exist for this person (their feature is on). */
  available: CardId[];
  layout: DashPref | undefined;
  grades: GradesCard | null;
  habits: HabitCircle[];
  joker: JokerStatus;
  onHabit: (c: HabitCircle) => void;
};

const TITLE: Record<CardId, Key> = {
  school: "bento.school",
  grades: "bento.grades",
  money: "bento.money",
  habits: "bento.habits",
  coming: "bento.coming",
};
const EMOJI: Record<CardId, string> = { school: "📚", grades: "📝", money: "💳", habits: "🌱", coming: "🗓️" };
const SPAN: Record<CardId, string> = { school: "col-span-2", grades: "col-span-2", money: "col-span-1", habits: "col-span-1", coming: "col-span-2" };

const stretch = "after:absolute after:inset-0 after:rounded-[22px] after:content-['']";

export function Bento(props: BentoProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [layout, setLayout] = useState<DashPref | undefined>(props.layout);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const { shown, hidden, order } = layoutFor(layout, props.available);
  if (props.available.length === 0) return null;

  // Optimistic: the cards move at once, and snap back with a message if the save fails.
  function save(next: { order: CardId[]; hidden: CardId[] }) {
    const before = layout;
    setLayout(next);
    start(async () => {
      const r = await saveDashboardLayout(next);
      if (!r.ok) {
        setLayout(before);
        toast({ message: t("common.error") });
      }
    });
  }

  const card = (id: CardId, i: number) => {
    const common = { className: `card bento-card stagger relative flex min-w-0 flex-col gap-3 p-4 ${SPAN[id]}`, style: { "--i": i } as React.CSSProperties };
    switch (id) {
      case "school":
        return <SchoolCard key={id} {...common} {...props} />;
      case "grades":
        return <GradesCardView key={id} {...common} {...props} />;
      case "money":
        return <MoneyCard key={id} {...common} {...props} />;
      case "habits":
        return <HabitsCard key={id} {...common} {...props} />;
      case "coming":
        return <ComingCard key={id} {...common} {...props} />;
    }
  };

  return (
    <section aria-labelledby="bento-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bento-h" className="text-lg font-bold">
          {t("bento.title")}
        </h2>
        <button type="button" className="btn-quiet text-sm" onClick={() => setOpen(true)}>
          ✎ {t("bento.customize")}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="card p-4 text-muted">{t("bento.allHidden")}</p>
      ) : (
        <div className="bento">{shown.map((id, i) => card(id, i))}</div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t("bento.customize")}>
        <p className="mb-3 text-sm text-muted">{t("bento.customize.hint")}</p>
        <ul className="flex flex-col gap-2">
          {order.map((id, i) => {
            const isHidden = hidden.includes(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-2xl border border-line p-2">
                <label className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5 flex-none accent-[#e8590c]"
                    checked={!isHidden}
                    onChange={() => save({ order, hidden: isHidden ? hidden.filter((h) => h !== id) : [...hidden, id] })}
                  />
                  <span aria-hidden>{EMOJI[id]}</span>
                  <span className="truncate">{t(TITLE[id])}</span>
                </label>
                <button type="button" className="btn-quiet" aria-label={`${t("bento.up")}: ${t(TITLE[id])}`} disabled={i === 0} onClick={() => save({ order: moveCard(order, id, -1), hidden })}>
                  ↑
                </button>
                <button type="button" className="btn-quiet" aria-label={`${t("bento.down")}: ${t(TITLE[id])}`} disabled={i === order.length - 1} onClick={() => save({ order: moveCard(order, id, 1), hidden })}>
                  ↓
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn-primary mt-4" onClick={() => setOpen(false)}>
          {t("bento.done")}
        </button>
      </Sheet>
    </section>
  );
}

type CardBase = BentoProps & { className: string; style: React.CSSProperties };

function Head({ id, href, badge, stretched = true }: { id: CardId; href: string; badge?: React.ReactNode; stretched?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="min-w-0 text-base font-extrabold">
        <Link href={href} className={`${stretched ? stretch : ""} inline-flex min-h-[44px] items-center gap-1.5 rounded-lg`}>
          <span aria-hidden>{EMOJI[id]}</span>
          <span className="truncate">{t(TITLE[id])}</span>
          <span aria-hidden className="text-muted">
            ›
          </span>
        </Link>
      </h3>
      {badge}
    </div>
  );
}

function Empty({ emoji, text, button, kind }: { emoji: string; text: string; button: string; kind?: AddKind }) {
  return (
    <div className="flex flex-1 flex-col items-start gap-2">
      <p className="text-sm text-muted">
        <span aria-hidden>{emoji}</span> {text}
      </p>
      <button type="button" className="btn-quiet relative z-10 text-sm" onClick={() => openAdd(kind)}>
        + {button}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- School
function SchoolCard({ className, style, entries, now, courses }: CardBase) {
  const { t, tz, lang } = useI18n();
  const s = schoolCard(entries, now);
  return (
    <section className={className} style={style} aria-label={t("bento.school")}>
      <Head
        id="school"
        href="/school"
        badge={
          s.missing > 0 ? (
            <span className="relative z-10 flex-none rounded-full bg-late-bg px-2.5 py-0.5 text-xs font-extrabold text-late-ink" data-testid="missing-badge">
              {t("bento.missing", { n: s.missing })}
            </span>
          ) : null
        }
      />
      {s.next.length === 0 ? (
        <Empty emoji="🎉" text={t("bento.school.empty")} button={t("bento.school.add")} kind="homework" />
      ) : (
        <ul className="flex flex-col gap-2">
          {s.next.map((e) => {
            const c = e.courseId ? courses[e.courseId] : null;
            return (
              <li key={e.occId} className="flex items-center gap-3">
                {c ? <CourseBadge emoji={c.emoji} color={c.color} size={36} /> : <CourseBadge emoji="📚" color="var(--hw)" size={36} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-tight">{e.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {c ? `${c.name} · ` : ""}
                    {dueLabel(e, now, tz, lang, t)}
                  </span>
                </span>
                {e.link && (
                  <a className="btn-quiet relative z-10 flex-none text-sm" href={e.link} target="_blank" rel="noopener noreferrer" aria-label={`${t("hw.open")}: ${e.title}`}>
                    {t("hw.open")} ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------- Grades
function GradesCardView({ className, style, grades, courses }: CardBase) {
  const { t } = useI18n();
  const g = grades;
  const look = (id: string) => courses[id];
  return (
    <section className={className} style={style} aria-label={t("bento.grades")}>
      <Head id="grades" href="/grades" badge={g?.termLabel ? <span className="flex-none rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-extrabold text-accent-text">{g.termLabel.toUpperCase()}</span> : null} />
      {!g || g.rings.length === 0 ? (
        <Empty emoji="📝" text={t("bento.grades.empty")} button={t("bento.grades.add")} kind="grade" />
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-3">
            {g.rings.slice(0, 8).map((r) => (
              <li key={r.courseId} className="flex w-[64px] flex-col items-center gap-1">
                <ProgressRing value={r.ring} size={64} stroke={7} label={`${r.name}: ${r.text}`}>
                  <span className="text-lg font-extrabold leading-none">{r.text}</span>
                </ProgressRing>
                <span className="max-w-full truncate text-xs font-semibold text-muted">
                  {look(r.courseId)?.emoji} {r.name.replace(/^p\d+\s*/i, "")}
                </span>
              </li>
            ))}
          </ul>
          {g.newest && (
            <p className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-muted">{t("bento.newest")}</span>
              <span className="min-w-0 flex-1 truncate font-bold">{g.newest.title}</span>
              <span className="flex-none font-extrabold">
                {g.newest.text}
                {g.newest.dir === "up" && (
                  <span className="ml-1 text-emerald-700 dark:text-emerald-400" role="img" aria-label={t("bento.up")}>
                    ↑
                  </span>
                )}
                {g.newest.dir === "down" && (
                  <span className="ml-1 text-late-ink" role="img" aria-label={t("bento.down")}>
                    ↓
                  </span>
                )}
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------- Money
function MoneyCard({ className, style, entries, now, joker }: CardBase) {
  const { t, tz, lang } = useI18n();
  const m = moneyCard(entries, now);
  const e = m.next;
  return (
    <section className={className} style={style} aria-label={t("bento.money")}>
      <Head id="money" href="/payments" />
      {!e ? (
        <Empty emoji="💸" text={t("bento.money.empty")} button={t("bento.money.add")} kind="payment" />
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{t("bento.money.next")}</p>
          <p className="text-3xl font-extrabold leading-tight">
            {e.amountCents != null ? <CountUp value={e.amountCents} ms={800} format={(c) => formatMoney(Math.round(c), e.currency, lang)} /> : <span aria-hidden>💳</span>}
          </p>
          <p className="truncate font-semibold">{e.title}</p>
          <p className={`text-xs font-semibold ${m.overdue ? "text-late-ink" : "text-muted"}`}>
            {m.overdue ? `${t("bento.money.overdue")} · ` : ""}
            {dueLabel(e, now, tz, lang, t)}
            {m.more > 0 ? ` · ${t("bento.money.more", { n: m.more })}` : ""}
          </p>
        </div>
      )}
      {joker && (
        <p className={`text-xs font-semibold ${joker.state === "error" ? "text-late-ink" : "text-muted"}`}>
          {joker.state === "error" ? `⚠️ ${t("bento.joker.error")}` : `✓ ${t("bento.joker.ok")}`}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------- Habits
function HabitsCard({ className, style, habits, onHabit }: CardBase) {
  const { t } = useI18n();
  const left = habits.filter((h) => !h.done).length;
  return (
    <section className={className} style={style} aria-label={t("bento.habits")}>
      <Head id="habits" href="/habits" stretched={false} badge={habits.length > 0 ? <span className="flex-none text-xs font-extrabold text-muted">{habits.length - left}/{habits.length}</span> : null} />
      {habits.length === 0 ? (
        <Empty emoji="🌱" text={t("bento.habits.empty")} button={t("bento.habits.add")} kind="habit" />
      ) : (
        <ul className="flex flex-wrap gap-x-3 gap-y-3">
          {habits.map((h) => (
            <li key={h.occId} className="flex w-[56px] flex-col items-center gap-0.5">
              <button
                type="button"
                aria-pressed={h.done}
                aria-label={`${h.title}${h.streak > 1 ? ` · ${h.streak}` : ""}`}
                disabled={h.done}
                onClick={() => onHabit(h)}
                className={`${h.done ? "circle-pop" : ""} flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 text-2xl transition-colors ${
                  h.done ? "border-transparent text-white" : "border-line bg-card"
                }`}
                style={h.done ? { backgroundImage: "linear-gradient(135deg, #e8590c, #e5484d)" } : undefined}
              >
                <span aria-hidden>{h.done ? "✓" : h.emoji}</span>
              </button>
              <span className="max-w-full truncate text-[11px] font-semibold text-muted">{h.title}</span>
              {h.streak > 0 && (
                <span className="text-xs font-extrabold" aria-hidden>
                  <span className="flame">🔥</span> {h.streak}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// -------------------------------------------------------------------------------------- Coming up
function ComingCard({ className, style, entries, now }: CardBase) {
  const { t, tz, lang } = useI18n();
  const list = comingUp(entries, now, tz);
  return (
    <section className={className} style={style} aria-label={t("bento.coming")}>
      <Head id="coming" href="/upcoming" />
      {list.length === 0 ? (
        <Empty emoji="🗓️" text={t("bento.coming.empty")} button={t("bento.coming.add")} kind="birthday" />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.slice(0, 5).map(({ entry: e, days }) => (
            <li key={e.occId}>
              <div className="flex min-h-[44px] items-center gap-3">
                <span aria-hidden className="text-xl">
                  {TYPE_EMOJI[e.type] ?? "📅"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-tight">{e.title}</span>
                  <span className="block text-xs text-muted">{formatDay(new Date(e.dueAt), tz, lang)}</span>
                </span>
                <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-extrabold ${days <= 1 ? "bg-accent-soft text-accent-text" : "bg-neutral-bg text-ink"}`}>
                  {days === 0 ? t("today.dueToday") : days === 1 ? t("today.dueTomorrow") : t("bento.inDays", { n: days })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
