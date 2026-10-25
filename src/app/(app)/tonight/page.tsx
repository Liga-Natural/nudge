import Link from "next/link";
import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { withLooks } from "@/lib/course-look";
import { featureOn } from "@/lib/features";
import { makeT } from "@/lib/i18n";
import { dueLabel } from "@/lib/labels";
import { loadAgenda } from "@/lib/queries";
import { addLocalDays, endOfLocalDay } from "@/lib/time";
import type { Course } from "@/lib/types";
import { tonightList } from "@/lib/widgets";
import { TonightList } from "./tonight-list";

export default async function TonightPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  if (!featureOn(profile, "school")) return <FeatureOff lang={profile.language} name="feature.school" body="feature.school.body" />;

  const now = new Date();
  const tz = profile.timezone;
  const [{ entries }, courseRes] = await Promise.all([
    loadAgenda(supabase, { from: addLocalDays(now, tz, -90), to: endOfLocalDay(addLocalDays(now, tz, 2), tz) }),
    supabase.from("courses").select("id,name,color,school_year"),
  ]);
  const looked = withLooks((courseRes.data ?? []) as Course[], profile.prefs?.course_emoji);
  const courses = Object.fromEntries(looked.map((c) => [c.id, { name: c.name, color: c.color, emoji: c.emoji }]));
  const items = tonightList(entries, now, tz).map((e) => ({
    occId: e.occId,
    itemId: e.itemId,
    title: e.title,
    courseId: e.courseId,
    link: e.link ?? null,
    late: new Date(e.dueAt) < now,
    label: dueLabel(e, now, tz, profile.language, t),
  }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <Link href="/" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
      <AccentTitle pre={t("tonight.title.pre")} accent={t("tonight.title.accent")} post="" />
      <p className="text-muted">{t("tonight.subtitle")}</p>
      <TonightList items={items} courses={courses} />
    </main>
  );
}
