"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getCtx } from "@/lib/context";
import { addFeed } from "@/lib/feed-create";
import { generateToken } from "@/lib/inbox-auth";
import { parseInboxText } from "@/lib/inbox-schema";
import { runImport, type ImportReport } from "@/lib/import-run";
import type { Key } from "@/lib/i18n";
import { rateLimit } from "@/lib/rate-limit";
import type { Rpc } from "@/lib/dispatch";
import type { Result } from "./actions";

// Phase 3 actions: school import, grades, access tokens, Classroom calendars, Joker bills.

const fail = (error: Key | "setup" = "common.error") => ({ ok: false as const, error });
const refresh = () => revalidatePath("/", "layout");

async function ready() {
  const ctx = await getCtx();
  return ctx.state === "ready" ? ctx : null;
}

// ------------------------------------------------------------------ import page
export type ImportResult = { ok: true; report: ImportReport } | { ok: false; problems: string[] };

async function importText(text: string, commit: boolean): Promise<ImportResult> {
  const ctx = await ready();
  if (!ctx) return { ok: false, problems: ["Nudge's database needs its setup files first (see the setup page)."] };
  const limited = rateLimit(`import:${ctx.userId}`, 30, 60_000);
  if (!limited.ok) return { ok: false, problems: [`Too many tries. Wait ${limited.retryAfterSeconds} seconds and try again.`] };
  const parsed = parseInboxText(text);
  if (!parsed.ok) return { ok: false, problems: parsed.problems };
  // The signed-in person's own session does the import, so the database itself keeps it to their account.
  const rpc: Rpc = async (name, args) => {
    const { data, error } = await ctx.supabase.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  };
  const out = await runImport(rpc, ctx.userId, parsed.payload, ctx.profile.timezone, commit);
  if (!out.ok) return { ok: false, problems: out.problems };
  if (commit) refresh();
  return { ok: true, report: out.report };
}

export async function previewImport(text: string): Promise<ImportResult> {
  return importText(text, false);
}

export async function confirmImport(text: string): Promise<ImportResult> {
  return importText(text, true);
}

// ------------------------------------------------------------------ grades (typed by hand)
const gradeSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  score: z.number().min(0).max(1_000_000),
  outOf: z.number().gt(0).max(1_000_000),
});

export async function addGrade(raw: { courseId: string; title: string; score: number; outOf: number }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = gradeSchema.safeParse(raw);
  if (!parsed.success) return fail("grades.error.invalid");
  const { error } = await ctx.supabase.from("grades").insert({
    user_id: ctx.userId,
    course_id: parsed.data.courseId,
    title: parsed.data.title,
    score: parsed.data.score,
    out_of: parsed.data.outOf,
    source: "manual",
    // Typed by you: no push to tell you what you already know.
    notified_at: new Date().toISOString(),
  });
  if (error) return fail("grades.error.save");
  refresh();
  return { ok: true };
}

export async function deleteGrade(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("grades").delete().eq("id", id);
  if (error) return fail("grades.error.save");
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ access tokens
export async function createApiToken(name: string): Promise<Result<{ token: string }>> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const clean = z.string().trim().min(1).max(60).safeParse(name);
  if (!clean.success) return fail("tokens.error.name");
  const { count } = await ctx.supabase.from("api_tokens").select("id", { count: "exact", head: true }).is("revoked_at", null);
  if ((count ?? 0) >= 10) return fail("tokens.error.limit");
  const t = generateToken();
  const { error } = await ctx.supabase.from("api_tokens").insert({ user_id: ctx.userId, name: clean.data, token_hash: t.hash, token_prefix: t.prefix });
  if (error) return fail("tokens.error.save");
  refresh();
  return { ok: true, token: t.token };
}

export async function revokeApiToken(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail("tokens.error.save");
  refresh();
  return { ok: true };
}

export async function deleteApiToken(id: string): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  if (!z.string().uuid().safeParse(id).success) return fail();
  const { error } = await ctx.supabase.from("api_tokens").delete().eq("id", id);
  if (error) return fail("tokens.error.save");
  refresh();
  return { ok: true };
}

/** The address the Test token button and agents should use (this server's own address). */
export async function inboxUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}/api/inbox` : "/api/inbox";
}

// ------------------------------------------------------------------ Classroom calendars (one per class)
export async function createClassroomFeed(raw: { courseId: string | null; className: string; url: string }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z
    .object({ courseId: z.string().uuid().nullable(), className: z.string().trim().max(60), url: z.string().trim().min(8).max(2000) })
    .safeParse(raw);
  if (!parsed.success) return fail("feeds.error.bad_url");
  let courseId = parsed.data.courseId;
  let className = parsed.data.className;
  if (courseId) {
    const { data } = await ctx.supabase.from("courses").select("id,name").eq("id", courseId).single();
    if (!data) return fail("classroom.error.class");
    className = (data as { name: string }).name;
  } else {
    if (!className) return fail("school.courseName");
    const { data: existing } = await ctx.supabase.from("courses").select("id").eq("name", className).limit(1);
    if ((existing as { id: string }[] | null)?.length) courseId = (existing as { id: string }[])[0].id;
    else {
      const { data, error } = await ctx.supabase.from("courses").insert({ user_id: ctx.userId, name: className }).select("id").single();
      if (error || !data) return fail("classroom.error.class");
      courseId = (data as { id: string }).id;
    }
  }
  const r = await addFeed(ctx.supabase, ctx.userId, { name: `${className} (Classroom)`, url: parsed.data.url, defaultType: "homework", kind: "classroom", courseId });
  if (!r.ok) return fail(r.error);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ Joker bills
export async function createBillsFeed(raw: { name: string; url: string }): Promise<Result> {
  const ctx = await ready();
  if (!ctx) return fail("setup");
  const parsed = z.object({ name: z.string().trim().min(1).max(60), url: z.string().trim().min(8).max(2000) }).safeParse(raw);
  if (!parsed.success) return fail("feeds.error.bad_url");
  const r = await addFeed(ctx.supabase, ctx.userId, { name: parsed.data.name, url: parsed.data.url, defaultType: "payment", kind: "bills" });
  if (!r.ok) return fail(r.error);
  refresh();
  return { ok: true };
}
