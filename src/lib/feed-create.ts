import { encrypt } from "./crypto";
import type { Db } from "./supabase/server";
import { checkFeedUrl } from "./safe-fetch";
import type { Key } from "./i18n";

export type NewFeed = {
  name: string;
  url: string;
  defaultType: "task" | "homework" | "payment" | "event";
  kind: "calendar" | "classroom" | "bills";
  courseId?: string | null;
};

/** Checks the address, encrypts it and saves the feed. The address is never stored in plain text. */
export async function addFeed(supabase: Db, userId: string, f: NewFeed): Promise<{ ok: true } | { ok: false; error: Key }> {
  const check = checkFeedUrl(f.url);
  if (!check.ok) {
    return { ok: false, error: check.reason === "bad_url" ? "feeds.error.bad_url" : check.reason === "not_https" ? "feeds.error.not_https" : "feeds.error.private" };
  }
  let url_encrypted: string;
  try {
    url_encrypted = encrypt(check.url.toString());
  } catch {
    return { ok: false, error: "feeds.error.key" };
  }
  const { error } = await supabase.from("calendar_feeds").insert({
    user_id: userId,
    name: f.name,
    url_encrypted,
    host: check.url.hostname,
    default_type: f.defaultType,
    kind: f.kind,
    course_id: f.courseId ?? null,
    // School calendars and Joker bills change slowly: hourly is plenty and keeps the clock light.
    interval_minutes: f.kind === "calendar" ? 30 : 60,
  });
  if (error) return { ok: false, error: "feeds.error.save" };
  return { ok: true };
}
