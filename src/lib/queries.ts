import type { Db } from "@/lib/supabase/server";
import { toEntries } from "./agenda";
import { currentSchoolYear, isPastYear } from "./grades";
import type { AgendaEntry, ItemRow, OccurrenceRow, Space } from "./types";

export const ITEM_COLUMNS =
  "id,space_id,type,title,notes,due_at,all_day,timezone,status,priority,amount_cents,currency,rrule,autopay,course_id,source,feed_id,location,subtype,link,hw_where";
const OCC_COLUMNS = "id,item_id,due_at,status,snoozed_until,snooze_count,done_at";

export async function loadSpaces(supabase: Db): Promise<Space[]> {
  const { data } = await supabase.from("spaces").select("id,name,emoji,is_default,notifications_enabled,sort_order").order("sort_order").order("created_at");
  return (data ?? []) as Space[];
}

/** Open occurrences between two moments, with their items. Three small queries, run together where possible. */
export async function loadAgenda(
  supabase: Db,
  range: { from?: Date; to: Date },
): Promise<{ entries: AgendaEntry[]; spaces: Space[] }> {
  let q = supabase.from("occurrences").select(OCC_COLUMNS).eq("status", "open").lte("due_at", range.to.toISOString());
  if (range.from) q = q.gte("due_at", range.from.toISOString());
  const [occRes, spaces] = await Promise.all([q.order("due_at").limit(400), loadSpaces(supabase)]);
  const occs = (occRes.data ?? []) as OccurrenceRow[];
  if (!occs.length) return { entries: [], spaces };
  const ids = [...new Set(occs.map((o) => o.item_id))];
  const { data: items } = await supabase.from("items").select(ITEM_COLUMNS).in("id", ids);
  const open = ((items ?? []) as ItemRow[]).filter((i) => i.status === "open");
  return { entries: toEntries(occs, await withoutPastYears(supabase, open)), spaces };
}

/** Homework of a class from a past school year stays in Grades (read-only) but leaves Today, Upcoming and the lists. */
async function withoutPastYears(supabase: Db, items: ItemRow[]): Promise<ItemRow[]> {
  const courseIds = [...new Set(items.filter((i) => i.type === "homework" && i.course_id).map((i) => i.course_id as string))];
  if (!courseIds.length) return items;
  const { data } = await supabase.from("courses").select("id,school_year").in("id", courseIds);
  const current = currentSchoolYear(new Date(), "America/New_York");
  const past = new Set(((data ?? []) as { id: string; school_year: string | null }[]).filter((c) => c.school_year && isPastYear(c.school_year, current)).map((c) => c.id));
  return past.size ? items.filter((i) => !(i.type === "homework" && i.course_id && past.has(i.course_id))) : items;
}

export const spaceLabel = (s: Space, personal: string) => (s.is_default && s.name === "Personal" ? personal : s.name);
