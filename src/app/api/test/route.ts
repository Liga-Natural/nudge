import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Test-only helper for the automated browser tests: reset the pretend database, or fill it.
// In a normal build this always answers 404 and none of the fake code is included.
export async function POST(request: Request) {
  if (process.env.NUDGE_E2E !== "1") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { store, resetStore } = await import("@/lib/supabase/fake");
  const body = (await request.json().catch(() => ({}))) as {
    action?: "reset" | "seed" | "needs_sql";
    onboarded?: boolean;
    language?: "en" | "es";
    features?: Record<string, boolean>;
    /** Overrides for the profile row, e.g. { urgent_override: false }. */
    profile?: Record<string, unknown>;
    items?: { id?: string; occId?: string; title: string; type?: string; dueAt: string; allDay?: boolean; amountCents?: number; autopay?: boolean; rrule?: string; location?: string; subtype?: string; courseId?: string; occurrences?: { dueAt: string; status?: string }[] }[];
    /** Extra rows for other tables, e.g. { courses: [...], grades: [...] }. */
    extra?: Record<string, Record<string, unknown>[]>;
  };
  resetStore();
  const s = store();
  if (body.action === "needs_sql") s.needsSql = true;
  if (body.action === "seed") {
    const spaceId = crypto.randomUUID();
    s.tables.profiles.push({
      user_id: s.userId, timezone: "America/New_York", language: body.language ?? "en", mode: "full", track_types: [],
      nudge_style: "on_time", morning_enabled: true, morning_time: "08:00:00", quiet_start: "22:00:00", quiet_end: "07:00:00",
      urgent_override: true, type_switches: {}, features: body.features ?? {}, prefs: {}, onboarded: body.onboarded ?? true, ...(body.profile ?? {}),
    });
    s.tables.spaces.push({ id: spaceId, user_id: s.userId, name: "Personal", emoji: "🏠", is_default: true, notifications_enabled: true, sort_order: 0 });
    for (const it of body.items ?? []) {
      const id = it.id ?? crypto.randomUUID();
      s.tables.items.push({
        id, user_id: s.userId, space_id: spaceId, type: it.type ?? "task", title: it.title, notes: null, due_at: it.dueAt,
        all_day: it.allDay ?? false, timezone: "America/New_York", status: "open", priority: 0, amount_cents: it.amountCents ?? null,
        currency: "USD", rrule: it.rrule ?? null, autopay: it.autopay ?? false, course_id: it.courseId ?? null,
        location: it.location ?? null, subtype: it.subtype ?? null,
      });
      for (const o of it.occurrences ?? [{ dueAt: it.dueAt }]) {
        s.tables.occurrences.push({ id: it.occId ?? crypto.randomUUID(), user_id: s.userId, item_id: id, due_at: o.dueAt, status: o.status ?? "open", snoozed_until: null, snooze_count: 0, done_at: null });
      }
    }
    for (const [table, rows] of Object.entries(body.extra ?? {})) {
      if (!s.tables[table]) continue;
      for (const r of rows) s.tables[table].push({ id: crypto.randomUUID(), user_id: s.userId, created_at: new Date().toISOString(), ...r });
    }
  }
  return NextResponse.json({ ok: true });
}
