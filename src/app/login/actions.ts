"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Key } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { step: "email" | "code"; email?: string; error?: Key };

const emailSchema = z.string().trim().toLowerCase().email();
const codeSchema = z.string().trim().regex(/^\d{6,10}$/);

export async function requestCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { step: "email", error: "login.notEmail" };
  const email = parsed.data;
  const tries = rateLimit(`login:${clientKey(await headers())}`, 6, 10 * 60_000);
  if (!tries.ok) return { step: "email", email, error: "login.tooMany" };
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return { step: "email", error: "login.ownerMissing" };
  // Same screen either way, so strangers can't learn who the owner is.
  if (email !== owner) return { step: "code", email };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    // Log the reason on the server only (never shown to the visitor, no keys).
    console.error("signInWithOtp failed:", error.status, error.code, error.message);
    return { step: "email", email, error: "login.cantSend" };
  }
  return { step: "code", email };
}

export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success || !prev.email) return { step: "code", email: prev.email, error: "login.enterNumbers" };
  const tries = rateLimit(`verify:${clientKey(await headers())}`, 10, 10 * 60_000);
  if (!tries.ok) return { step: "code", email: prev.email, error: "login.tooMany" };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: prev.email, token: code.data, type: "email" });
  if (error) return { step: "code", email: prev.email, error: "login.badCode" };
  redirect("/");
}

export async function backToEmail(): Promise<LoginState> {
  return { step: "email" };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
