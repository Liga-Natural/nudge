import Link from "next/link";
import { CourseBadge } from "@/components/course-badge";
import { FeatureOff } from "@/components/feature-off";
import { courseLook } from "@/lib/course-look";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { currentSchoolYear, defaultTerm, isPastYear, isTerm, letterText, TERM_LABEL, termHeadline, yearOf } from "@/lib/grades";
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
    supabase.from("courses").select("id,name,color,school_year").eq("id", id).single(),
    supabase.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points,term,school_year").eq("course_id", id).order("posted_at", { ascending: false }).limit(200),
  ]);
  const course = courseRes.data as Course | null;
  if (!course) return notFound;
  const grades = (gradeRes.data ?? []) as GradeRowDb[];
  const look = courseLook(course, profile.prefs?.course_emoji);
  const current = currentSchoolYear(new Date(), profile.timezone);
  const year = yearOf(course, null, current);
  // A class from a past school year can be looked at, not changed.
  const readOnly = isPastYear(year, current);
  const forYear = grades.filter((g) => yearOf(g, course, current) === year);
  const rows = forYear.map((g) => ({ score: Number(g.score), out_of: Number(g.out_of), letter: g.letter, points: g.points, posted_at: g.posted_at, term: g.term }));
  const shown = defaultTerm(rows);
  const head = termHeadline(rows, shown);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <Link href="/grades" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
      <header className="card flex items-center justify-between gap-3 p-5">
        <CourseBadge emoji={look.emoji} color={look.color} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">{course.name}</h1>
          <p className="text-sm text-muted">
            {t("grades.average")} · {shown === "all" ? year : `${TERM_LABEL[shown]} · ${year}`}
          </p>
        </div>
        <p className="text-right text-4xl font-extrabold">
          {head === null ? "—" : head.kind === "letter" ? letterText(head.letter, head.points) : `${head.percent}%`}
          {head?.kind === "percent" && <span className="block text-base font-semibold text-muted">{head.letter}</span>}
        </p>
      </header>

      {readOnly && <p className="card p-4 text-sm text-muted">{t("grades.pastYear.note")}</p>}

      <section aria-labelledby="g-new" className="flex flex-col gap-2">
        <h2 id="g-new" className="text-lg font-bold">
          {t("grades.newest")}
        </h2>
        {forYear.length === 0 ? (
          <p className="card p-4 text-muted">{t("grades.noGrades")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {forYear.map((g) => (
              <li key={g.id} className="card flex items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{g.title}</span>
                  <span className="block text-sm text-muted">
                    {isTerm(g.term) ? `${TERM_LABEL[g.term]} · ` : ""}
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
                  {g.source === "manual" && !readOnly && <GradeRowActions id={g.id} title={g.title} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!readOnly && <GradeForm courseId={course.id} />}
    </main>
  );
}
