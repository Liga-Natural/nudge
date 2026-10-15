import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, type Db } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type Ctx =
  | { state: "needs_sql" }
  | { state: "ready"; supabase: Db; userId: string; profile: Profile };

const MISSING_CODES = new Set(["PGRST202", "PGRST205", "PGRST204", "42883", "42P01", "42703", "42501"]);

export const isMissingSetup = (error: { code?: string; message?: string } | null) =>
  !!error && (MISSING_CODES.has(error.code ?? "") || /schema cache|does not exist/i.test(error.message ?? ""));

// Once every Phase 3 file is known to be in the database there is no need to ask again.
let schemaKnownGood = false;

/** True when every table and column this version of the app reads exists (the setup files 0007-0010 were run). */
async function schemaIsCurrent(supabase: Db): Promise<boolean> {
  if (schemaKnownGood) return true;
  const probes = await Promise.all([
    supabase.from("items").select("location,subtype").limit(1),
    supabase.from("courses").select("external_id").limit(1),
    supabase.from("calendar_feeds").select("kind").limit(1),
    supabase.from("delivery_attempts").select("id").limit(1),
    supabase.from("item_checklist").select("id").limit(1),
    supabase.from("grades").select("id").limit(1),
    supabase.from("api_tokens").select("id").limit(1),
  ]);
  if (probes.some((p) => p.error && isMissingSetup(p.error as { code?: string; message?: string }))) return false;
  schemaKnownGood = true;
  return true;
}

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
  // This version of the app needs files 0006-0010 too; without them the screens would quietly show nothing.
  if (!profile || !("features" in profile) || !("prefs" in profile)) return { state: "needs_sql" };
  if (!(await schemaIsCurrent(supabase))) return { state: "needs_sql" };
  return { state: "ready", supabase, userId, profile };
});

/** For app pages: the ready context, or null while the setup SQL is missing. New people go to onboarding first. */
export async function getReadyCtx(): Promise<Extract<Ctx, { state: "ready" }> | null> {
  const ctx = await getCtx();
  if (ctx.state !== "ready") return null;
  if (!ctx.profile.onboarded) redirect("/onboarding");
  return ctx;
}
