import Link from "next/link";
import { ItemRow } from "@/components/item-row";
import { SpaceChips } from "@/components/space-chips";
import { filterBySpace, groupToday } from "@/lib/agenda";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import { featureOn } from "@/lib/features";
import { loadAgenda, spaceLabel } from "@/lib/queries";
import { addLocalDays, endOfLocalDay, formatDayLong, formatTime, instantToWall } from "@/lib/time";
import type { AgendaEntry } from "@/lib/types";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ space?: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile } = ctx;
  const t = makeT(profile.language);
  const tz = profile.timezone;
  const now = new Date();
  const sp = (await searchParams).space ?? null;

  const weekEnd = endOfLocalDay(addLocalDays(now, tz, 7), tz);
  const { entries, spaces } = await loadAgenda(ctx.supabase, { from: addLocalDays(now, tz, -90), to: weekEnd });
  const spaceId = spaces.some((s) => s.id === sp) ? sp : null;
  const groups = groupToday(filterBySpace(entries, spaceId), now, tz);

  const hour = instantToWall(now, tz).h;
  const greeting = hour < 12 ? t("today.greeting.morning") : hour < 18 ? t("today.greeting.afternoon") : t("today.greeting.evening");
  const spaceName = new Map(spaces.map((s) => [s.id, spaceLabel(s, t("space.personal"))]));
  const showSpaces = profile.mode === "full";

  const payments = [...groups.today, ...groups.next].filter((e) => e.type === "payment").length;
  const summary = [
    groups.today.length === 0
      ? groups.late.length === 0
        ? t("today.summary.nothing")
        : null
      : groups.today.length === 1
        ? t("today.summary.today.one")
        : t("today.summary.today.many", { n: groups.today.length }),
    groups.late.length ? t("today.summary.late", { n: groups.late.length }) : null,
    payments ? t("today.summary.payments", { n: payments }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = (list: AgendaEntry[], late = false) => (
    <ul className="flex flex-col gap-2">
      {list.map((e) => (
        <ItemRow
          key={e.occId}
          entry={e}
          late={late}
          timeLabel={dueLabel(e, now, tz, profile.language, t)}
          money={moneyLabel(e, profile.language)}
          spaceName={showSpaces ? (spaceName.get(e.spaceId ?? "") ?? null) : null}
          snoozedLabel={
            e.snoozedUntil && new Date(e.snoozedUntil) > now
              ? t("today.snoozedUntil", { time: formatTime(new Date(e.snoozedUntil), tz, profile.language) })
              : null
          }
        />
      ))}
    </ul>
  );

  const empty = !groups.late.length && !groups.today.length && !groups.next.length;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">{formatDayLong(now, tz, profile.language)}</p>
          <h1 className="text-[2rem] font-extrabold leading-tight tracking-tight">
            {greeting}
            <span className="text-accent-text">.</span>
          </h1>
          <p className="mt-1 text-muted">{summary}</p>
        </div>
        {profile.mode === "simple" && (
          <Link href="/settings" aria-label={t("nav.settings")} className="btn-quiet flex-none">
            <span aria-hidden>⚙️</span>
          </Link>
        )}
      </header>

      {([["payments", "/payments", "💳", "feature.payments"], ["school", "/school", "🎓", "feature.school"], ["updates", "/updates", "🗞️", "feature.updates"]] as const).some(([k]) => featureOn(profile, k)) && (
        <nav aria-label={t("more.title")} className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {([["payments", "/payments", "💳", "feature.payments"], ["school", "/school", "🎓", "feature.school"], ["updates", "/updates", "🗞️", "feature.updates"]] as const)
            .filter(([k]) => featureOn(profile, k))
            .map(([k, href, emoji, label]) => (
              <Link key={k} href={href} className="btn-quiet flex-none">
                <span aria-hidden>{emoji}</span> {t(label)}
              </Link>
            ))}
        </nav>
      )}

      {showSpaces && (
        <SpaceChips spaces={spaces} current={spaceId} base="/" allLabel={t("space.all")} personalLabel={t("space.personal")} />
      )}

      {groups.late.length > 0 && (
        <section aria-labelledby="h-late" className="flex flex-col gap-2">
          <h2 id="h-late" className="text-lg font-bold text-late-ink">
            {t("today.section.late")}
          </h2>
          {rows(groups.late, true)}
        </section>
      )}

      {groups.today.length > 0 && (
        <section aria-labelledby="h-today" className="flex flex-col gap-2">
          <h2 id="h-today" className="text-lg font-bold">
            {t("today.section.today")}
          </h2>
          {rows(groups.today)}
        </section>
      )}

      {groups.next.length > 0 && (
        <section aria-labelledby="h-next" className="flex flex-col gap-2">
          <h2 id="h-next" className="text-lg font-bold">
            {t("today.section.next")}
          </h2>
          {rows(groups.next)}
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
