import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { makeT } from "@/lib/i18n";
import { ITEM_COLUMNS } from "@/lib/queries";
import { computeStreak } from "@/lib/streak";
import { addLocalDays, endOfLocalDay, startOfLocalDay } from "@/lib/time";
import { weekDots } from "@/lib/today";
import type { ItemRow, OccurrenceRow } from "@/lib/types";
import { HabitRow } from "./habit-row";

export default async function HabitsPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const tz = profile.timezone;
  if (!featureOn(profile, "habits")) return <FeatureOff lang={profile.language} name="feature.habits" body="feature.habits.body" />;

  const now = new Date();
  const { data: itemData } = await supabase.from("items").select(ITEM_COLUMNS).eq("type", "habit").eq("status", "open").order("title");
  const items = (itemData ?? []) as ItemRow[];
  const ids = items.map((i) => i.id);
  const { data: occData } = ids.length
    ? await supabase
        .from("occurrences")
        .select("id,item_id,due_at,status,snoozed_until,snooze_count,done_at")
        .in("item_id", ids)
        .gte("due_at", addLocalDays(now, tz, -120).toISOString())
        .lte("due_at", endOfLocalDay(now, tz).toISOString())
        .order("due_at")
    : { data: [] };
  const occs = (occData ?? []) as OccurrenceRow[];
  const dayStart = startOfLocalDay(now, tz);

  const rows = items.map((item) => {
    const mine = occs.filter((o) => o.item_id === item.id);
    const today = mine.find((o) => new Date(o.due_at) >= dayStart);
    return {
      itemId: item.id,
      title: item.title,
      occId: today?.id ?? null,
      todayStatus: (today?.status ?? null) as "open" | "done" | "skipped" | null,
      streak: computeStreak(mine.map((o) => ({ dueAt: o.due_at, status: o.status })), now, tz),
      dots: weekDots(mine.map((o) => ({ dueAt: o.due_at, status: o.status })), now, tz),
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("habits.title.pre")} accent={t("habits.title.accent")} post="" />
      {rows.length === 0 ? (
        <p className="card p-6 text-center text-muted">{t("habits.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <HabitRow key={r.itemId} {...r} />
          ))}
        </ul>
      )}
    </main>
  );
}
