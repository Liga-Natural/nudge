import { call, type Rpc } from "./dispatch";
import { parseIcs } from "./ics";
import type { ItemType } from "./parser";
import type { FetchResult } from "./safe-fetch";

type DueFeed = {
  feed_id: string;
  user_id: string;
  url_encrypted: string;
  etag: string | null;
  default_type: ItemType;
  timezone: string;
};

export type FeedSyncDeps = {
  rpc: Rpc;
  now: Date;
  decrypt: (cipher: string) => string;
  fetchText: (url: string, etag: string | null) => Promise<FetchResult>;
  limit?: number;
};

/** Refreshes the calendar feeds that are due (each at most every 30 minutes). Never throws. */
export async function syncDueFeeds(deps: FeedSyncDeps): Promise<{ synced: number; unchanged: number; failed: number }> {
  const out = { synced: 0, unchanged: 0, failed: 0 };
  let due: DueFeed[] = [];
  try {
    due = await call<DueFeed[]>(deps.rpc, "dispatch_feeds_due", { p_now: deps.now.toISOString(), p_limit: deps.limit ?? 2 });
  } catch {
    return out;
  }
  for (const feed of due) {
    const report = (events: unknown[] | null, etag: string | null, error: string | null) =>
      call(deps.rpc, "dispatch_feed_apply", {
        p_feed_id: feed.feed_id,
        p_events: events,
        p_etag: etag,
        p_error: error,
        p_now: deps.now.toISOString(),
      });
    try {
      let url: string;
      try {
        url = deps.decrypt(feed.url_encrypted);
      } catch {
        await report(null, null, "We couldn't read the saved calendar address. Remove the feed and add it again.");
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
      } else {
        const events = parseIcs(res.text, { userTz: feed.timezone, defaultType: feed.default_type, now: deps.now });
        await report(events, res.etag, null);
        out.synced++;
      }
    } catch {
      out.failed++;
    }
  }
  return out;
}
