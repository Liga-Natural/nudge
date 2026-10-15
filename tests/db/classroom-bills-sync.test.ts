import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { decrypt, encrypt, loadKey } from "@/lib/crypto";
import { homeworkReminders, syncDueFeeds } from "@/lib/feeds";
import type { FetchResult } from "@/lib/safe-fetch";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { pgRpc } from "./pg-rpc";

const key = loadKey("d".repeat(64));
const NY = "America/New_York";
const NOW = wallToInstant({ y: 2026, m: 10, d: 15, h: 12, mi: 0 }, NY);
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: PGlite;
let user: string;
let course: string;

const ICS = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:cr-1\r\nSUMMARY:Chapter 3 problems\r\nDTSTART:20261020T230000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const sync = (at: Date, fetchText: (u: string, e: string | null) => Promise<FetchResult>) =>
  syncDueFeeds({ rpc: pgRpc(db), now: at, decrypt: (c) => decrypt(c, key), fetchText });

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded, morning_enabled) values ($1, true, false)", [user]);
  const c = await db.query<{ id: string }>("insert into public.courses (user_id, name) values ($1, 'Math 101') returning id", [user]);
  course = c.rows[0].id;
});
afterEach(async () => db.close());

describe("Google Classroom calendars (one per class)", () => {
  beforeEach(async () => {
    await db.query(
      "insert into public.calendar_feeds (user_id, name, url_encrypted, default_type, kind, course_id, interval_minutes) values ($1, 'Math 101 (Classroom)', $2, 'homework', 'classroom', $3, 60)",
      [user, encrypt("https://calendar.google.com/calendar/ical/x/private-abc/basic.ics", key), course],
    );
  });

  it("makes Homework in the class with the night-before and 2-hours-before reminders, hourly, without duplicates", async () => {
    let fetched = 0;
    const fetchText = async (): Promise<FetchResult> => {
      fetched++;
      return { kind: "ok", text: ICS, etag: null };
    };
    expect(await sync(NOW, fetchText)).toMatchObject({ synced: 1 });
    const item = await db.query<{ id: string; type: string; course_id: string; title: string }>("select id, type, course_id, title from public.items");
    expect(item.rows).toHaveLength(1);
    expect(item.rows[0]).toMatchObject({ type: "homework", course_id: course, title: "Chapter 3 problems" });
    const rems = await db.query<{ days_before: number | null; at_time: string | null; offset_minutes: number | null }>(
      "select days_before, at_time::text, offset_minutes from public.reminders order by days_before nulls last",
    );
    expect(rems.rows).toEqual([
      { days_before: 1, at_time: "18:00:00", offset_minutes: null },
      { days_before: null, at_time: null, offset_minutes: 120 },
    ]);
    // not again within the hour, but again after it
    expect(await sync(later(35), fetchText)).toMatchObject({ synced: 0 });
    expect(await sync(later(61), fetchText)).toMatchObject({ synced: 1 });
    expect(fetched).toBe(2);
    expect((await db.query("select * from public.items")).rows).toHaveLength(1);
  });

  it("uses the reminder timing chosen in Settings", async () => {
    await db.query(`update public.profiles set prefs = '{"hw_night_time": "20:30", "hw_hours_before": 3}'`);
    await sync(NOW, async () => ({ kind: "ok", text: ICS, etag: null }));
    const rems = await db.query<{ at_time: string | null; offset_minutes: number | null }>("select at_time::text, offset_minutes from public.reminders order by offset_minutes nulls first");
    expect(rems.rows).toEqual([
      { at_time: "20:30:00", offset_minutes: null },
      { at_time: null, offset_minutes: 180 },
    ]);
  });

  it("the timing helper: adjustable, and either one can be switched off", () => {
    expect(homeworkReminders(null)).toEqual([{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 120 }]);
    expect(homeworkReminders({ hw_night_time: "off", hw_hours_before: 0 })).toEqual([]);
    expect(homeworkReminders({ hw_night_time: "21:00", hw_hours_before: 1 })).toEqual([{ daysBefore: 1, atTime: "21:00" }, { offsetMinutes: 60 }]);
    expect(homeworkReminders({ hw_night_time: "garbage", hw_hours_before: 9999 })).toEqual([{ daysBefore: 1, atTime: "18:00" }]);
  });
});

describe("Joker bills feed", () => {
  const feedUrl = "https://joker.example/api/nudge-bills?key=secret";
  const FEED = (bills: unknown[]) => JSON.stringify({ version: 1, bills });
  const phone = { id: "b1", name: "Phone bill", amount_cents: 4500, due_date: "2026-10-20", status: "unpaid" };

  beforeEach(async () => {
    await db.query("insert into public.calendar_feeds (user_id, name, url_encrypted, default_type, kind, interval_minutes) values ($1, 'Joker bills', $2, 'payment', 'bills', 60)", [
      user,
      encrypt(feedUrl, key),
    ]);
  });

  it("imports bills as Payments, hourly, and the address is read from the encrypted copy", async () => {
    let askedFor = "";
    const r = await sync(NOW, async (url) => {
      askedFor = url;
      return { kind: "ok", text: FEED([phone, { id: "b2", name: "Rent", amount_cents: 90000, due_date: "2026-11-01", autopay: true }]), etag: null };
    });
    expect(r).toMatchObject({ synced: 1 });
    expect(askedFor).toBe(feedUrl);
    const items = await db.query<{ title: string; type: string; amount_cents: number; autopay: boolean; source: string }>("select title, type, amount_cents, autopay, source from public.items order by title");
    expect(items.rows).toEqual([
      { title: "Phone bill", type: "payment", amount_cents: 4500, autopay: false, source: "joker" },
      { title: "Rent", type: "payment", amount_cents: 90000, autopay: true, source: "joker" },
    ]);
  });

  it("marks a bill done when the feed says paid", async () => {
    await sync(NOW, async () => ({ kind: "ok", text: FEED([phone]), etag: null }));
    await sync(later(61), async () => ({ kind: "ok", text: FEED([{ ...phone, status: "paid", paid_on: "2026-10-16" }]), etag: null }));
    const r = await db.query<{ status: string }>("select status from public.items");
    expect(r.rows[0].status).toBe("done");
    expect((await db.query("select * from public.item_payments")).rows).toHaveLength(1);
  });

  it("a feed in the wrong format is explained, and nothing is lost", async () => {
    await sync(NOW, async () => ({ kind: "ok", text: FEED([phone]), etag: null }));
    const bad = await sync(later(61), async () => ({ kind: "ok", text: "<html>login page</html>", etag: null }));
    expect(bad).toMatchObject({ failed: 1 });
    const f = await db.query<{ last_error: string }>("select last_error from public.calendar_feeds");
    expect(f.rows[0].last_error).toMatch(/did not return JSON/);
    expect((await db.query("select * from public.items")).rows).toHaveLength(1);

    const wrong = await sync(later(122), async () => ({ kind: "ok", text: FEED([{ id: "x", name: "No date" }]), etag: null }));
    expect(wrong).toMatchObject({ failed: 1 });
    const f2 = await db.query<{ last_error: string }>("select last_error from public.calendar_feeds");
    expect(f2.rows[0].last_error).toMatch(/bills\[1\]\.due_date/);
  });
});
