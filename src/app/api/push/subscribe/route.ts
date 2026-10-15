import { NextResponse } from "next/server";
import { clientKey, rateLimit, tooMany } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: Request) {
  const limited = rateLimit(`push-sub:${clientKey(request.headers)}`, 30, 60_000);
  if (!limited.ok) return tooMany(limited.retryAfterSeconds);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That subscription looked wrong." }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("push subscribe failed:", error.code, error.message);
    return NextResponse.json({ error: "We couldn't save this phone. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
