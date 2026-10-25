import Link from "next/link";
import { SpaceChips } from "@/components/space-chips";
import { TodayView } from "@/components/today-view";
import { filterBySpace } from "@/lib/agenda";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { featureOn } from "@/lib/features";
import { loadAgenda, spaceLabel } from "@/lib/queries";
import { gradesCard, habitCircles, type CardId } from "@/lib/dashboard";
import { withLooks } from "@/lib/course-look";
import { currentSchoolYear } from "@/lib/grades";
import { computeStreak } from "@/lib/streak";
import { weekDots } from "@/lib/today";
import { addLocalDays, endOfLocalDay, startOfLocalDay } from "@/lib/time";
import type { Course, GradeRowDb, OccurrenceRow } from "@/lib/types";

// The shortcut row under the greeting: only the features that are switched on.
const MORE = [
  ["payments", "/payments", "💳", "feature.payments"],
  ["school", "/school", "🎓", "feature.school"],
  ["grades", "/grades", "📝", "feature.grades"],
  ["habits", "/habits", "🌱", "feature.habits"],
  ["work", "/lists/work", "💼", "feature.work"],
  ["birthdays", "/lists/birthdays", "🎂", "feature.birthdays"],
  ["renewals", "/lists/renewals", "🪪", "feature.renewals"],
  ["inbox", "/import", "📥", "feature.inbox"],
  ["updates", "/updates", "🗞️", "feature.updates"],
] as const;

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ space?: string }> }) {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const tz = profile.timezone;
  const now = new Date();
  const sp = (await searchParams).space ?? null;

  const reach = endOfLocalDay(addLocalDays(now, tz, 14), tz); // two weeks, for the "Coming up" card
  const dayStart = startOfLocalDay(now, tz);
  const on = { school: featureOn(profile, "school"), grades: featureOn(profile, "grades"), money: featureOn(profile, "payments"), habits: featureOn(profile, "habits") };
  // Two rounds, each with its calls side by side: the agenda, how many of today's are done, and what the cards need.
  const [{ entries: all, spaces }, doneRes, courseRes, gradeRes, habitRes, feedRes] = await Promise.all([
    loadAgenda(supabase, { from: addLocalDays(now, tz, -90), to: reach }),
    supabase.from("occurrences").select("id").eq("status", "done").gte("due_at", dayStart.toISOString()).lte("due_at", endOfLocalDay(now, tz).toISOString()),
    on.school || on.grades ? supabase.from("courses").select("id,name,color,school_year") : Promise.resolve({ data: [] }),
    on.grades
      ? supabase.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points,term,school_year").order("posted_at", { ascending: false }).limit(600)
      : Promise.resolve({ data: [] }),
    on.habits ? supabase.from("items").select("id,title").eq("type", "habit").eq("status", "open") : Promise.resolve({ data: [] }),
    on.money ? supabase.from("calendar_feeds").select("kind,enabled,last_synced_at,last_error") : Promise.resolve({ data: [] }),
  ]);
  const spaceId = spaces.some((s) => s.id === sp) ? sp : null;
  const entries = filterBySpace(all, spaceId);
  const rawCourses = (courseRes.data ?? []) as Course[];
  const looked = withLooks(rawCourses, profile.prefs?.course_emoji);
  const courses = Object.fromEntries(looked.map((c) => [c.id, { name: c.name, color: c.color, emoji: c.emoji }]));

  // Streaks and the week's dots for habits that show up on the list (and today's circles for the habits card).
  const habitItems = (habitRes.data ?? []) as { id: string; title: string }[];
  const habitIds = [...new Set([...entries.filter((e) => e.type === "habit").map((e) => e.itemId), ...habitItems.map((h) => h.id)])];
  const habits: Record<string, { streak: number; dots: ReturnType<typeof weekDots> }> = {};
  let circles: ReturnType<typeof habitCircles> = [];
  if (habitIds.length) {
    const { data } = await supabase
      .from("occurrences")
      .select("id,item_id,due_at,status,snoozed_until,snooze_count,done_at")
      .in("item_id", habitIds)
      .gte("due_at", addLocalDays(now, tz, -120).toISOString())
      .lte("due_at", endOfLocalDay(now, tz).toISOString())
      .order("due_at");
    const occs = (data ?? []) as OccurrenceRow[];
    for (const id of habitIds) {
      const days = occs.filter((o) => o.item_id === id).map((o) => ({ dueAt: o.due_at, status: o.status }));
      habits[id] = { streak: computeStreak(days, now, tz).current, dots: weekDots(days, now, tz) };
    }
    circles = habitCircles(habitItems, occs, Object.fromEntries(Object.entries(habits).map(([id, h]) => [id, h.streak])), now, tz);
  }

  const available: CardId[] = [...(on.school ? (["school"] as const) : []), ...(on.grades ? (["grades"] as const) : []), ...(on.money ? (["money"] as const) : []), ...(on.habits ? (["habits"] as const) : []), "coming"];
  const bills = ((feedRes.data ?? []) as { kind?: string; enabled?: boolean; last_synced_at: string | null; last_error: string | null }[]).find((f) => f.kind === "bills" && f.enabled !== false);
  const joker = bills ? { state: bills.last_error ? ("error" as const) : ("ok" as const), at: bills.last_synced_at } : null;
  const gradeCard = on.grades ? gradesCard(rawCourses, (gradeRes.data ?? []) as GradeRowDb[], currentSchoolYear(now, tz)) : null;

  const spaceNames = Object.fromEntries(spaces.map((s) => [s.id, spaceLabel(s, t("space.personal"))]));
  const showSpaces = profile.mode === "full";
  const moreLinks = MORE.filter(([k]) => featureOn(profile, k));

  return (
    <TodayView
      entries={entries}
      nowMs={now.getTime()}
      doneToday={(doneRes.data ?? []).length}
      firstName={profile.prefs?.first_name?.trim() || null}
      spaceNames={spaceNames}
      showSpaces={showSpaces}
      courses={courses}
      bento={{ available, layout: profile.prefs?.dash, grades: gradeCard, habits: circles, joker }}
      habits={habits}
      dayOrder={profile.prefs?.day_order ?? {}}
      simple={profile.mode === "simple"}
      gear={
        profile.mode === "simple" ? (
          <Link href="/settings" aria-label={t("nav.settings")} className="btn-quiet flex-none">
            <span aria-hidden>⚙️</span>
          </Link>
        ) : null
      }
      top={
        <>
          {moreLinks.length > 0 && (
            <nav aria-label={t("more.title")} className="-mx-4 flex gap-2 overflow-x-auto px-4">
              {moreLinks.map(([k, href, emoji, label]) => (
                <Link key={k} href={href} className="btn-quiet flex-none">
                  <span aria-hidden>{emoji}</span> {t(label)}
                </Link>
              ))}
            </nav>
          )}
          {showSpaces && <SpaceChips spaces={spaces} current={spaceId} base="/" allLabel={t("space.all")} personalLabel={t("space.personal")} />}
        </>
      }
    />
  );
}
