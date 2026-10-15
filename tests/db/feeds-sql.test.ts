import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asAnon, asUser, readyDb } from "./harness";

let db: PGlite;
let user: string;
let feed: string;

const NOW = "2026-10-14T20:00:00Z";
const ev = (uid: string, extra: Record<string, unknown> = {}) => ({
  uid,
  title: `Event ${uid}`,
  due_at: "2026-10-20T03:59:00Z",
  all_day: true,
  notes: null,
  rrule: null,
  cancelled: false,
  amount_cents: null,
  reminders: [{ days_before: 1, at_time: "18:00" }],
  ...extra,
});

async function apply(events: unknown[] | null, opts: { etag?: string | null; error?: string | null; at?: string } = {}) {
  const r = await db.query<{ r: Record<string, number> }>(
    "select public.dispatch_feed_apply($1, $2::jsonb, $3, $4, $5) as r",
    [feed, events === null ? null : JSON.stringify(events), opts.etag ?? null, opts.error ?? null, opts.at ?? NOW],
  );
  return r.rows[0].r;
}

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded) values ($1, true)", [user]);
  const f = await db.query<{ id: string }>(
    "insert into public.calendar_feeds (user_id, name, url_encrypted, default_type) values ($1, 'School', 'ciphertext', 'homework') returning id",
    [user],
  );
  feed = f.rows[0].id;
});

afterEach(async () => {
  await db.close();
});

describe("which feeds are due", () => {
  it("hands out a feed once, then again after 30 minutes", async () => {
    const first = await db.query("select * from public.dispatch_feeds_due($1)", [NOW]);
    expect(first.rows).toHaveLength(1);
    expect((first.rows[0] as { timezone: string }).timezone).toBe("America/New_York");
    expect((await db.query("select * from public.dispatch_feeds_due($1)", [NOW])).rows).toHaveLength(0);
    expect((await db.query("select * from public.dispatch_feeds_due($1)", ["2026-10-14T20:29:00Z"])).rows).toHaveLength(0);
    expect((await db.query("select * from public.dispatch_feeds_due($1)", ["2026-10-14T20:31:00Z"])).rows).toHaveLength(1);
  });

  it("skips switched-off feeds, and 'Sync now' (clearing the time) makes one due at once", async () => {
    await db.query("update public.calendar_feeds set enabled = false");
    expect((await db.query("select * from public.dispatch_feeds_due($1)", [NOW])).rows).toHaveLength(0);
    await db.query("update public.calendar_feeds set enabled = true, last_synced_at = now()");
    expect((await db.query("select * from public.dispatch_feeds_due($1)", [NOW])).rows).toHaveLength(0);
    await db.query("update public.calendar_feeds set last_synced_at = null");
    expect((await db.query("select * from public.dispatch_feeds_due($1)", [NOW])).rows).toHaveLength(1);
  });
});

describe("applying a feed", () => {
  it("creates items, times, reminders and an update for each new event", async () => {
    const r = await apply([ev("a"), ev("b", { due_at: "2026-10-22T20:00:00Z", all_day: false })]);
    expect(r).toMatchObject({ created: 2, changed: 0, removed: 0 });
    expect(await count("public.items where feed_id = $1 and source = 'ics' and type = 'homework'", [feed])).toBe(2);
    expect(await count("public.occurrences")).toBe(2);
    expect(await count("public.reminders")).toBe(2);
    expect(await count("public.updates where kind = 'new_item'")).toBe(2);
  });

  it("running the same feed again changes nothing (no duplicates)", async () => {
    await apply([ev("a"), ev("b")]);
    const again = await apply([ev("a"), ev("b")]);
    expect(again).toMatchObject({ created: 0, changed: 0, removed: 0 });
    expect(await count("public.items")).toBe(2);
    expect(await count("public.occurrences")).toBe(2);
    expect(await count("public.updates")).toBe(2);
  });

  it("a moved date moves the open time and says so in Updates", async () => {
    await apply([ev("a")]);
    const r = await apply([ev("a", { due_at: "2026-10-25T03:59:00Z" })]);
    expect(r).toMatchObject({ changed: 1 });
    const occ = await db.query<{ due_at: Date }>("select due_at from public.occurrences");
    expect(occ.rows).toHaveLength(1);
    expect(occ.rows[0].due_at.toISOString()).toBe("2026-10-25T03:59:00.000Z");
    expect(await count("public.updates where kind = 'changed'")).toBe(1);
  });

  it("keeps what you did: done stays done, snoozes survive a refresh", async () => {
    await apply([ev("a"), ev("b")]);
    const a = await db.query<{ id: string }>("select id from public.items where external_uid = 'a'");
    await db.query("update public.items set status = 'done' where id = $1", [a.rows[0].id]);
    await db.query("update public.occurrences set status = 'done' where item_id = $1", [a.rows[0].id]);
    const b = await db.query<{ id: string }>("select id from public.items where external_uid = 'b'");
    await db.query("update public.occurrences set snoozed_until = $2, snooze_count = 1 where item_id = $1", [b.rows[0].id, "2026-10-21T12:00:00Z"]);

    await apply([ev("a", { due_at: "2026-10-30T03:59:00Z" }), ev("b")]);
    expect((await db.query<{ status: string }>("select status from public.items where external_uid = 'a'")).rows[0].status).toBe("done");
    expect(await count("public.occurrences where item_id = $1 and status = 'done'", [a.rows[0].id])).toBe(1);
    const snooze = await db.query<{ snooze_count: number }>("select snooze_count from public.occurrences where item_id = $1", [b.rows[0].id]);
    expect(snooze.rows[0].snooze_count).toBe(1);
  });

  it("does not override an item you edited yourself", async () => {
    await apply([ev("a")]);
    await db.query("update public.items set title = 'My own title', locally_edited = true");
    await apply([ev("a", { title: "Feed title" })]);
    expect((await db.query<{ title: string }>("select title from public.items")).rows[0].title).toBe("My own title");
  });

  it("archives events that disappeared, and brings them back if they return", async () => {
    await apply([ev("a"), ev("b")]);
    const gone = await apply([ev("a")]);
    expect(gone).toMatchObject({ removed: 1 });
    expect((await db.query<{ status: string }>("select status from public.items where external_uid = 'b'")).rows[0].status).toBe("archived");
    expect(await count("public.updates where kind = 'removed'")).toBe(1);
    await apply([ev("a"), ev("b")]);
    expect((await db.query<{ status: string }>("select status from public.items where external_uid = 'b'")).rows[0].status).toBe("open");
  });

  it("a cancelled event archives its item", async () => {
    await apply([ev("a")]);
    await apply([ev("a", { cancelled: true })]);
    expect((await db.query<{ status: string }>("select status from public.items")).rows[0].status).toBe("archived");
  });

  it("amounts and repeat rules come through", async () => {
    await apply([ev("rent", { amount_cents: 90000, rrule: "FREQ=MONTHLY" })]);
    const row = await db.query<{ amount_cents: number; rrule: string }>("select amount_cents, rrule from public.items");
    expect(row.rows[0]).toMatchObject({ amount_cents: 90000, rrule: "FREQ=MONTHLY" });
  });

  it("a failed fetch records the problem and keeps everything as it was", async () => {
    await apply([ev("a")]);
    const r = await apply(null, { error: "The feed address did not answer." });
    expect(r).toMatchObject({ error: true });
    expect(await count("public.items where status = 'open'")).toBe(1);
    const row = await db.query<{ last_error: string }>("select last_error from public.calendar_feeds");
    expect(row.rows[0].last_error).toMatch(/did not answer/);
  });

  it("'not modified' keeps everything and clears the last error", async () => {
    await apply([ev("a")]);
    await db.query("update public.calendar_feeds set last_error = 'old problem'");
    await apply(null, { etag: "abc" });
    const row = await db.query<{ last_error: string | null; etag: string }>("select last_error, etag from public.calendar_feeds");
    expect(row.rows[0]).toMatchObject({ last_error: null, etag: "abc" });
    expect(await count("public.items where status = 'open'")).toBe(1);
  });

  it("an empty but valid feed archives everything that was open", async () => {
    await apply([ev("a"), ev("b")]);
    const r = await apply([]);
    expect(r).toMatchObject({ removed: 2 });
  });
});

describe("the clock sees the push wording facts", () => {
  it("autopay and course name", async () => {
    const course = await db.query<{ id: string }>("insert into public.courses (user_id, name) values ($1, 'Math') returning id", [user]);
    const item = await db.query<{ id: string }>(
      "insert into public.items (user_id, title, type, autopay, course_id) values ($1, 'Rent', 'payment', true, $2) returning id",
      [user, course.rows[0].id],
    );
    const r = await db.query<{ autopay: boolean; course_name: string }>("select * from public.dispatch_item_flags(array[$1]::uuid[])", [item.rows[0].id]);
    expect(r.rows[0]).toMatchObject({ autopay: true, course_name: "Math" });
  });
});

describe("new tables are locked down", () => {
  it("a stranger sees none of the new tables", async () => {
    const other = await addUser(db, "other@example.test");
    await db.query("insert into public.courses (user_id, name) values ($1, 'Math')", [user]);
    await db.query("insert into public.updates (user_id, kind, title) values ($1, 'info', 'hello')", [user]);
    await apply([ev("a")]);
    await asUser(db, other, async () => {
      for (const t of ["courses", "calendar_feeds", "item_payments", "updates"]) {
        expect((await db.query(`select * from public.${t}`)).rows, t).toEqual([]);
      }
      await expect(db.query("insert into public.courses (user_id, name) values ($1, 'x')", [user])).rejects.toThrow();
    });
    await asAnon(db, async () => {
      for (const t of ["courses", "calendar_feeds", "item_payments", "updates"]) {
        await expect(db.query(`select * from public.${t}`), t).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("the owner can use them", async () => {
    await asUser(db, user, async () => {
      await db.query("insert into public.courses (user_id, name, color) values ($1, 'Art', '#ffeedd')", [user]);
      await expect(db.query("insert into public.courses (user_id, name, color) values ($1, 'Bad', 'red')", [user])).rejects.toThrow();
      expect((await db.query("select * from public.courses")).rows).toHaveLength(1);
    });
  });
});
