import { NextResponse } from "next/server";
import { isClockRequest } from "@/lib/cron-auth";
import { runDispatch, type Rpc } from "@/lib/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWebPushSender } from "@/lib/web-push-sender";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

// Called every minute by Supabase Cron. Sends whatever is due, exactly once.
export async function POST(request: Request) {
  if (!isClockRequest(request)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const rpc: Rpc = async (name, args) => {
      const { data, error } = await admin.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    };
    const result = await runDispatch({ rpc, send: createWebPushSender(), now: new Date() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("dispatch failed:", e instanceof Error ? e.message : e);
    // The next minute tries again; nothing was lost.
    return NextResponse.json({ ok: false, error: "The clock hit a problem. It will try again next minute." }, { status: 500 });
  }
}
