import { handleInbox } from "@/lib/inbox-handler";
import type { Rpc } from "@/lib/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Bring school work in from an agent or a script, with a personal access token.
// Documented in docs/INBOX_API.md.
async function handle(request: Request): Promise<Response> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json(
      { ok: false, code: "not_configured", error: "Nudge's server key is not set up (SUPABASE_SECRET_KEY), so the inbox cannot work yet." },
      { status: 503 },
    );
  }
  const rpc: Rpc = async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  };
  return handleInbox(request, {
    rpc,
    clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown",
    timezone: async (userId) => {
      const { data } = await admin.from("profiles").select("timezone").eq("user_id", userId).single();
      return (data as { timezone: string } | null)?.timezone ?? null;
    },
  });
}

export const GET = handle;
export const POST = handle;
