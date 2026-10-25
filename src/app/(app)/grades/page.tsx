import Link from "next/link";
import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { classHeadline, letterText } from "@/lib/grades";
import { makeT } from "@/lib/i18n";
import type { Course, GradeRowDb } from "@/lib/types";

export default async function GradesPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  if (!featureOn(profile, "grades")) return <FeatureOff lang={profile.language} name="feature.grades" body="feature.grades.body" />;

  const [courseRes, gradeRes] = await Promise.all([
    supabase.from("courses").select("id,name,color").order("created_at"),
    supabase.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points").order("posted_at", { ascending: false }).limit(500),
  ]);
  const courses = (courseRes.data ?? []) as Course[];
  const grades = (gradeRes.data ?? []) as GradeRowDb[];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("grades.title.pre")} accent={t("grades.title.accent")} post="" />
      {courses.length === 0 ? (
        <p className="card p-6 text-center text-muted">{t("grades.noClasses")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((c) => {
            const mine = grades.filter((g) => g.course_id === c.id);
            const head = classHeadline(mine.map((g) => ({ score: Number(g.score), out_of: Number(g.out_of), letter: g.letter, points: g.points, posted_at: g.posted_at })));
            return (
              <li key={c.id} className="list-none">
                <Link href={`/grades/${c.id}`} className="card flex items-center gap-3 p-4">
                  <span aria-hidden className="h-10 w-10 flex-none rounded-2xl border border-line" style={{ background: c.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{c.name}</span>
                    <span className="block text-sm text-muted">{mine.length === 0 ? t("grades.none") : t("grades.count", { n: mine.length })}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-2xl font-extrabold">{head === null ? "—" : head.kind === "letter" ? letterText(head.letter, head.points) : `${head.percent}%`}</span>
                    {head?.kind === "percent" && <span className="block text-sm font-semibold text-muted">{head.letter}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
