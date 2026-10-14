import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clientKey, rateLimit, tooMany } from "@/lib/rate-limit";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/config";

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
  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json(
      { error: "Notification keys aren't set up on the server yet." },
      { status: 500 },
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");
  if (error) {
    return NextResponse.json({ error: "We couldn't look up your phone." }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json(
      { error: "No phone is turned on yet. Tap “Turn on notifications” first." },
      { status: 400 },
    );
  }

  const payload = JSON.stringify({
    title: `${APP_NAME} works 🎉`,
    body: "This is your test notification. You're all set.",
    url: "/",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60, timeout: 10000 },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The phone removed its subscription; clean it up.
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  if (sent === 0) {
    return NextResponse.json(
      { error: "The notification couldn't be delivered. Turn notifications on again." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, sent });
}
