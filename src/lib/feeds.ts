import { call, type Rpc } from "./dispatch";
import { parseBillsFeed, toBillRows } from "./bills-feed";
import { parseIcs } from "./ics";
import type { ItemType } from "./parser";
import type { ReminderSpec } from "./reminders";
import type { FetchResult } from "./safe-fetch";

type DueFeed = {
  feed_id: string;
  user_id: string;
  url_encrypted: string;
  etag: string | null;
  default_type: ItemType;
  timezone: string;
  kind?: "calendar" | "classroom" | "bills";
  prefs?: Record<string, unknown> | null;
};

export type FeedSyncDeps = {
  rpc: Rpc;
  now: Date;
  decrypt: (cipher: string) => string;
  fetchText: (url: string, etag: string | null) => Promise<FetchResult>;
  limit?: number;
};

/** Homework reminders for school calendars: the night before and a couple of hours before (both adjustable in Settings). */
export function homeworkReminders(prefs: Record<string, unknown> | null | undefined): ReminderSpec[] {
  const out: ReminderSpec[] = [];
  const asked = typeof prefs?.hw_night_time === "string" ? prefs.hw_night_time : "18:00";
  const night = asked === "off" || /^([01]\d|2[0-3]):[0-5]\d$/.test(asked) ? asked : "18:00";
  if (night !== "off") out.push({ daysBefore: 1, atTime: night });
  const hours = typeof prefs?.hw_hours_before === "number" ? prefs.hw_hours_before : 2;
  if (hours > 0 && hours <= 72) out.push({ offsetMinutes: Math.round(hours * 60) });
  return out;
}

/** Refreshes the feeds that are due: calendars every 30 minutes, Classroom calendars and Joker bills every hour. Never throws. */
export async function syncDueFeeds(deps: FeedSyncDeps): Promise<{ synced: number; unchanged: number; failed: number }> {
  const out = { synced: 0, unchanged: 0, failed: 0 };
  let due: DueFeed[] = [];
  try {
    due = await call<DueFeed[]>(deps.rpc, "dispatch_feeds_due", { p_now: deps.now.toISOString(), p_limit: deps.limit ?? 2 });
  } catch {
    return out;
  }
  for (const feed of due) {
    const isBills = feed.kind === "bills";
    const report = (payload: unknown[] | null, etag: string | null, error: string | null) =>
      isBills
        ? call(deps.rpc, "dispatch_bills_apply", {
            p_feed_id: feed.feed_id,
            p_bills: payload,
            p_etag: etag,
            p_error: error,
            p_now: deps.now.toISOString(),
          })
        : call(deps.rpc, "dispatch_feed_apply", {
            p_feed_id: feed.feed_id,
            p_events: payload,
            p_etag: etag,
            p_error: error,
            p_now: deps.now.toISOString(),
          });
    try {
      let url: string;
      try {
        url = deps.decrypt(feed.url_encrypted);
      } catch {
        await report(null, null, "We couldn't read the saved address. Remove it and add it again (the encryption key may have changed).");
        out.failed++;
        continue;
      }
      const res = await deps.fetchText(url, feed.etag);
      if (res.kind === "error") {
        await report(null, null, res.message);
        out.failed++;
      } else if (res.kind === "not_modified") {
        await report(null, feed.etag, null);
        out.unchanged++;
      } else if (isBills) {
        const parsed = parseBillsFeed(res.text);
        if (!parsed.ok) {
          await report(null, null, parsed.message);
          out.failed++;
        } else {
          await report(toBillRows(parsed.bills), res.etag, null);
          out.synced++;
        }
      } else {
        const events = parseIcs(res.text, {
          userTz: feed.timezone,
          defaultType: feed.default_type,
          now: deps.now,
          reminders: feed.kind === "classroom" ? homeworkReminders(feed.prefs) : undefined,
        });
        await report(events, res.etag, null);
        out.synced++;
      }
    } catch {
      out.failed++;
    }
  }
  return out;
}
