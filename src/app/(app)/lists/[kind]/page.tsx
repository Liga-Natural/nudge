import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { ItemRow } from "@/components/item-row";
import { getReadyCtx } from "@/lib/context";
import { featureOn, type FeatureKey } from "@/lib/features";
import { makeT, type Key } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import type { ItemType } from "@/lib/parser";
import { loadAgenda } from "@/lib/queries";
import { addLocalDays, daysBetweenLocal, endOfLocalDay, formatTime } from "@/lib/time";
import type { AgendaEntry } from "@/lib/types";

// One page for the three "list" kinds: work, birthdays, renewals.
const KINDS: Record<string, { type: ItemType; feature: FeatureKey; name: Key; body: Key; empty: Key }> = {
  work: { type: "work", feature: "work", name: "feature.work", body: "feature.work.body", empty: "lists.work.empty" },
  birthdays: { type: "birthday", feature: "birthdays", name: "feature.birthdays", body: "feature.birthdays.body", empty: "lists.birthdays.empty" },
  renewals: { type: "renewal", feature: "renewals", name: "feature.renewals", body: "feature.renewals.body", empty: "lists.renewals.empty" },
};

export default async function ListPage({ params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const lang = profile.language;
  const tz = profile.timezone;
  const { kind } = await params;
  const def = KINDS[kind];
  if (!def) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10">
        <p className="card p-6 text-center">{t("item.notFound")}</p>
      </main>
    );
  }
  if (!featureOn(profile, def.feature)) return <FeatureOff lang={lang} name={def.name} body={def.body} />;

  const now = new Date();
  const { entries } = await loadAgenda(supabase, { from: addLocalDays(now, tz, -30), to: endOfLocalDay(addLocalDays(now, tz, 400), tz) });
  const mine = entries.filter((e) => e.type === def.type);

  const label = (e: AgendaEntry) => {
    const base = dueLabel(e, now, tz, lang, t);
    const days = daysBetweenLocal(now, new Date(e.dueAt), tz);
    if (def.type === "renewal") return days < 0 ? `${base} · ${t("lists.expired")}` : `${base} · ${t("lists.daysLeft", { n: days })}`;
    if (def.type === "birthday") return days === 0 ? `${base} · 🎉` : `${base} · ${t("lists.inDays", { n: days })}`;
    return base;
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre="" accent={t(def.name)} post="" />
      <p className="text-muted">{t(def.body)}</p>
      {mine.length === 0 ? (
        <p className="card p-6 text-center text-muted">{t(def.empty)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((e) => (
            <ItemRow
              key={e.occId}
              entry={e}
              late={new Date(e.dueAt) < now}
              timeLabel={label(e)}
              money={moneyLabel(e, lang)}
              spaceName={null}
              snoozedLabel={e.snoozedUntil && new Date(e.snoozedUntil) > now ? t("today.snoozedUntil", { time: formatTime(new Date(e.snoozedUntil), tz, lang) }) : null}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
