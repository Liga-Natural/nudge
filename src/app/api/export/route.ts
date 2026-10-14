import { NextResponse } from "next/server";
import { clientKey, rateLimit, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Stop spreadsheets from running a typed "=..." as a formula.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// "Export all data": everything the signed-in person has, as JSON or a CSV of their items.
export async function GET(request: Request) {
  const limited = rateLimit(`export:${clientKey(request.headers)}`, 10, 60_000);
  if (!limited.ok) return tooMany(limited.retryAfterSeconds);

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const [profile, spaces, items, reminders, occurrences, events] = await Promise.all([
    supabase.from("profiles").select("*"),
    supabase.from("spaces").select("*"),
    supabase.from("items").select("*").order("created_at"),
    supabase.from("reminders").select("*"),
    supabase.from("occurrences").select("*").order("due_at"),
    supabase.from("item_events").select("*").order("created_at"),
  ]);
  const failed = [profile, spaces, items, reminders, occurrences, events].find((r) => r.error);
  if (failed) return NextResponse.json({ error: "We couldn't read your data. Try again." }, { status: 500 });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const cols = ["title", "type", "status", "due_at", "all_day", "amount_cents", "currency", "rrule", "notes", "created_at"];
    const rows = (items.data ?? []) as Record<string, unknown>[];
    const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
    return new Response(body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="nudge-items-${stamp}.csv"` },
    });
  }
  const json = {
    exportedAt: new Date().toISOString(),
    profile: profile.data?.[0] ?? null,
    spaces: spaces.data,
    items: items.data,
    reminders: reminders.data,
    occurrences: occurrences.data,
    history: events.data,
  };
  return new Response(JSON.stringify(json, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="nudge-export-${stamp}.json"` },
  });
}
