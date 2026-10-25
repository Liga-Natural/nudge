"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { againChips, recentKinds, type Again, type AddKind } from "@/lib/add-flows";
import { CARD_IDS } from "@/lib/dashboard";
import { getCtx } from "@/lib/context";
import { withLooks } from "@/lib/course-look";
import { featureOn } from "@/lib/features";
import { currentSchoolYear, yearOf } from "@/lib/grades";
import type { Key } from "@/lib/i18n";
import type { ItemType } from "@/lib/parser";
import type { QuietSettings } from "@/lib/quiet";
import type { NudgeStyle } from "@/lib/reminders";
import { enabledItemTypes } from "@/lib/types";
import type { Result } from "./actions";

// Phase 6 actions: what the add sheet needs, the dashboard layout, and a class's colour and emoji.

const fail = (error: Key | "setup" = "common.error") => ({ ok: false as const, error });

async function ready() {
  const ctx = await getCtx();
  return ctx.state === "ready" ? ctx : null;
}

export type AddCourse = { id: string; name: string; color: string; emoji: string };
export type AddContext = {
  courses: AddCourse[];
  /** Kinds of reminder that are switched on (Grade needs the Grades feature and a class). */
  types: ItemType[];
  grades: boolean;
  nudgeStyle: NudgeStyle;
  quiet: QuietSettings;
  spaceId: string | null;
  recent: AddKind[];
  again: Again[];
};

/** Everything the add sheet needs, fetched when it opens (so the rest of the app stays light). */
export async function loadAddContext(): Promise<Result<{ context: AddContext }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const { supabase, profile } = ctx;
  const [courseRes, spaceRes, itemRes] = await Promise.all([
    supabase.from("courses").select("id,name,color,school_year").order("created_at"),
    supabase.from("spaces").select("id,is_default,sort_order").order("sort_order").order("created_at"),
    supabase.from("items").select("type,title,course_id,created_at").order("created_at", { ascending: false }).limit(60),
  ]);
  const current = currentSchoolYear(new Date(), profile.timezone);
  const all = (courseRes.data ?? []) as { id: string; name: string; color: string; school_year: string | null }[];
  const courses = withLooks(
    all.filter((c) => yearOf(c, null, current) === current),
    profile.prefs?.course_emoji,
  ).map((c) => ({ id: c.id, name: c.name, color: c.color, emoji: c.emoji }));
  const spaces = (spaceRes.data ?? []) as { id: string; is_default: boolean }[];
  const items = (itemRes.data ?? []) as { type: string; title: string; course_id: string | null; created_at: string }[];
  return {
    ok: true,
    context: {
      courses,
      types: enabledItemTypes(profile.features),
      grades: featureOn(profile, "grades"),
      nudgeStyle: profile.nudge_style,
      quiet: { start: profile.quiet_start, end: profile.quiet_end, urgentOverride: profile.urgent_override },
      spaceId: (spaces.find((s) => s.is_default) ?? spaces[0])?.id ?? null,
      recent: recentKinds(items),
      again: againChips(items),
    },
  };
}

const layoutSchema = z.object({
  order: z.array(z.enum(CARD_IDS)).max(CARD_IDS.length),
  hidden: z.array(z.enum(CARD_IDS)).max(CARD_IDS.length),
});

/** Remembers which dashboard cards you hid and the order you put them in. */
export async function saveDashboardLayout(raw: { order: string[]; hidden: string[] }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ prefs: { ...(ctx.profile.prefs ?? {}), dash: parsed.data } })
    .eq("user_id", ctx.userId);
  if (error) return fail("settings.error.save");
  revalidatePath("/", "layout");
  return { ok: true };
}

const lookSchema = z.object({
  id: z.string().uuid(),
  emoji: z.string().trim().min(1).max(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/** A class's emoji (kept in your settings) and colour (kept on the class). */
export async function setCourseLook(raw: { id: string; emoji: string; color: string }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = lookSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const { error: colorError } = await ctx.supabase.from("courses").update({ color: parsed.data.color }).eq("id", parsed.data.id);
  if (colorError) return fail();
  const emojis = { ...(ctx.profile.prefs?.course_emoji ?? {}), [parsed.data.id]: parsed.data.emoji };
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ prefs: { ...(ctx.profile.prefs ?? {}), course_emoji: emojis } })
    .eq("user_id", ctx.userId);
  if (error) return fail("settings.error.save");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Ring anyway" after a save: lets that item break through quiet hours. */
export async function ringItemAnyway(itemId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(itemId).success) return fail();
  const { error } = await ctx.supabase.from("items").update({ ring_anyway: true }).eq("id", itemId);
  if (error) return fail();
  revalidatePath("/", "layout");
  return { ok: true };
}
