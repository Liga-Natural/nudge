import Link from "next/link";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { classHeadline, letterText } from "@/lib/grades";
import { makeT, type Key } from "@/lib/i18n";
import { formatDay } from "@/lib/time";
import type { Course, GradeRowDb } from "@/lib/types";
import { GradeForm, GradeRowActions } from "./grade-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function ClassGradesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  if (!featureOn(profile, "grades")) return <FeatureOff lang={profile.language} name="feature.grades" body="feature.grades.body" />;
  const { id } = await params;
  const notFound = (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-8">
      <Link href="/grades" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
      <p className="card p-6">{t("item.notFound")}</p>
    </main>
  );
  if (!UUID.test(id)) return notFound;

  const [courseRes, gradeRes] = await Promise.all([
    supabase.from("courses").select("id,name,color").eq("id", id).single(),
    supabase.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points").eq("course_id", id).order("posted_at", { ascending: false }).limit(200),
  ]);
  const course = courseRes.data as Course | null;
  if (!course) return notFound;
  const grades = (gradeRes.data ?? []) as GradeRowDb[];
  const head = classHeadline(grades.map((g) => ({ score: Number(g.score), out_of: Number(g.out_of), letter: g.letter, points: g.points, posted_at: g.posted_at })));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <Link href="/grades" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
      <header className="card flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold">{course.name}</h1>
          <p className="text-sm text-muted">{t("grades.average")}</p>
        </div>
        <p className="text-right text-4xl font-extrabold">
          {head === null ? "—" : head.kind === "letter" ? letterText(head.letter, head.points) : `${head.percent}%`}
          {head?.kind === "percent" && <span className="block text-base font-semibold text-muted">{head.letter}</span>}
        </p>
      </header>

      <section aria-labelledby="g-new" className="flex flex-col gap-2">
        <h2 id="g-new" className="text-lg font-bold">
          {t("grades.newest")}
        </h2>
        {grades.length === 0 ? (
          <p className="card p-4 text-muted">{t("grades.noGrades")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {grades.map((g) => (
              <li key={g.id} className="card flex items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{g.title}</span>
                  <span className="block text-sm text-muted">
                    {formatDay(new Date(g.posted_at), profile.timezone, profile.language)} · {t(`grades.source.${g.source}` as Key)}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-2 text-right">
                  <span>
                    {g.letter ? (
                      <span className="block font-bold">{letterText(g.letter, g.points)}</span>
                    ) : (
                      <>
                        <span className="block font-bold">
                          {num(Number(g.score))}/{num(Number(g.out_of))}
                        </span>
                        <span className="block text-sm text-muted">{num(Number(g.percent))}%</span>
                      </>
                    )}
                  </span>
                  {g.source === "manual" && <GradeRowActions id={g.id} title={g.title} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <GradeForm courseId={course.id} />
    </main>
  );
}
