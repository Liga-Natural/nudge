// Everything the Home Screen widgets show, worked out in one go from a handful of plain rows.
// buildWidgetPayload() is pure (so it can be tested); loadWidgetRaw() is the only part that touches the database.

import { toEntries } from "./agenda";
import { courseLook } from "./course-look";
import { gradesCard, habitCircles, schoolCard } from "./dashboard";
import { featureOn } from "./features";
import { currentSchoolYear, isPastYear } from "./grades";
import { computeStreak } from "./streak";
import { addLocalDays, endOfLocalDay, startOfLocalDay } from "./time";
import { nextUp, splitViews } from "./today";
import { TYPE_EMOJI, type AgendaEntry, type Course, type GradeRowDb, type ItemRow, type OccurrenceRow, type Prefs } from "./types";
import { weekStrip } from "./widgets";

export type WidgetRaw = {
  tz: string;
  features: Record<string, boolean>;
  prefs: Prefs;
  occs: OccurrenceRow[];
  items: ItemRow[];
  /** Today's finished reminders, with their items. */
  doneToday: { occ: Pick<OccurrenceRow, "id" | "item_id" | "due_at">; item: ItemRow }[];
  courses: Course[];
  grades: GradeRowDb[];
  habitItems: { id: string; title: string }[];
  habitOccs: OccurrenceRow[];
};

export type WidgetItem = {
  id: string;
  title: string;
  dueAt: string;
  allDay: boolean;
  type: string;
  emoji: string;
  course: string | null;
  late: boolean;
  done: boolean;
};

export type WidgetPayload = {
  v: 1;
  generatedAt: string;
  tz: string;
  progress: { done: number; total: number };
  next: WidgetItem | null;
  today: { items: WidgetItem[]; open: number; late: number };
  school: { items: WidgetItem[]; missing: number };
  grades: { name: string; emoji: string; color: string; text: string }[];
  gradesTerm: string | null;
  week: { date: string; dow: number; count: number; today: boolean }[];
  habits: { title: string; emoji: string; done: boolean; streak: number }[];
};

/** How many things the widgets ever list, so the answer stays small. */
export const TODAY_ITEMS = 4;

export function buildWidgetPayload(raw: WidgetRaw, now: Date): WidgetPayload {
  const { tz } = raw;
  const current = currentSchoolYear(now, tz);
  const courseById = new Map(raw.courses.map((c) => [c.id, c]));
  const look = (id: string | null) => {
    const c = id ? courseById.get(id) : null;
    return c ? { name: c.name, ...courseLook(c, raw.prefs.course_emoji) } : null;
  };

  // Homework of a past school year is read-only history, not something to show on a widget.
  const items = raw.items.filter((i) => {
    if (i.type !== "homework" || !i.course_id) return true;
    const c = courseById.get(i.course_id);
    return !(c?.school_year && isPastYear(c.school_year, current));
  });
  const entries = toEntries(raw.occs, items);
  const views = splitViews(entries, now, tz);

  const toItem = (e: AgendaEntry, over: Partial<WidgetItem> = {}): WidgetItem => {
    const c = look(e.courseId);
    return {
      id: e.itemId,
      title: e.title,
      dueAt: e.dueAt,
      allDay: e.allDay,
      type: e.type,
      emoji: c ? c.emoji : (TYPE_EMOJI[e.type] ?? "✅"),
      course: c ? c.name : null,
      late: new Date(e.dueAt) < now && !(e.snoozedUntil && new Date(e.snoozedUntil) > now),
      done: false,
      ...over,
    };
  };

  // Today's list: late first, then by time, with the finished ones last (marked done).
  const open = [...views.late, ...views.today].map((e) => toItem(e));
  const finished = raw.doneToday.flatMap(({ occ, item }) => {
    const e = toEntries([{ id: occ.id, item_id: occ.item_id, due_at: occ.due_at, status: "done", snoozed_until: null, snooze_count: 0, done_at: null }], [item])[0];
    return e ? [toItem(e, { done: true, late: false })] : [];
  });
  const listed = [...open, ...finished].slice(0, TODAY_ITEMS);
  const doneCount = raw.doneToday.length;
  const todayTotal = views.today.length + doneCount;

  const nx = nextUp([...views.today, ...views.tomorrow, ...views.week], now);

  const sc = schoolCard(entries, now);
  const gc = gradesCard(raw.courses, raw.grades, current);

  const habitIds = raw.habitItems.map((h) => h.id);
  const streaks: Record<string, number> = {};
  for (const id of habitIds) {
    const days = raw.habitOccs.filter((o) => o.item_id === id).map((o) => ({ dueAt: o.due_at, status: o.status }));
    streaks[id] = computeStreak(days, now, tz).current;
  }
  const circles = habitCircles(raw.habitItems, raw.habitOccs, streaks, now, tz);

  return {
    v: 1,
    generatedAt: now.toISOString(),
    tz,
    progress: { done: doneCount, total: todayTotal },
    next: nx ? toItem(nx) : null,
    today: { items: listed, open: views.today.length, late: views.late.length },
    school: { items: sc.next.map((e) => toItem(e)), missing: sc.missing },
    grades: gc.rings.map((r) => {
      const l = look(r.courseId);
      return { name: r.name.replace(/^p\d+\s*/i, ""), emoji: l?.emoji ?? "🎓", color: l?.color ?? "#e4edff", text: r.text };
    }),
    gradesTerm: gc.termLabel,
    week: weekStrip(entries, now, tz).map((d) => ({ date: d.key, dow: d.dow, count: d.count, today: d.today })),
    habits: circles.map((h) => ({ title: h.title, emoji: h.emoji, done: h.done, streak: h.streak })),
  };
}

// ------------------------------------------------------------------------------------- database
type Admin = {
  from: (table: string) => {
    select: (cols: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};

const ITEM_COLUMNS =
  "id,space_id,type,title,notes,due_at,all_day,timezone,status,priority,amount_cents,currency,rrule,autopay,course_id,source,feed_id,location,subtype,link,hw_where";

/** One person's rows for the widgets. Every query names the user, because the server key bypasses row level security. */
export async function loadWidgetRaw(db: Admin, userId: string, now: Date): Promise<WidgetRaw> {
  const prof = await db.from("profiles").select("timezone,features,prefs").eq("user_id", userId).single();
  const p = (prof.data ?? {}) as { timezone?: string; features?: Record<string, boolean>; prefs?: Prefs };
  const tz = p.timezone ?? "America/New_York";
  const features = p.features ?? {};
  const dayStart = startOfLocalDay(now, tz).toISOString();
  const dayEnd = endOfLocalDay(now, tz).toISOString();
  const from = addLocalDays(now, tz, -90).toISOString();
  const to = endOfLocalDay(addLocalDays(now, tz, 7), tz).toISOString();

  const [occRes, doneRes, courseRes, gradeRes, habitRes] = await Promise.all([
    db.from("occurrences").select("id,item_id,due_at,status,snoozed_until,snooze_count,done_at").eq("user_id", userId).eq("status", "open").gte("due_at", from).lte("due_at", to).order("due_at").limit(400),
    db.from("occurrences").select("id,item_id,due_at").eq("user_id", userId).eq("status", "done").gte("due_at", dayStart).lte("due_at", dayEnd).limit(60),
    featureOn({ features }, "school") || featureOn({ features }, "grades") ? db.from("courses").select("id,name,color,school_year").eq("user_id", userId) : Promise.resolve({ data: [] }),
    featureOn({ features }, "grades")
      ? db.from("grades").select("id,course_id,title,score,out_of,percent,posted_at,source,comment,letter,points,term,school_year").eq("user_id", userId).order("posted_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] }),
    featureOn({ features }, "habits") ? db.from("items").select("id,title").eq("user_id", userId).eq("type", "habit").eq("status", "open") : Promise.resolve({ data: [] }),
  ]);
  const occs = (occRes.data ?? []) as OccurrenceRow[];
  const done = (doneRes.data ?? []) as Pick<OccurrenceRow, "id" | "item_id" | "due_at">[];
  const habitItems = (habitRes.data ?? []) as { id: string; title: string }[];

  const ids = [...new Set([...occs.map((o) => o.item_id), ...done.map((o) => o.item_id)])];
  const [itemRes, habitOccRes] = await Promise.all([
    ids.length ? db.from("items").select(ITEM_COLUMNS).eq("user_id", userId).in("id", ids) : Promise.resolve({ data: [] }),
    habitItems.length
      ? db.from("occurrences").select("id,item_id,due_at,status,snoozed_until,snooze_count,done_at").eq("user_id", userId).in("item_id", habitItems.map((h) => h.id)).gte("due_at", addLocalDays(now, tz, -120).toISOString()).lte("due_at", dayEnd).order("due_at")
      : Promise.resolve({ data: [] }),
  ]);
  const allItems = (itemRes.data ?? []) as ItemRow[];
  const byId = new Map(allItems.map((i) => [i.id, i]));
  return {
    tz,
    features,
    prefs: p.prefs ?? {},
    occs,
    items: allItems.filter((i) => i.status === "open"),
    doneToday: done.flatMap((o) => (byId.get(o.item_id) ? [{ occ: o, item: byId.get(o.item_id) as ItemRow }] : [])),
    courses: (courseRes.data ?? []) as Course[],
    grades: (gradeRes.data ?? []) as GradeRowDb[],
    habitItems,
    habitOccs: (habitOccRes.data ?? []) as OccurrenceRow[],
  };
}

