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
    items?: { title: string; type?: string; dueAt: string; allDay?: boolean; amountCents?: number; autopay?: boolean }[];
  };
  resetStore();
  const s = store();
  if (body.action === "needs_sql") s.needsSql = true;
  if (body.action === "seed") {
    const spaceId = crypto.randomUUID();
    s.tables.profiles.push({
      user_id: s.userId, timezone: "America/New_York", language: body.language ?? "en", mode: "full", track_types: [],
      nudge_style: "on_time", morning_enabled: true, morning_time: "08:00:00", quiet_start: "22:00:00", quiet_end: "07:00:00",
      urgent_override: true, type_switches: {}, features: body.features ?? {}, onboarded: body.onboarded ?? true,
    });
    s.tables.spaces.push({ id: spaceId, user_id: s.userId, name: "Personal", emoji: "🏠", is_default: true, notifications_enabled: true, sort_order: 0 });
    for (const it of body.items ?? []) {
      const id = crypto.randomUUID();
      s.tables.items.push({
        id, user_id: s.userId, space_id: spaceId, type: it.type ?? "task", title: it.title, notes: null, due_at: it.dueAt,
        all_day: it.allDay ?? false, timezone: "America/New_York", status: "open", priority: 0, amount_cents: it.amountCents ?? null,
        currency: "USD", rrule: null, autopay: it.autopay ?? false, course_id: null,
      });
      s.tables.occurrences.push({ id: crypto.randomUUID(), user_id: s.userId, item_id: id, due_at: it.dueAt, status: "open", snoozed_until: null, snooze_count: 0, done_at: null });
    }
  }
  return NextResponse.json({ ok: true });
}
