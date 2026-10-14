import type { AgendaEntry, ItemRow, OccurrenceRow } from "./types";
import { addLocalDays, endOfLocalDay, localDateKey, startOfLocalDay } from "./time";

export function toEntries(occs: OccurrenceRow[], items: ItemRow[]): AgendaEntry[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: AgendaEntry[] = [];
  for (const o of occs) {
    const i = byId.get(o.item_id);
    if (!i || i.status === "archived") continue;
    out.push({
      occId: o.id,
      itemId: i.id,
      title: i.title,
      type: i.type,
      dueAt: o.due_at,
      allDay: i.all_day,
      amountCents: i.amount_cents,
      currency: i.currency,
      spaceId: i.space_id,
      snoozedUntil: o.snoozed_until,
      recurring: !!i.rrule,
      priority: i.priority,
    });
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export type TodayGroups = { late: AgendaEntry[]; today: AgendaEntry[]; next: AgendaEntry[] };

/** Late = open and before today. Today = today. Next 7 days = tomorrow through 7 days out. */
export function groupToday(entries: AgendaEntry[], now: Date, tz: string): TodayGroups {
  const dayStart = startOfLocalDay(now, tz);
  const dayEnd = endOfLocalDay(now, tz);
  const weekEnd = endOfLocalDay(addLocalDays(now, tz, 7), tz);
  const groups: TodayGroups = { late: [], today: [], next: [] };
  for (const e of entries) {
    const due = new Date(e.dueAt);
    // A snoozed item sits out until its snooze ends (then it shows where its due time says).
    if (e.snoozedUntil && new Date(e.snoozedUntil) > now && due < dayStart) {
      groups.today.push(e);
    } else if (due < dayStart) groups.late.push(e);
    else if (due <= dayEnd) groups.today.push(e);
    else if (due <= weekEnd) groups.next.push(e);
  }
  return groups;
}

/** Groups by local calendar day (YYYY-MM-DD), in order. */
export function groupByDay(entries: AgendaEntry[], tz: string): { day: string; entries: AgendaEntry[] }[] {
  const map = new Map<string, AgendaEntry[]>();
  for (const e of entries) {
    const key = localDateKey(new Date(e.dueAt), tz);
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, entries: list }));
}

export function filterBySpace(entries: AgendaEntry[], spaceId: string | null): AgendaEntry[] {
  return spaceId ? entries.filter((e) => e.spaceId === spaceId) : entries;
}
