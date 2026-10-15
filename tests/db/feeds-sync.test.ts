import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { syncDueFeeds } from "@/lib/feeds";
import { encrypt, loadKey } from "@/lib/crypto";
import { runDispatch } from "@/lib/dispatch";
import type { FetchResult } from "@/lib/safe-fetch";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { fakePush, pgRpc } from "./pg-rpc";

const key = loadKey("c".repeat(64));
const NY = "America/New_York";
const NOW = wallToInstant({ y: 2026, m: 10, d: 14, h: 12, mi: 0 }, NY);
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: PGlite;
let user: string;

const ICS = (...uids: string[]) =>
  `BEGIN:VCALENDAR\r\n${uids
    .map((u, i) => `BEGIN:VEVENT\r\nUID:${u}\r\nSUMMARY:Assignment ${u}\r\nDTSTART;VALUE=DATE:2026102${i}\r\nEND:VEVENT`)
    .join("\r\n")}\r\nEND:VCALENDAR\r\n`;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded, morning_enabled) values ($1, true, false)", [user]);
  await db.query(
    "insert into public.calendar_feeds (user_id, name, url_encrypted, default_type) values ($1, 'School', $2, 'homework')",
    [user, encrypt("https://school.example/cal.ics", key)],
  );
});
afterEach(async () => db.close());

const sync = (at: Date, fetchText: (u: string, e: string | null) => Promise<FetchResult>) =>
  syncDueFeeds({ rpc: pgRpc(db), now: at, decrypt: (c) => (c.startsWith("v1.") ? decryptWith(c) : c), fetchText });

import { decrypt } from "@/lib/crypto";
const decryptWith = (c: string) => decrypt(c, key);

describe("refreshing calendar feeds", () => {
  it("imports events as homework, once per 30 minutes", async () => {
    let fetched = 0;
    const fetchText = async (url: string): Promise<FetchResult> => {
      fetched++;
      expect(url).toBe("https://school.example/cal.ics");
      return { kind: "ok", text: ICS("a", "b"), etag: '"1"' };
    };
    expect(await sync(NOW, fetchText)).toMatchObject({ synced: 1 });
    expect((await db.query("select count(*)::int as n from public.items where type = 'homework' and source = 'ics'")).rows[0]).toEqual({ n: 2 });
    expect(await sync(later(5), fetchText)).toMatchObject({ synced: 0 });
    expect(fetched).toBe(1);
    expect(await sync(later(31), fetchText)).toMatchObject({ synced: 1 });
    expect((await db.query("select count(*)::int as n from public.items")).rows[0]).toEqual({ n: 2 }); // no duplicates
  });

  it("sends the saved ETag back and treats 304 as 'nothing new'", async () => {
    await sync(NOW, async () => ({ kind: "ok", text: ICS("a"), etag: '"1"' }));
    let seen: string | null = null;
    const r = await sync(later(31), async (_u, etag) => {
      seen = etag;
      return { kind: "not_modified" };
    });
    expect(seen).toBe('"1"');
    expect(r).toMatchObject({ unchanged: 1 });
  });

  it("a feed that fails shows a plain-words problem and keeps old items", async () => {
    await sync(NOW, async () => ({ kind: "ok", text: ICS("a"), etag: null }));
    await sync(later(31), async () => ({ kind: "error", message: "The calendar address did not answer in time." }));
    const row = await db.query<{ last_error: string }>("select last_error from public.calendar_feeds");
    expect(row.rows[0].last_error).toMatch(/did not answer/);
    expect((await db.query("select count(*)::int as n from public.items where status = 'open'")).rows[0]).toEqual({ n: 1 });
  });

  it("reports an unreadable saved address instead of crashing", async () => {
    await db.query("update public.calendar_feeds set url_encrypted = 'v1.garbage.garbage.garbage'");
    const r = await syncDueFeeds({
      rpc: pgRpc(db),
      now: NOW,
      decrypt: (c) => decrypt(c, key),
      fetchText: async () => ({ kind: "ok", text: "", etag: null }),
    });
    expect(r.failed).toBe(1);
    expect((await db.query<{ last_error: string }>("select last_error from public.calendar_feeds")).rows[0].last_error).toMatch(/saved calendar address/);
  });

  it("imported items get reminders and then really remind (end to end with the clock)", async () => {
    await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/p', 'k', 'a')", [user]);
    await sync(NOW, async () => ({ kind: "ok", text: ICS("a"), etag: null }));
    // due Oct 20 end of day; homework all-day reminders: day before 6 PM, same day 9 AM
    const push = fakePush();
    const dayBefore6pm = wallToInstant({ y: 2026, m: 10, d: 19, h: 18, mi: 0 }, NY);
    await runDispatch({ rpc: pgRpc(db), send: push.sender, now: new Date(dayBefore6pm.getTime() + 5000), withSummaries: false, withTopUp: false });
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.title).toContain("Assignment a");
    expect(push.calls[0].payload.title).toContain("📚");
  });
});
