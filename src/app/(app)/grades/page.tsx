import Link from "next/link";
import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { currentSchoolYear, defaultTerm, isPastYear, isSchoolYear, isTerm, letterText, shortGrade, TERM_CHIPS, TERM_LABEL, termHeadline, trend, yearOf, type Term } from "@/lib/grades";
import { makeT } from "@/lib/i18n";
import type { Course, GradeRowDb } from "@/lib/types";

const chip = (on: boolean) =>
  `inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold ${on ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-ink"}`;

export default async function GradesPage({ searchParams }: { searchParams: Promise<{ year?: string; term?: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  if (!featureOn(profile, "grades")) return <FeatureOff lang={profile.language} name="feature.grades" body="feature.grades.body" />;

  const [courseRes, gradeRes] = await Promise.all([
    supabase.from("courses").select("id,name,color,school_year").order("created_at"),
    supabase.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points,term,school_year").order("posted_at", { ascending: false }).limit(1000),
  ]);
  const courses = (courseRes.data ?? []) as Course[];
  const grades = (gradeRes.data ?? []) as GradeRowDb[];

  const current = currentSchoolYear(new Date(), profile.timezone);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const yearOfGrade = (g: GradeRowDb) => yearOf(g, g.course_id ? byId.get(g.course_id) : null, current);
  // Every year that has a class or a grade, newest first, with this year always there.
  const years = [...new Set([current, ...courses.map((c) => yearOf(c, null, current)), ...grades.map(yearOfGrade)])].sort().reverse();

  const toRow = (g: GradeRowDb) => ({ score: Number(g.score), out_of: Number(g.out_of), letter: g.letter, points: g.points, posted_at: g.posted_at, term: g.term });
  const sp = await searchParams;
  const year = isSchoolYear(sp.year) && years.includes(sp.year) ? sp.year : current;
  const past = isPastYear(year, current);
  const inYear = courses.filter((c) => yearOf(c, null, current) === year || grades.some((g) => g.course_id === c.id && yearOfGrade(g) === year));
  const yearGrades = grades.filter((g) => yearOfGrade(g) === year);

  const term: Term | "all" = isTerm(sp.term) ? sp.term : sp.term === "all" ? "all" : defaultTerm(yearGrades.map(toRow));
  const href = (y: string, k: Term | "all") => `/grades?year=${y}&term=${k}`;
  const pastYears = years.filter((y) => isPastYear(y, current));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("grades.title.pre")} accent={t("grades.title.accent")} post="" />

      <nav aria-label={t("grades.year")} className="flex flex-wrap gap-2">
        {years.map((y) => (
          <Link key={y} href={href(y, "all")} aria-current={y === year ? "page" : undefined} className={chip(y === year)}>
            {y}
          </Link>
        ))}
      </nav>
      {past && <p className="card p-4 text-sm text-muted">{t("grades.pastYear.note")}</p>}

      <nav aria-label="Quarter" className="flex flex-wrap gap-2">
        <Link href={href(year, "all")} aria-current={term === "all" ? "true" : undefined} className={chip(term === "all")}>
          {t("grades.term.all")}
        </Link>
        {TERM_CHIPS.map((k) => (
          <Link key={k} href={href(year, k)} aria-current={term === k ? "true" : undefined} className={chip(term === k)}>
            {TERM_LABEL[k]}
          </Link>
        ))}
      </nav>

      {inYear.length === 0 ? (
        <p className="card p-6 text-center text-muted">{courses.length === 0 ? t("grades.noClasses") : t("grades.noClassesYear")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {inYear.map((c) => {
            const mine = yearGrades.filter((g) => g.course_id === c.id).map(toRow);
            const head = termHeadline(mine, term);
            const steps = trend(mine);
            return (
              <li key={c.id} className="list-none">
                <Link href={`/grades/${c.id}`} className="card flex items-center gap-3 p-4">
                  <span aria-hidden className="h-10 w-10 flex-none rounded-2xl border border-line" style={{ background: c.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{c.name}</span>
                    <span className="block text-sm text-muted">{mine.length === 0 ? t("grades.none") : t("grades.count", { n: mine.length })}</span>
                    {steps.length > 0 && (
                      <span role="img" className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted" aria-label={`${t("grades.trend")}: ${steps.map((s) => `${TERM_LABEL[s.term]} ${s.text}`).join(", ")}`}>
                        {TERM_CHIPS.map((k) => {
                          const text = shortGrade(termHeadline(mine, k));
                          return (
                            <span key={k} aria-hidden className={`rounded-full px-1.5 py-0.5 ${k === term ? "bg-accent-soft text-ink" : ""}`}>
                              {text ?? "·"}
                            </span>
                          );
                        })}
                        {steps.length > 1 && (
                          <span aria-hidden className="ml-1 text-ink">
                            {steps.map((s) => s.text).join(" → ")}
                          </span>
                        )}
                      </span>
                    )}
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

      {!past && pastYears.length > 0 && (
        <section aria-labelledby="g-past" className="flex flex-col gap-2">
          <h2 id="g-past" className="text-lg font-bold">
            {t("grades.pastYears")}
          </h2>
          <ul className="flex flex-col gap-2">
            {pastYears.map((y) => (
              <li key={y} className="list-none">
                <Link href={href(y, "all")} className="card flex items-center justify-between p-3">
                  <span className="font-semibold">{y}</span>
                  <span className="text-sm text-muted">{t("grades.pastYear.classes", { n: courses.filter((c) => yearOf(c, null, current) === y).length })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
