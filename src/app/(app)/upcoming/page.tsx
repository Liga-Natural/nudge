import Link from "next/link";
import { ItemRow } from "@/components/item-row";
import { AccentTitle } from "@/components/accent-title";
import { SpaceChips } from "@/components/space-chips";
import { filterBySpace, groupByDay } from "@/lib/agenda";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import { loadAgenda, spaceLabel } from "@/lib/queries";
import {
  addLocalDays,
  endOfLocalDay,
  formatDayLong,
  formatTime,
  instantToWall,
  localDateKey,
  startOfLocalDay,
  wallToInstant,
} from "@/lib/time";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; m?: string; day?: string; space?: string }>;
}) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile } = ctx;
  const t = makeT(profile.language);
  const tz = profile.timezone;
  const lang = profile.language;
  const now = new Date();
  const q = await searchParams;
  const view = q.view === "month" ? "month" : "list";

  const nowWall = instantToWall(now, tz);
  const monthKey = q.m && MONTH_RE.test(q.m) ? q.m : `${nowWall.y}-${String(nowWall.m).padStart(2, "0")}`;
  const [my, mm] = monthKey.split("-").map(Number);
  const monthStart = wallToInstant({ y: my, m: mm, d: 1, h: 0, mi: 0 }, tz);
  const nextMonthWall = new Date(Date.UTC(my, mm, 1));
  const monthEnd = new Date(wallToInstant({ y: nextMonthWall.getUTCFullYear(), m: nextMonthWall.getUTCMonth() + 1, d: 1, h: 0, mi: 0 }, tz).getTime() - 1);

  const range = view === "month" ? { from: monthStart, to: monthEnd } : { from: startOfLocalDay(now, tz), to: endOfLocalDay(addLocalDays(now, tz, 30), tz) };
  const { entries: all, spaces } = await loadAgenda(ctx.supabase, range);
  const spaceId = spaces.some((s) => s.id === q.space) ? (q.space as string) : null;
  const entries = filterBySpace(all, spaceId);
  const spaceName = new Map(spaces.map((s) => [s.id, spaceLabel(s, t("space.personal"))]));
  const showSpaces = profile.mode === "full";
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(spaceId ? { space: spaceId } : {}), ...extra });
    return `/upcoming?${p.toString()}`;
  };

  const renderRows = (list: typeof entries) => (
    <ul className="flex flex-col gap-2">
      {list.map((e) => (
        <ItemRow
          key={e.occId}
          entry={e}
          timeLabel={dueLabel(e, now, tz, lang, t)}
          money={moneyLabel(e, lang)}
          spaceName={showSpaces ? (spaceName.get(e.spaceId ?? "") ?? null) : null}
          snoozedLabel={
            e.snoozedUntil && new Date(e.snoozedUntil) > now ? t("today.snoozedUntil", { time: formatTime(new Date(e.snoozedUntil), tz, lang) }) : null
          }
        />
      ))}
    </ul>
  );

  const tab = (on: boolean) =>
    `flex min-h-[44px] flex-1 items-center justify-center rounded-full text-sm font-bold ${on ? "bg-white shadow-card" : "text-muted"}`;

  // ---- strip: next 7 days with dots
  const strip = Array.from({ length: 7 }, (_, i) => addLocalDays(startOfLocalDay(now, tz), tz, i));
  const countsByDay = new Map<string, number>();
  for (const e of entries) {
    const k = localDateKey(new Date(e.dueAt), tz);
    countsByDay.set(k, (countsByDay.get(k) ?? 0) + 1);
  }

  let body: React.ReactNode;
  if (view === "list") {
    const days = groupByDay(entries, tz);
    body = (
      <>
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-hidden>
          {strip.map((d) => {
            const key = localDateKey(d, tz);
            const n = countsByDay.get(key) ?? 0;
            const w = instantToWall(d, tz);
            return (
              <li key={key} className="flex w-14 flex-none flex-col items-center gap-1 rounded-2xl bg-white py-2 shadow-card">
                <span className="text-xs font-semibold uppercase text-muted">
                  {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: tz, weekday: "short" }).format(d)}
                </span>
                <span className="text-lg font-bold">{w.d}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${n ? "bg-accent" : "bg-transparent"}`} />
              </li>
            );
          })}
        </ul>
        {days.length === 0 ? (
          <p className="card p-6 text-center text-muted">{t("upcoming.nothing")}</p>
        ) : (
          days.map((g) => {
            const [y, m, d] = g.day.split("-").map(Number);
            const title = formatDayLong(wallToInstant({ y, m, d, h: 12, mi: 0 }, tz), tz, lang);
            return (
              <section key={g.day} aria-label={title} className="flex flex-col gap-2">
                <h2 className="text-lg font-bold">{title}</h2>
                {renderRows(g.entries)}
              </section>
            );
          })
        )}
      </>
    );
  } else {
    const first = instantToWall(monthStart, tz);
    const firstWeekday = new Date(Date.UTC(first.y, first.m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(my, mm, 0)).getUTCDate();
    const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    const selected = q.day && DAY_RE.test(q.day) && q.day.startsWith(monthKey) ? q.day : null;
    const prev = new Date(Date.UTC(my, mm - 2, 1));
    const next = new Date(Date.UTC(my, mm, 1));
    const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthTitle = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
      new Date(Date.UTC(my, mm - 1, 1)),
    );
    const weekdayNames = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", weekday: "narrow" }).format(new Date(Date.UTC(2023, 0, 1 + i))),
    );
    const selectedEntries = selected ? entries.filter((e) => localDateKey(new Date(e.dueAt), tz) === selected) : [];
    body = (
      <>
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <Link href={qs({ view: "month", m: key(prev) })} className="btn-quiet" aria-label={t("upcoming.prevMonth")}>
              ‹
            </Link>
            <h2 className="text-lg font-bold capitalize">{monthTitle}</h2>
            <Link href={qs({ view: "month", m: key(next) })} className="btn-quiet" aria-label={t("upcoming.nextMonth")}>
              ›
            </Link>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdayNames.map((w, i) => (
              <span key={i} className="py-1 text-xs font-semibold text-muted" aria-hidden>
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <span key={`b${i}`} />;
              const dayKey = `${monthKey}-${String(d).padStart(2, "0")}`;
              const n = countsByDay.get(dayKey) ?? 0;
              const isToday = dayKey === localDateKey(now, tz);
              return (
                <Link
                  key={dayKey}
                  href={qs({ view: "month", m: monthKey, day: dayKey })}
                  aria-label={n ? t("upcoming.thingsOn", { n, day: String(d) }) : String(d)}
                  aria-current={dayKey === selected ? "date" : undefined}
                  className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl text-sm font-semibold ${
                    dayKey === selected ? "bg-accent-soft" : ""
                  } ${isToday ? "ring-2 ring-accent" : ""}`}
                >
                  {d}
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${n ? "bg-accent" : "bg-transparent"}`} />
                </Link>
              );
            })}
          </div>
        </div>
        {selected && (selectedEntries.length ? renderRows(selectedEntries) : <p className="card p-6 text-center text-muted">{t("upcoming.nothing")}</p>)}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("upcoming.title.pre")} accent={t("upcoming.title.accent")} post={t("upcoming.title.post")} />
      <nav className="flex gap-1 rounded-full bg-black/5 p-1" aria-label={t("nav.upcoming")}>
        <Link aria-current={view === "list" ? "page" : undefined} href={qs({ view: "list" })} className={tab(view === "list")}>
          {t("upcoming.list")}
        </Link>
        <Link aria-current={view === "month" ? "page" : undefined} href={qs({ view: "month" })} className={tab(view === "month")}>
          {t("upcoming.month")}
        </Link>
      </nav>
      {showSpaces && (
        <SpaceChips spaces={spaces} current={spaceId} base={view === "month" ? "/upcoming?view=month" : "/upcoming"} allLabel={t("space.all")} personalLabel={t("space.personal")} />
      )}
      {body}
    </main>
  );
}
