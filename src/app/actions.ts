"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/lib/context";
import { autoLook } from "@/lib/course-look";
import { currentSchoolYear } from "@/lib/grades";
import { dedupeReminders, dueInstant, itemInputSchema, type ItemInput } from "@/lib/item-input";
import { buildDues, tomorrowMorning, tonightAt } from "@/lib/occurrences";
import { parseQuickAdd } from "@/lib/parser";
import { buildQuickInput, type QuickForm } from "@/lib/quick-add";
import { featureOn } from "@/lib/features";
import { reminderToRow, type ReminderSpec } from "@/lib/reminders";
import { instantToWall, wallToInstant } from "@/lib/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { checkFeedUrl } from "@/lib/safe-fetch";
import type { Key } from "@/lib/i18n";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: Key | "setup" };

const fail = (error: Key | "setup" = "common.error") => ({ ok: false as const, error });
const refresh = () => revalidatePath("/", "layout");

async function ready() {
  const ctx = await getCtx();
  return ctx.state === "ready" ? ctx : null;
}

// ------------------------------------------------------------------ quick add
export type ParsedForm = QuickForm;

export async function parseText(text: string): Promise<Result<{ parsed: ParsedForm }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const clean = z.string().trim().min(1).max(500).safeParse(text);
  if (!clean.success) return fail("add.titleRequired");
  const tz = ctx.profile.timezone;
  const { data: courseData } = await ctx.supabase.from("courses").select("id,name");
  const courses = (courseData ?? []) as { id: string; name: string }[];
  const p = parseQuickAdd(clean.data, { now: new Date(), tz, lang: "auto", courses: courses.map((c) => c.name) });
  return { ok: true, parsed: buildQuickInput(p, clean.data, { tz, nudgeStyle: ctx.profile.nudge_style, courses, isOn: (f) => featureOn(ctx.profile, f) }) };
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

async function saveChecklist(ctx: NonNullable<Awaited<ReturnType<typeof ready>>>, itemId: string, list: { text: string; done: boolean }[]) {
  await ctx.supabase.from("item_checklist").delete().eq("item_id", itemId);
  if (!list.length) return;
  const { error } = await ctx.supabase
    .from("item_checklist")
    .insert(list.map((c, i) => ({ user_id: ctx.userId, item_id: itemId, text: c.text, done: c.done, sort_order: i })));
  if (error) throw new Error(error.message);
}

export async function toggleChecklist(id: string, done: boolean): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("item_checklist").update({ done }).eq("id", id);
  if (error) return fail("item.error.save");
  refresh();
  return { ok: true };
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
      autopay: v.autopay,
      course_id: v.courseId,
      location: v.location,
      link: v.type === "homework" ? v.link : null,
      hw_where: v.type === "homework" ? v.where : null,
      subtype: v.type === "work" ? v.subtype : null,
      ...(v.ringAnyway === undefined ? {} : { ring_anyway: v.ringAnyway }),
    })
    .select("id")
    .single();
  if (error || !data) return fail("item.error.save");
  const id = (data as { id: string }).id;
  try {
    await saveReminders(ctx, id, due ? v.reminders : []);
    await saveChecklist(ctx, id, v.checklist);
    const dues = buildDues(due, v.rrule, tz, new Date());
    // Without these times the item would never remind you, so a failure here must be loud.
    const { error: occError } = await ctx.supabase.rpc("sync_item_occurrences", { p_item_id: id, p_dues: dues.map((d) => d.toISOString()) });
    if (occError) {
      await ctx.supabase.from("items").delete().eq("id", id);
      return fail("item.error.times");
    }
    await logEvent(ctx, id, "created");
  } catch {
    await ctx.supabase.from("items").delete().eq("id", id);
    return fail("item.error.reminders");
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
      autopay: v.autopay,
      course_id: v.courseId,
      location: v.location,
      link: v.type === "homework" ? v.link : null,
      hw_where: v.type === "homework" ? v.where : null,
      subtype: v.type === "work" ? v.subtype : null,
      ...(v.ringAnyway === undefined ? {} : { ring_anyway: v.ringAnyway }),
    })
    .eq("id", itemId);
  if (error) return fail("item.error.save");
  // Once you change an imported item yourself, the calendar feed stops overriding it.
  await ctx.supabase.from("items").update({ locally_edited: true }).eq("id", itemId).eq("source", "ics");
  try {
    await saveReminders(ctx, itemId, due ? v.reminders : []);
    await saveChecklist(ctx, itemId, v.checklist);
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
    const { error: occError } = await ctx.supabase.rpc("sync_item_occurrences", { p_item_id: itemId, p_dues: dues });
    if (occError) return fail("item.error.times");
    await logEvent(ctx, itemId, "edited");
  } catch {
    return fail("item.error.reminders");
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
  } else {
    // Next time starts with a clean checklist.
    await ctx.supabase.from("item_checklist").update({ done: false }).eq("item_id", occ.item_id);
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

export async function snoozeOccurrence(occId: string, option: "10" | "60" | "180" | "tonight" | "tomorrow"): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const occ = await loadOccurrence(ctx, occId);
  if (!occ || !["10", "60", "180", "tonight", "tomorrow"].includes(option)) return fail();
  const now = new Date();
  let until: Date;
  if (option === "tomorrow") until = tomorrowMorning(now, ctx.profile.timezone);
  else if (option === "tonight") {
    const tonight = tonightAt(now, ctx.profile.timezone);
    if (!tonight) return fail("snooze.tonightPassed");
    until = tonight;
  } else until = new Date(now.getTime() + Number(option) * 60_000);
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
    features: z.record(z.string(), z.boolean()),
    prefs: z
      .object({
        hw_night_time: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|off)$/),
        hw_hours_before: z.number().int().min(0).max(72),
        habit_summary: z.boolean(),
        habit_summary_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        first_name: z.string().trim().max(40),
        opening_animation: z.boolean(),
      })
      .partial(),
    track_types: z.array(z.enum(["homework", "payments", "packages", "tasks", "work", "habits", "birthdays", "renewals"])).max(8),
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
  // Small settings are merged into what is already saved, never replacing the rest.
  const patchToSave = {
    ...parsed.data,
    ...(parsed.data.prefs ? { prefs: { ...(ctx.profile.prefs ?? {}), ...parsed.data.prefs } } : {}),
    ...(parsed.data.features ? { features: { ...(ctx.profile.features ?? {}), ...parsed.data.features } } : {}),
  };
  const { error } = await ctx.supabase.from("profiles").update(patchToSave).eq("user_id", ctx.userId);
  if (error) return fail("settings.error.save");
  // Changing a cookie makes Next re-draw the page, so quiet saves (onboarding) leave it to the caller.
  if (parsed.data.language && !quiet) {
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

// ------------------------------------------------------------------ payments
export async function markPaid(occId: string, amountCents: number, paidOn: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z
    .object({ amountCents: z.number().int().min(0).max(100_000_000), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse({ amountCents, paidOn });
  if (!parsed.success) return fail();
  const occ = await loadOccurrence(ctx, occId);
  if (!occ) return fail();
  const { data: item } = await ctx.supabase.from("items").select("id,title,currency").eq("id", occ.item_id).single();
  if (!item) return fail();
  const done = await finishOccurrence(occId, "done");
  if (!done.ok) return done;
  const row = item as { id: string; title: string; currency: string };
  await ctx.supabase.from("item_payments").insert({
    user_id: ctx.userId,
    item_id: row.id,
    occurrence_id: occId,
    amount_cents: parsed.data.amountCents,
    currency: row.currency,
    paid_on: parsed.data.paidOn,
  });
  await ctx.supabase.from("updates").insert({ user_id: ctx.userId, kind: "paid", title: row.title, body: String(parsed.data.amountCents), item_id: row.id });
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ school
const courseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#e4edff"),
});

export async function createCourse(name: string): Promise<Result<{ id: string }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  // The colour comes from the subject ("Italian" green, "Science" teal...) and can be changed later.
  const parsed = courseSchema.safeParse({ name, color: autoLook(String(name)).color });
  if (!parsed.success) return fail("school.courseName");
  const { data, error } = await ctx.supabase
    .from("courses")
    .insert({ user_id: ctx.userId, ...parsed.data, school_year: currentSchoolYear(new Date(), ctx.profile.timezone) })
    .select("id")
    .single();
  if (error || !data) return fail();
  refresh();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteCourse(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("courses").delete().eq("id", id);
  if (error) return fail();
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ calendar feeds
const feedSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(8).max(2000),
  defaultType: z.enum(["task", "homework", "payment", "event"]),
});

export async function createFeed(raw: { name: string; url: string; defaultType: "task" | "homework" | "payment" | "event" }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = feedSchema.safeParse(raw);
  if (!parsed.success) return fail("feeds.error.bad_url");
  const check = checkFeedUrl(parsed.data.url);
  if (!check.ok) return fail(check.reason === "bad_url" ? "feeds.error.bad_url" : check.reason === "not_https" ? "feeds.error.not_https" : "feeds.error.private");
  let url_encrypted: string;
  try {
    url_encrypted = encrypt(check.url.toString());
  } catch {
    return fail("feeds.error.key");
  }
  const { error } = await ctx.supabase.from("calendar_feeds").insert({
    user_id: ctx.userId,
    name: parsed.data.name,
    url_encrypted,
    host: check.url.hostname,
    default_type: parsed.data.defaultType,
  });
  if (error) return fail();
  refresh();
  return { ok: true };
}

export async function deleteFeed(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("calendar_feeds").delete().eq("id", id);
  if (error) return fail();
  refresh();
  return { ok: true };
}

/** "Check now": clearing the time makes the minute clock pick this feed up within a minute. */
export async function syncFeedNow(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("calendar_feeds").update({ last_synced_at: null }).eq("id", id);
  if (error) return fail();
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ updates
export async function markUpdatesRead(): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  await ctx.supabase.from("updates").update({ read_at: new Date().toISOString() }).is("read_at", null);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ Phase 4: undo, reschedule, drag order
/** Undo for "snooze": the reminder comes back to the list and the snooze count goes down by one. */
export async function unsnoozeOccurrence(occId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const occ = await loadOccurrence(ctx, occId);
  if (!occ) return fail();
  const { error } = await ctx.supabase
    .from("occurrences")
    .update({ snoozed_until: null, snooze_count: Math.max(0, occ.snooze_count - 1) })
    .eq("id", occId);
  if (error) return fail();
  refresh();
  return { ok: true };
}

/**
 * Moves one reminder to another day (same time of day). "Do today" uses today's date; if that time has
 * already passed it becomes an all-day item for that day so it is not late straight away.
 */
export async function moveOccurrence(occId: string, day: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(day);
  if (!parsed.success || !z.string().uuid().safeParse(occId).success) return fail();
  const { data: occ } = await ctx.supabase.from("occurrences").select("id,item_id,due_at,status").eq("id", occId).single();
  const o = occ as { id: string; item_id: string; due_at: string; status: string } | null;
  if (!o || o.status !== "open") return fail();
  const { data: itemData } = await ctx.supabase.from("items").select("id,rrule,all_day").eq("id", o.item_id).single();
  const item = itemData as { id: string; rrule: string | null; all_day: boolean } | null;
  if (!item) return fail();

  const tz = ctx.profile.timezone;
  const [y, m, d] = parsed.data.split("-").map(Number);
  const w = instantToWall(new Date(o.due_at), tz);
  let allDay = item.all_day;
  let due = allDay ? wallToInstant({ y, m, d, h: 23, mi: 59 }, tz) : wallToInstant({ y, m, d, h: w.h, mi: w.mi }, tz);
  if (due.getTime() < Date.now()) {
    due = wallToInstant({ y, m, d, h: 23, mi: 59 }, tz);
    allDay = true;
  }
  if (!item.rrule) {
    const { error } = await ctx.supabase.from("items").update({ due_at: due.toISOString(), all_day: allDay }).eq("id", item.id);
    if (error) return fail("item.error.save");
    const { error: occError } = await ctx.supabase.rpc("sync_item_occurrences", { p_item_id: item.id, p_dues: [due.toISOString()] });
    if (occError) return fail("item.error.times");
  } else {
    // Only this time of a repeating item moves.
    const { error } = await ctx.supabase.from("occurrences").update({ due_at: due.toISOString(), snoozed_until: null }).eq("id", occId);
    if (error) return fail("item.error.times");
  }
  await logEvent(ctx, item.id, "edited", "moved");
  refresh();
  return { ok: true };
}

/** "Delete" from a list: hides the item (and stops its reminders) so Undo can bring it straight back. */
export async function archiveItem(itemId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(itemId).success) return fail();
  const { error } = await ctx.supabase.from("items").update({ status: "archived" }).eq("id", itemId);
  if (error) return fail();
  refresh();
  return { ok: true };
}

export async function restoreItem(itemId: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(itemId).success) return fail();
  const { error } = await ctx.supabase.from("items").update({ status: "open" }).eq("id", itemId).eq("status", "archived");
  if (error) return fail();
  refresh();
  return { ok: true };
}

/** Remembers the order you dragged one day's reminders into (kept for a few days, then forgotten). */
export async function saveDayOrder(day: string, ids: string[]): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ids: z.array(z.string().uuid()).max(100) }).safeParse({ day, ids });
  if (!parsed.success) return fail();
  const cutoff = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) - 3)).toISOString().slice(0, 10);
  const kept = Object.fromEntries(Object.entries(ctx.profile.prefs?.day_order ?? {}).filter(([k]) => k >= cutoff));
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ prefs: { ...(ctx.profile.prefs ?? {}), day_order: { ...kept, [parsed.data.day]: parsed.data.ids } } })
    .eq("user_id", ctx.userId);
  if (error) return fail("settings.error.save");
  return { ok: true };
}
