import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clientKey, rateLimit, tooMany } from "@/lib/rate-limit";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_NAME } from "@/lib/config";
import { checkVapidSetup, describePushFailure } from "@/lib/push-errors";

export const dynamic = "force-dynamic";

// "Send test notification now": sends one real push to every phone signed up for this person and
// says exactly what happened, including the push service's own answer. Every try is written to the
// Delivery log.
export async function POST() {
  const limited = rateLimit(`push-test:${clientKey(await headers())}`, 6, 60_000);
  if (!limited.ok) return tooMany(limited.retryAfterSeconds);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const log = async (status: "sent" | "failed" | "no_phone", error: string | null, httpStatus: number | null) => {
    try {
      const admin = createAdminClient();
      await admin.rpc("dispatch_log_attempt", {
        p_user_id: user.id,
        p_send_id: null,
        p_kind: "test",
        p_title: "Test notification",
        p_status: status,
        p_error: error,
        p_http_status: httpStatus,
      });
    } catch {
      // The log is a convenience; the test result below is what matters.
    }
  };

  const setupProblem = checkVapidSetup({ publicKey, privateKey, subject });
  if (setupProblem) {
    await log("failed", setupProblem, null);
    return NextResponse.json({ error: setupProblem }, { status: 500 });
  }
  webpush.setVapidDetails(subject!, publicKey!, privateKey!);

  const { data: subs, error } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (error) {
    return NextResponse.json({ error: "We couldn't look up your phone. Try again in a minute." }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    const message = "No phone is turned on yet. Tap “Turn on notifications” first.";
    await log("no_phone", message, null);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const payload = JSON.stringify({
    title: `${APP_NAME} works 🎉`,
    body: "This is your test notification. You're all set.",
    url: "/",
    tag: "test",
  });

  let sent = 0;
  let lastError = "";
  let lastStatus: number | null = null;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        TTL: 60,
        urgency: "high",
        timeout: 10000,
      });
      sent++;
    } catch (e) {
      const err = e as { statusCode?: number; message?: string; body?: string };
      lastStatus = err.statusCode ?? null;
      lastError = describePushFailure({ status: err.statusCode, message: err.message, body: err.body });
      if (err.statusCode === 404 || err.statusCode === 410) {
        // The phone removed its subscription; clean it up.
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  if (sent === 0) {
    await log("failed", lastError, lastStatus);
    return NextResponse.json({ error: lastError, status: lastStatus }, { status: 502 });
  }
  await log("sent", null, null);
  return NextResponse.json({ ok: true, sent });
}
