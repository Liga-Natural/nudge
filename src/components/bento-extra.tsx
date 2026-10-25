"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CountUp } from "@/components/ui/count-up";
import { ProgressRing } from "@/components/ui/progress-ring";
import { comingUp, schoolCard } from "@/lib/dashboard";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { formatMoney, instantToWall } from "@/lib/time";
import { billsMonth, examCountdown, weekStrip, winLine } from "@/lib/widgets";
import { Head, type CardBase } from "./bento";

// ------------------------------------------------------------------------------------- Week ahead
export function WeekCard({ className, style, entries, now }: CardBase) {
  const { t, tz, lang } = useI18n();
  const days = weekStrip(entries, now, tz);
  const fmt = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "short", timeZone: "UTC" });
  const name = (dow: number) => fmt.format(new Date(Date.UTC(2024, 0, 7 + dow)));
  return (
    <section className={className} style={style} aria-label={t("bento.week")}>
      <Head id="week" href="/upcoming" />
      <ul className="grid grid-cols-7 gap-1.5">
        {days.map((d) => (
          <li
            key={d.key}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-2 ${d.today ? "border-accent bg-accent-soft" : "border-transparent bg-neutral-bg"}`}
            aria-label={`${name(d.dow)}: ${d.count}${d.heavy ? ` · ${t("bento.week.busy")}` : ""}`}
          >
            <span aria-hidden className="text-[11px] font-extrabold uppercase text-muted">
              {name(d.dow).slice(0, 3)}
            </span>
            <span
              aria-hidden
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold ${d.heavy ? "text-white" : "text-ink"}`}
              style={d.heavy ? { backgroundImage: "linear-gradient(135deg, #e8590c, #e5484d)" } : undefined}
            >
              {d.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------------------------ Focus timer
const MINUTES = [15, 25, 45];

export function FocusCard({ className, style, entries, now, onDone }: CardBase) {
  const { t } = useI18n();
  const next = schoolCard(entries, now).next[0] ?? null;
  const [mins, setMins] = useState(25);
  const [left, setLeft] = useState(25 * 60_000);
  const [endAt, setEndAt] = useState<number | null>(null);

  useEffect(() => {
    if (endAt === null) return;
    const id = setInterval(() => {
      const r = endAt - Date.now();
      if (r <= 0) {
        setLeft(0);
        setEndAt(null);
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          // no vibration here
        }
      } else setLeft(r);
    }, 500);
    return () => clearInterval(id);
  }, [endAt]);

  const total = mins * 60_000;
  const secs = Math.ceil(left / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const finished = left === 0;
  const running = endAt !== null;
  return (
    <section className={className} style={style} aria-label={t("bento.focus")}>
      <Head id="focus" href="/tonight" stretched={false} />
      <div className="flex items-center gap-4">
        <ProgressRing value={1 - left / total} size={84} stroke={9} label={`${t("bento.focus")}: ${clock}`}>
          <span className="text-lg font-extrabold tabular-nums">{clock}</span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-sm font-semibold text-muted">{next ? `${t("bento.focus.on")} ${next.title}` : t("bento.focus.free")}</p>
          <div className="flex flex-wrap gap-2">
            {finished ? (
              <>
                {next && (
                  <button type="button" className="btn-primary !min-h-[44px] !w-auto !px-4 !text-base" onClick={() => onDone(next)}>
                    ✓ {t("bento.focus.markDone")}
                  </button>
                )}
                <button type="button" className="btn-quiet" onClick={() => setLeft(total)}>
                  {t("bento.focus.again")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary !min-h-[44px] !w-auto !px-5 !text-base"
                  onClick={() => {
                    if (running) {
                      setLeft(Math.max(0, (endAt as number) - Date.now()));
                      setEndAt(null);
                    } else setEndAt(Date.now() + left);
                  }}
                >
                  {running ? t("bento.focus.pause") : left < total ? t("bento.focus.resume") : t("bento.focus.start")}
                </button>
                {(running || left < total) && (
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => {
                      setEndAt(null);
                      setLeft(total);
                    }}
                  >
                    {t("bento.focus.reset")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {!running && left === total && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("bento.focus.length")}>
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mins === m}
              className={`min-h-[44px] rounded-full border-2 px-4 text-sm font-semibold ${mins === m ? "border-accent bg-accent-soft" : "border-line bg-card"}`}
              onClick={() => {
                setMins(m);
                setLeft(m * 60_000);
              }}
            >
              {m} min
            </button>
          ))}
          <Link href="/tonight" className="btn-quiet text-sm">
            🌙 {t("tonight.title")}
          </Link>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------- Exam countdown
export function ExamCard({ className, style, entries, now, courses }: CardBase) {
  const { t, tz } = useI18n();
  const x = examCountdown(entries, now, tz);
  const c = x?.entry.courseId ? courses[x.entry.courseId] : null;
  return (
    <section className={className} style={style} aria-label={t("bento.exam")}>
      <Head id="exam" href="/school" />
      {!x ? (
        <p className="text-sm text-muted">
          <span aria-hidden>😌</span> {t("bento.exam.empty")}
        </p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <ProgressRing value={x.fill} size={72} stroke={8} label={`${x.entry.title}: ${x.days}`}>
            <span className="text-xl font-extrabold leading-none">
              <CountUp value={x.days} ms={600} />
            </span>
            <span className="text-[10px] font-bold uppercase text-muted">{t("bento.exam.days")}</span>
          </ProgressRing>
          <p className="max-w-full truncate text-sm font-bold">
            {c?.emoji} {x.entry.title}
          </p>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------ Bills month
export function BillsCard({ className, style, entries, now, paid }: CardBase) {
  const { t, tz, lang } = useI18n();
  const b = billsMonth(entries, paid, now, tz);
  const none = b.dueCents === 0 && b.paidCents === 0;
  const paidText = t("bento.bills.paid", { amount: formatMoney(b.paidCents, "USD", lang) });
  return (
    <section className={className} style={style} aria-label={t("bento.bills")}>
      <Head id="bills" href="/payments" />
      {none ? (
        <p className="text-sm text-muted">
          <span aria-hidden>🧾</span> {t("bento.bills.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{t("bento.bills.left")}</p>
          <p className="text-2xl font-extrabold leading-tight">
            <CountUp value={b.dueCents} ms={800} format={(c) => formatMoney(Math.round(c), "USD", lang)} />
          </p>
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-bg" role="img" aria-label={paidText}>
            <div className="h-full rounded-full" style={{ width: `${Math.round(b.fill * 100)}%`, backgroundImage: "linear-gradient(90deg, #e8590c, #e5484d)", transition: "width 900ms cubic-bezier(0.22,1,0.36,1)" }} />
          </div>
          <p className="text-xs font-semibold text-muted">{paidText}</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------- Streaks
export function StreaksCard({ className, style, habits, activity }: CardBase) {
  const { t } = useI18n();
  const best = Math.max(0, ...habits.map((h) => h.streak));
  const delta = activity.hwThisWeek - activity.hwLastWeek;
  const tiles: [string, number, Key][] = [
    ["🔥", best, "bento.streaks.best"],
    ["📚", activity.hwThisWeek, "bento.streaks.hw"],
    ["✅", activity.thisWeek, "bento.streaks.all"],
  ];
  return (
    <section className={className} style={style} aria-label={t("bento.streaks")}>
      <Head id="streaks" href="/habits" />
      <ul className="grid grid-cols-3 gap-2 text-center">
        {tiles.map(([emoji, n, label]) => (
          <li key={label} className="rounded-2xl bg-neutral-bg p-2">
            <p className="text-2xl font-extrabold">
              <span aria-hidden className={emoji === "🔥" && n > 0 ? "flame" : ""}>
                {emoji}
              </span>{" "}
              <CountUp value={n} ms={600} />
            </p>
            <p className="text-[11px] font-bold text-muted">{t(label)}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs font-semibold text-muted">
        {delta > 0 ? `↑ ${t("bento.streaks.more", { n: delta })}` : delta < 0 ? `↓ ${t("bento.streaks.less", { n: -delta })}` : t("bento.streaks.same")}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------------------------ Win of the day
export function WinCard({ className, style, now, activity }: CardBase) {
  const { t, tz } = useI18n();
  const w = winLine(activity, now, tz);
  const text = w.kind === "yesterday" ? t("bento.win.yesterday", { n: w.n }) : w.kind === "today" ? t("bento.win.today", { n: w.n }) : t(`bento.quote.${w.n}` as Key);
  return (
    <section className={className} style={style} aria-label={t("bento.win")}>
      <Head id="win" href="/upcoming" stretched={false} />
      <p className="text-lg font-bold leading-snug">
        <span aria-hidden>{w.kind === "quote" ? "💬" : "🎉"}</span> {text}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------------------------ Weekly recap
export function RecapCard({ className, style, entries, now, activity, grades }: CardBase) {
  const { t, tz } = useI18n();
  const school = schoolCard(entries, now);
  const coming = comingUp(entries, now, tz, 7).length;
  const w = instantToWall(now, tz);
  const sunday = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay() === 0;
  const rows: [string, Key, number][] = [
    ["✅", "bento.recap.done", activity.thisWeek],
    ["📚", "bento.recap.hw", activity.hwThisWeek],
    ["⚠️", "bento.recap.missing", school.missing],
    ["🗓️", "bento.recap.coming", coming],
  ];
  return (
    <section className={`${className} ${sunday ? "ring-2 ring-accent" : ""}`} style={style} aria-label={t("bento.recap")}>
      <Head
        id="recap"
        href="/upcoming"
        stretched={false}
        badge={sunday ? <span className="flex-none rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-extrabold text-accent-text">{t("bento.recap.sunday")}</span> : null}
      />
      <ul className="grid grid-cols-2 gap-2">
        {rows.map(([emoji, label, n]) => (
          <li key={label} className="flex items-center gap-2 rounded-2xl bg-neutral-bg px-3 py-2">
            <span aria-hidden>{emoji}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted">{t(label)}</span>
            <span className="text-lg font-extrabold">
              <CountUp value={n} ms={600} />
            </span>
          </li>
        ))}
      </ul>
      {grades?.newest && (
        <p className="text-sm font-semibold">
          📝 {grades.newest.title}: <span className="font-extrabold">{grades.newest.text}</span>
          {grades.newest.dir === "up" ? " ↑" : grades.newest.dir === "down" ? " ↓" : ""}
        </p>
      )}
    </section>
  );
}
