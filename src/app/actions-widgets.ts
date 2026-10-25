"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCtx } from "@/lib/context";
import type { Key } from "@/lib/i18n";
import { generateWidgetToken, WIDGET_TOKEN_NAME } from "@/lib/widget-handler";
import type { Result } from "./actions";

// Home Screen widget tokens: made here, shown once, stored only as a fingerprint, revocable, read-only.

const fail = (error: Key | "setup" = "common.error") => ({ ok: false as const, error });

export async function createWidgetToken(): Promise<Result<{ token: string }>> {
  const ctx = await getCtx();
  if (ctx.state !== "ready") return fail("setup");
  const { data: live } = await ctx.supabase.from("api_tokens").select("token_prefix").is("revoked_at", null);
  if (((live ?? []) as { token_prefix: string }[]).filter((r) => r.token_prefix.startsWith("ndw_")).length >= 5) return fail("tokens.error.limit");
  const t = generateWidgetToken();
  const { error } = await ctx.supabase.from("api_tokens").insert({ user_id: ctx.userId, name: WIDGET_TOKEN_NAME, token_hash: t.hash, token_prefix: t.prefix });
  if (error) return fail("tokens.error.save");
  revalidatePath("/", "layout");
  return { ok: true, token: t.token };
}

/** This server's own address, which goes into the copied script. */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}
