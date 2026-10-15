import { NextResponse } from "next/server";
import { sendAlertEmail } from "@/lib/alert-email";
import { isClockRequest } from "@/lib/cron-auth";
import { runDispatch, type Rpc } from "@/lib/dispatch";
import { judgeHealth } from "@/lib/health";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWebPushSender } from "@/lib/web-push-sender";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

// Runs once a day from Vercel. (1) Is the database awake and is the minute clock ticking?
// If not, email the owner. (2) Catch-up: send anything the minute clock missed.
export async function GET(request: Request) {
  if (!isClockRequest(request)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const now = new Date();
  let databaseError: string | null = null;
  let lastClockRun: Date | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let notSetUp: string | null = null;

  try {
    admin = createAdminClient();
    const probe = await admin
      .from("dispatch_log")
      .select("ran_at")
      .order("ran_at", { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(6000));
    if (probe.error) {
      // A missing table means the setup SQL has not been run yet. That is not an outage.
      if (["PGRST205", "42P01", "42501"].includes(probe.error.code)) notSetUp = "The setup SQL has not been run yet.";
      else databaseError = probe.error.message || "no answer";
    } else if (probe.data?.[0]) lastClockRun = new Date(probe.data[0].ran_at as string);
  } catch (e) {
    const message = e instanceof Error ? e.message : "no answer";
    // A missing key is a setup problem on our side, not a database outage.
    if (/SUPABASE_SECRET_KEY/.test(message)) notSetUp = message;
    else databaseError = message;
  }
  if (notSetUp) return NextResponse.json({ ok: false, notSetUp });

  const verdict = judgeHealth({ databaseError, lastClockRun, now });
  let emailed = false;
  for (const p of verdict.problems) emailed = (await sendAlertEmail(p.subject, p.text)) || emailed;

  let catchUp: unknown = null;
  if (admin && !databaseError) {
    try {
      const client = admin;
      const rpc: Rpc = async (name, args) => {
        const { data, error } = await client.rpc(name, args);
        return { data, error: error ? { message: error.message } : null };
      };
      catchUp = await runDispatch({
        rpc,
        send: createWebPushSender(),
        now,
        windowMinutes: 36 * 60,
        minAgeMinutes: 5,
        label: "missed",
        withSummaries: false,
        withTopUp: true,
      });
    } catch (e) {
      console.error("catch-up failed:", e instanceof Error ? e.message : e);
      catchUp = { error: true };
    }
  }
  return NextResponse.json({ ok: verdict.ok, emailed, catchUp });
}
