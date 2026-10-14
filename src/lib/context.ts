import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, type Db } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type Ctx =
  | { state: "needs_sql" }
  | { state: "ready"; supabase: Db; userId: string; profile: Profile };

const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42501"]);

export const isMissingSetup = (error: { code?: string; message?: string } | null) =>
  !!error && (MISSING_CODES.has(error.code ?? "") || /schema cache|does not exist/i.test(error.message ?? ""));

/** Who is signed in, their profile, and whether the setup SQL has been run. One database call. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data, error } = await supabase.rpc("ensure_profile");
  if (error) {
    if (isMissingSetup(error)) return { state: "needs_sql" };
    throw new Error(`Could not load your profile: ${error.message}`);
  }
  const profile = (Array.isArray(data) ? data[0] : data) as Profile;
  return { state: "ready", supabase, userId, profile };
});

/** For app pages: the ready context, or null while the setup SQL is missing. New people go to onboarding first. */
export async function getReadyCtx(): Promise<Extract<Ctx, { state: "ready" }> | null> {
  const ctx = await getCtx();
  if (ctx.state !== "ready") return null;
  if (!ctx.profile.onboarded) redirect("/onboarding");
  return ctx;
}
