"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { step: "email" | "code"; email?: string; error?: string };

const emailSchema = z.string().trim().toLowerCase().email();
const codeSchema = z.string().trim().regex(/^\d{6,10}$/);

export async function requestCode(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { step: "email", error: "That doesn't look like an email address." };
  }
  const email = parsed.data;
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) {
    return { step: "email", error: "The app isn't set up yet (owner email missing)." };
  }
  // Same message either way, so strangers can't learn who the owner is.
  if (email !== owner) {
    return { step: "code", email };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    return { step: "email", email, error: "We couldn't send the code. Try again in a minute." };
  }
  return { step: "code", email };
}

export async function verifyCode(
  prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success || !prev.email) {
    return { step: "code", email: prev.email, error: "Enter the numbers from the email." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: prev.email,
    token: code.data,
    type: "email",
  });
  if (error) {
    return { step: "code", email: prev.email, error: "That code didn't work. Check it or ask for a new one." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
