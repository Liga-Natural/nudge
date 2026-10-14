"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/lib/context";
import { dedupeReminders, dueInstant, itemInputSchema, toDueLocal, type ItemInput } from "@/lib/item-input";
import { buildDues, tomorrowMorning } from "@/lib/occurrences";
import { parseQuickAdd } from "@/lib/parser";
import { defaultReminders, reminderToRow, type ReminderSpec } from "@/lib/reminders";
import { instantToWall } from "@/lib/time";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Key } from "@/lib/i18n";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: Key | "setup" };

const fail = (error: Key | "setup" = "common.error") => ({ ok: false as const, error });
const refresh = () => revalidatePath("/", "layout");

async function ready() {
  const ctx = await getCtx();
  return ctx.state === "ready" ? ctx : null;
}

// ------------------------------------------------------------------ quick add
export type ParsedForm = Omit<ItemInput, "spaceId"> & {
  warnings: ("past" | "no_date" | "package_later")[];
};

export async function parseText(text: string): Promise<Result<{ parsed: ParsedForm }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const clean = z.string().trim().min(1).max(500).safeParse(text);
  if (!clean.success) return fail("add.titleRequired");
  const tz = ctx.profile.timezone;
  const p = parseQuickAdd(clean.data, { now: new Date(), tz, lang: "auto" });
  const reminders: ReminderSpec[] = p.dueAt ? defaultReminders(p.type, p.allDay, ctx.profile.nudge_style) : [];
  if (p.dueAt && p.reminderOffsetMinutes) reminders.push({ offsetMinutes: p.reminderOffsetMinutes });
  const w = p.dueAt ? instantToWall(p.dueAt, tz) : null;
  return {
    ok: true,
    parsed: {
      title: p.title || clean.data,
      type: p.type === "package" ? "task" : p.type,
      dueLocal: p.dueAt && w ? toDueLocal(p.dueAt, p.allDay, w) : null,
      allDay: p.allDay,
      amountCents: p.amountCents,
      rrule: p.rrule,
      notes: p.trackingNumber ? `Tracking number: ${p.trackingNumber}` : null,
      reminders: dedupeReminders(reminders),
      warnings: p.warnings,
    },
  };
}

// ------------------------------------------------------------------ items
async function saveReminders(ctx: NonNullable<Awaited<ReturnType<typeof ready>>>, itemId: string, specs: ReminderSpec[]) {
  await ctx.supabase.from("reminders").delete().eq("item_id", itemId);
  const rows = dedupeReminders(specs).map((s) => ({ user_id: ctx.userId, item_id: itemId, ...reminderToRow(s) }));
  if (rows.length) {
    const { error } = await ctx.supabase.from("reminders").insert(rows);
    if (error) throw new Error(error.message);
  }
}

async function logEvent(ctx: NonNullable<Awaited<ReturnType<typeof ready>>>, itemId: string, kind: string, detail?: string) {
  await ctx.supabase.from("item_events").insert({ user_id: ctx.userId, item_id: itemId, kind, detail: detail ?? null });
}

export async function createItem(raw: ItemInput): Promise<Result<{ id: string }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const input = itemInputSchema.safeParse(raw);
  if (!input.success) return fail("add.titleRequired");
  const v = input.data;
  const tz = ctx.profile.timezone;
  const due = dueInstant(v.dueLocal, v.allDay, tz);
  const { data, error } = await ctx.supabase
    .from("items")
    .insert({
      user_id: ctx.userId,
      space_id: v.spaceId,
      type: v.type,
      title: v.title,
      notes: v.notes,
      due_at: due?.toISOString() ?? null,
      all_day: v.allDay,
      timezone: tz,
      amount_cents: v.amountCents,
      rrule: v.rrule,
    })
    .select("id")
    .single();
  if (error || !data) return fail();
  const id = (data as { id: string }).id;
  try {
    await saveReminders(ctx, id, due ? v.reminders : []);
    const dues = buildDues(due, v.rrule, tz, new Date());
    await ctx.supabase.rpc("sync_item_occurrences", { p_item_id: id, p_dues: dues.map((d) => d.toISOString()) });
    await logEvent(ctx, id, "created");
  } catch {
    return fail();
  }
  refresh();
  return { ok: true, id };
}

export async function updateItem(itemId: string, raw: ItemInput): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const input = itemInputSchema.safeParse(raw);
  if (!input.success || !z.string().uuid().safeParse(itemId).success) return fail("add.titleRequired");
  const v = input.data;
  const tz = ctx.profile.timezone;
  const due = dueInstant(v.dueLocal, v.allDay, tz);
  const { error } = await ctx.supabase
    .from("items")
    .update({
      space_id: v.spaceId,
      type: v.type,
      title: v.title,
      notes: v.notes,
      due_at: due?.toISOString() ?? null,
      all_day: v.allDay,
      timezone: tz,
      amount_cents: v.amountCents,
      rrule: v.rrule,
    })
    .eq("id", itemId);
  if (error) return fail();
  try {
    await saveReminders(ctx, itemId, due ? v.reminders : []);
    const now = new Date();
    // Keep overdue open ones that are still part of the series, so editing never hides a late item.
    const { data: open } = await ctx.supabase
      .from("occurrences")
      .select("due_at")
      .eq("item_id", itemId)
      .eq("status", "open")
      .lt("due_at", now.toISOString());
    const dues = buildDues(due, v.rrule, tz, now).map((d) => d.toISOString());
    if (!v.rrule) {
      // a one-off item has one occurrence: its (possibly new) due time
    } else {
      for (const o of (open ?? []) as { due_at: string }[]) if (!dues.includes(o.due_at)) dues.push(o.due_at);
    }
    await ctx.supabase.rpc("sync_item_occurrences", { p_item_id: itemId, p_dues: dues });
    await logEvent(ctx, itemId, "edited");
  } catch {
    return fail();
  }
  refresh();
  return { ok: true };
}

export async function deleteItem(itemId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(itemId).success) return fail();
  const { error } = await ctx.supabase.from("items").delete().eq("id", itemId);
  if (error) return fail();
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ done / skip / snooze
async function loadOccurrence(ctx: NonNullable<Awaited<ReturnType<typeof ready>>>, occId: string) {
  if (!z.string().uuid().safeParse(occId).success) return null;
  const { data } = await ctx.supabase.from("occurrences").select("id,item_id,status,snooze_count").eq("id", occId).single();
  return (data as { id: string; item_id: string; status: string; snooze_count: number } | null) ?? null;
}

async function finishOccurrence(occId: string, status: "done" | "skipped"): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const occ = await loadOccurrence(ctx, occId);
  if (!occ) return fail();
  const { error } = await ctx.supabase
    .from("occurrences")
    .update({ status, done_at: new Date().toISOString(), snoozed_until: null })
    .eq("id", occId);
  if (error) return fail();
  // Finishing one time of a repeating item never touches the rest of the series.
  const { data: item } = await ctx.supabase.from("items").select("rrule").eq("id", occ.item_id).single();
  if (!(item as { rrule: string | null } | null)?.rrule) {
    await ctx.supabase.from("items").update({ status }).eq("id", occ.item_id);
  }
  await logEvent(ctx, occ.item_id, status);
  refresh();
  return { ok: true };
}

export const markDone = async (occId: string) => finishOccurrence(occId, "done");
export const markSkipped = async (occId: string) => finishOccurrence(occId, "skipped");

export async function reopenOccurrence(occId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const occ = await loadOccurrence(ctx, occId);
  if (!occ) return fail();
  const { error } = await ctx.supabase.from("occurrences").update({ status: "open", done_at: null }).eq("id", occId);
  if (error) return fail();
  await ctx.supabase.from("items").update({ status: "open" }).eq("id", occ.item_id);
  await logEvent(ctx, occ.item_id, "reopened");
  refresh();
  return { ok: true };
}

export async function snoozeOccurrence(occId: string, option: "10" | "60" | "180" | "tomorrow"): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const occ = await loadOccurrence(ctx, occId);
  if (!occ || !["10", "60", "180", "tomorrow"].includes(option)) return fail();
  const now = new Date();
  const until = option === "tomorrow" ? tomorrowMorning(now, ctx.profile.timezone) : new Date(now.getTime() + Number(option) * 60_000);
  const { error } = await ctx.supabase
    .from("occurrences")
    .update({ snoozed_until: until.toISOString(), snooze_count: occ.snooze_count + 1 })
    .eq("id", occId);
  if (error) return fail();
  await logEvent(ctx, occ.item_id, "snoozed");
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ settings
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/);
const profilePatchSchema = z
  .object({
    language: z.enum(["en", "es"]),
    mode: z.enum(["simple", "full"]),
    morning_enabled: z.boolean(),
    morning_time: timeSchema,
    quiet_start: timeSchema,
    quiet_end: timeSchema,
    urgent_override: z.boolean(),
    nudge_style: z.enum(["morning", "on_time", "before", "important"]),
    type_switches: z.record(z.string(), z.boolean()),
    track_types: z.array(z.enum(["homework", "payments", "packages", "tasks"])).max(4),
    timezone: z.string().max(60).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }),
    onboarded: z.boolean(),
  })
  .partial();
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export async function updateProfile(patch: ProfilePatch, quiet = false): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) return fail();
  const { error } = await ctx.supabase.from("profiles").update(parsed.data).eq("user_id", ctx.userId);
  if (error) return fail();
  if (parsed.data.language) {
    (await cookies()).set("nudge-lang", parsed.data.language, { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  // Onboarding saves quietly so the page does not jump away before its "all set" screen.
  if (!quiet) refresh();
  return { ok: true };
}

const spaceSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8).default("📁"),
});

export async function createSpace(raw: { name: string; emoji?: string }): Promise<Result<{ id: string }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = spaceSchema.safeParse(raw);
  if (!parsed.success) return fail("space.name");
  const { data, error } = await ctx.supabase
    .from("spaces")
    .insert({ user_id: ctx.userId, ...parsed.data })
    .select("id")
    .single();
  if (error || !data) return fail();
  refresh();
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateSpace(id: string, patch: { name?: string; notifications_enabled?: boolean }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(40).optional(), notifications_enabled: z.boolean().optional() })
    .safeParse(patch);
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("spaces").update(parsed.data).eq("id", id);
  if (error) return fail();
  refresh();
  return { ok: true };
}

export async function deleteSpace(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("spaces").delete().eq("id", id).eq("is_default", false);
  if (error) return fail();
  refresh();
  return { ok: true };
}

export async function deleteAccount(confirmWord: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!["DELETE", "BORRAR"].includes(confirmWord.trim().toUpperCase())) return fail();
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(ctx.userId);
    if (error) return fail();
  } catch {
    return fail("settings.deleteAccount.unavailable");
  }
  await ctx.supabase.auth.signOut();
  return { ok: true };
}
