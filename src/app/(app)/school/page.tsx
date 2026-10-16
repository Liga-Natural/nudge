import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { ItemRow } from "@/components/item-row";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { makeT } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import { loadAgenda } from "@/lib/queries";
import { splitSchool } from "@/lib/school";
import { addLocalDays, endOfLocalDay, formatTime } from "@/lib/time";
import type { AgendaEntry, Course } from "@/lib/types";
import { Courses } from "./courses";

export default async function SchoolPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const lang = profile.language;
  const tz = profile.timezone;
  if (!featureOn(profile, "school")) return <FeatureOff lang={lang} name="feature.school" body="feature.school.body" />;

  const now = new Date();
  const [{ entries }, coursesRes] = await Promise.all([
    loadAgenda(supabase, { from: addLocalDays(now, tz, -30), to: endOfLocalDay(addLocalDays(now, tz, 90), tz) }),
    supabase.from("courses").select("id,name,color").order("created_at"),
  ]);
  const courses = (coursesRes.data ?? []) as Course[];
  const { late, exams, groups } = splitSchool(entries, courses, now);

  const rows = (list: AgendaEntry[], isLate = false) => (
    <ul className="flex flex-col gap-2">
      {list.map((e) => (
        <ItemRow
          key={e.occId}
          entry={e}
          late={isLate}
          timeLabel={dueLabel(e, now, tz, lang, t)}
          money={moneyLabel(e, lang)}
          spaceName={null}
          snoozedLabel={e.snoozedUntil && new Date(e.snoozedUntil) > now ? t("today.snoozedUntil", { time: formatTime(new Date(e.snoozedUntil), tz, lang) }) : null}
        />
      ))}
    </ul>
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("school.title.pre")} accent={t("school.title.accent")} post={t("school.title.post")} />
      <Courses courses={courses} />

      {late.length > 0 && (
        <section aria-labelledby="sc-late" className="late-pulse flex flex-col gap-2 rounded-[26px]">
          <h2 id="sc-late" className="text-lg font-bold text-late-ink">
            {t("school.late")}
          </h2>
          {rows(late, true)}
        </section>
      )}

      <section aria-labelledby="sc-exams" className="flex flex-col gap-2">
        <h2 id="sc-exams" className="text-lg font-bold">
          {t("school.exams")}
        </h2>
        {exams.length ? rows(exams) : <p className="card p-4 text-muted">{t("school.noExams")}</p>}
      </section>

      <section aria-labelledby="sc-all" className="flex flex-col gap-4">
        <h2 id="sc-all" className="text-lg font-bold">
          {t("school.assignments")}
        </h2>
        {groups.length === 0 && late.length === 0 && <p className="card p-6 text-center text-muted">{t("school.empty")}</p>}
        {groups.map((g) => (
          <div key={g.course?.id ?? "none"} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-bold">
              <span aria-hidden className="h-4 w-4 rounded-full border border-line" style={{ background: g.course?.color ?? "#ffffff" }} />
              {g.course?.name ?? t("school.noCourse")}
            </h3>
            {rows(g.entries)}
          </div>
        ))}
      </section>
    </main>
  );
}
