import type { Rpc } from "@/lib/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWidgetRaw, buildWidgetPayload } from "@/lib/widget-data";
import { handleWidget } from "@/lib/widget-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// One read-only summary for the Scriptable Home Screen widgets, with a widget token. See docs/WIDGETS.md.
export async function GET(request: Request): Promise<Response> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ ok: false, code: "not_configured", error: "Nudge's server key is not set up (SUPABASE_SECRET_KEY), so widgets cannot work yet." }, { status: 503 });
  }
  const rpc: Rpc = async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  };
  return handleWidget(request, {
    rpc,
    clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown",
    load: async (userId, now) => buildWidgetPayload(await loadWidgetRaw(admin, userId, now), now),
  });
}
