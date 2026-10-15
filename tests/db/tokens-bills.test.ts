import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asServer, asUser, readyDb, serverLikeSupabase } from "./harness";

let db: PGlite;
let user: string;
let other: string;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db, "me@example.test");
  other = await addUser(db, "other@example.test");
  await db.query("insert into public.profiles (user_id, onboarded) values ($1, true), ($2, true)", [user, other]);
});

afterEach(async () => {
  await db.close();
});

describe("access tokens", () => {
  async function makeToken(owner: string, hash: string, extra = "") {
    await db.query(`insert into public.api_tokens (user_id, name, token_hash, token_prefix ${extra ? ", " + extra.split("|")[0] : ""}) values ($1, 'Agent', $2, 'ndg_abcd' ${extra ? ", " + extra.split("|")[1] : ""})`, [owner, hash]);
  }
  const lookup = async (hash: string) =>
    asServer(db, async () => (await db.query<{ outcome: string; user_id: string | null }>("select outcome, user_id from public.api_token_lookup($1)", [hash])).rows[0]);

  it("finds a good token, notes when it was used, and says exactly why a bad one fails", async () => {
    await makeToken(user, "hash-good");
    await makeToken(user, "hash-revoked", "revoked_at|now()");
    await makeToken(user, "hash-expired", "expires_at|now() - interval '1 day'");
    expect(await lookup("hash-good")).toEqual({ outcome: "ok", user_id: user });
    expect(await lookup("hash-revoked")).toMatchObject({ outcome: "revoked" });
    expect(await lookup("hash-expired")).toMatchObject({ outcome: "expired" });
    expect(await lookup("hash-nope")).toMatchObject({ outcome: "unknown", user_id: null });
    const used = await db.query<{ last_used_at: Date | null }>("select last_used_at from public.api_tokens where token_hash = 'hash-good'");
    expect(used.rows[0].last_used_at).not.toBeNull();
  });

  it("people see their own tokens (never the fingerprint) and can revoke them, but not touch anyone else's", async () => {
    await makeToken(user, "hash-mine");
    await makeToken(other, "hash-theirs");
    const mine = await asUser(db, user, async () => (await db.query<{ name: string }>("select id, name, token_prefix from public.api_tokens")).rows);
    expect(mine).toHaveLength(1);
    await expect(asUser(db, user, async () => db.query("select token_hash from public.api_tokens"))).rejects.toThrow(/permission denied/);
    await asUser(db, user, async () => db.query("update public.api_tokens set revoked_at = now()"));
    const rows = await db.query<{ revoked_at: Date | null; user_id: string }>("select user_id, revoked_at from public.api_tokens order by user_id");
    expect(rows.rows.find((r) => r.user_id === user)?.revoked_at).not.toBeNull();
    expect(rows.rows.find((r) => r.user_id === other)?.revoked_at).toBeNull();
  });

  it("you cannot create a token for someone else", async () => {
    await expect(
      asUser(db, user, async () => db.query("insert into public.api_tokens (user_id, name, token_hash, token_prefix) values ($1, 'x', 'h', 'p')", [other])),
    ).rejects.toThrow();
  });
});

describe("rate limiter", () => {
  it("lets the first N through in a window and blocks the rest with a wait time", async () => {
    const hit = async () =>
      asServer(db, async () => (await db.query<{ allowed: boolean; retry_after: number }>("select * from public.api_rate_hit('t1', 3, 60)")).rows[0]);
    const results = [await hit(), await hit(), await hit(), await hit()];
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retry_after).toBeGreaterThanOrEqual(1);
    expect(results[3].retry_after).toBeLessThanOrEqual(60);
    const other = await asServer(db, async () => (await db.query<{ allowed: boolean }>("select * from public.api_rate_hit('t2', 3, 60)")).rows[0]);
    expect(other.allowed).toBe(true);
  });
});

describe("Joker bills sync", () => {
  let feed: string;
  const NOW = "2026-10-15T14:00:00Z";
  const bills = (list: unknown[]) => JSON.stringify(list);
  const apply = async (list: unknown[] | null, error: string | null = null) =>
    asServer(db, async () => {
      const r = await db.query<{ dispatch_bills_apply: Record<string, number | boolean> }>(
        "select public.dispatch_bills_apply($1, $2::jsonb, 'e1', $3, $4::timestamptz)",
        [feed, list === null ? null : bills(list), error, NOW],
      );
      return r.rows[0].dispatch_bills_apply;
    });

  beforeEach(async () => {
    await serverLikeSupabase(db);
    const r = await db.query<{ id: string }>(
      "insert into public.calendar_feeds (user_id, name, url_encrypted, host, kind, default_type, interval_minutes) values ($1, 'Joker', 'x', 'joker.example', 'bills', 'payment', 60) returning id",
      [user],
    );
    feed = r.rows[0].id;
  });

  const phone = { id: "b1", name: "Phone bill", amount_cents: 4500, currency: "USD", due_date: "2026-10-20", status: "unpaid", autopay: false };
  const rent = { id: "b2", name: "Rent", amount_cents: 90000, currency: "USD", due_date: "2026-11-01", status: "unpaid", autopay: true };

  it("creates payments with reminders, due at the end of the day in New York", async () => {
    const r = await apply([phone, rent]);
    expect(r).toMatchObject({ created: 2, paid: 0 });
    const items = await db.query<{ title: string; type: string; due_at: Date; amount_cents: number; autopay: boolean; source: string }>(
      "select title, type, due_at, amount_cents, autopay, source from public.items order by title",
    );
    expect(items.rows.map((i) => [i.title, i.type, i.amount_cents, i.autopay, i.source])).toEqual([
      ["Phone bill", "payment", 4500, false, "joker"],
      ["Rent", "payment", 90000, true, "joker"],
    ]);
    expect(new Date(items.rows[0].due_at).toISOString()).toBe("2026-10-21T03:59:00.000Z"); // 11:59 PM EDT on Oct 20
    const rem = await db.query("select * from public.reminders");
    expect(rem.rows).toHaveLength(4);
  });

  it("running it again never duplicates", async () => {
    await apply([phone, rent]);
    const again = await apply([phone, rent]);
    expect(again).toMatchObject({ created: 0, changed: 0, paid: 0, removed: 0 });
    const n = await db.query<{ n: string }>("select count(*)::text as n from public.items");
    expect(n.rows[0].n).toBe("2");
  });

  it("marks a bill done when the feed says paid, and records the payment once", async () => {
    await apply([phone, rent]);
    const paid = await apply([{ ...phone, status: "paid", paid_on: "2026-10-18" }, rent]);
    expect(paid).toMatchObject({ paid: 1 });
    const done = await db.query<{ status: string }>("select status from public.items where title = 'Phone bill'");
    expect(done.rows[0].status).toBe("done");
    const occ = await db.query<{ status: string }>("select o.status from public.occurrences o join public.items i on i.id = o.item_id where i.title = 'Phone bill'");
    expect(occ.rows[0].status).toBe("done");
    const pays = await db.query<{ amount_cents: number; paid_on: string }>("select amount_cents, paid_on::text from public.item_payments");
    expect(pays.rows).toEqual([{ amount_cents: 4500, paid_on: "2026-10-18" }]);
    // and again: nothing more happens
    await apply([{ ...phone, status: "paid", paid_on: "2026-10-18" }, rent]);
    expect((await db.query("select * from public.item_payments")).rows).toHaveLength(1);
  });

  it("follows a moved date or changed amount, and archives a bill that disappears", async () => {
    await apply([phone, rent]);
    const r = await apply([{ ...phone, due_date: "2026-10-25", amount_cents: 4700 }]);
    expect(r).toMatchObject({ changed: 1, removed: 1 });
    const i = await db.query<{ title: string; amount_cents: number; status: string }>("select title, amount_cents, status from public.items order by title");
    expect(i.rows).toEqual([
      { title: "Phone bill", amount_cents: 4700, status: "open" },
      { title: "Rent", amount_cents: 90000, status: "archived" },
    ]);
    const occ = await db.query("select o.due_at from public.occurrences o join public.items i on i.id = o.item_id where i.title = 'Phone bill' and o.status = 'open'");
    expect(occ.rows).toHaveLength(1);
  });

  it("a bill you paid yourself in Nudge stays paid even if the feed still says unpaid", async () => {
    await apply([phone]);
    await db.query("update public.items set status = 'done' where title = 'Phone bill'");
    await db.query("update public.occurrences set status = 'done'");
    await apply([phone]);
    const i = await db.query<{ status: string }>("select status from public.items");
    expect(i.rows[0].status).toBe("done");
  });

  it("records a feed problem in plain words and keeps everything else", async () => {
    await apply([phone]);
    const r = await apply(null, "The bills link answered 404.");
    expect(r).toMatchObject({ error: true });
    const f = await db.query<{ last_error: string }>("select last_error from public.calendar_feeds where id = $1", [feed]);
    expect(f.rows[0].last_error).toMatch(/404/);
    expect((await db.query("select * from public.items")).rows).toHaveLength(1);
  });

  it("hourly feeds are not handed out again within the hour, 30-minute ones are", async () => {
    await db.query("insert into public.calendar_feeds (user_id, name, url_encrypted, host, kind, interval_minutes) values ($1, 'Cal', 'x', 'c.example', 'calendar', 30)", [user]);
    const first = await asServer(db, async () => (await db.query<{ kind: string }>("select kind from public.dispatch_feeds_due($1::timestamptz, 5)", [NOW])).rows);
    expect(first.map((r) => r.kind).sort()).toEqual(["bills", "calendar"]);
    const later = await asServer(db, async () => (await db.query<{ kind: string }>("select kind from public.dispatch_feeds_due($1::timestamptz, 5)", ["2026-10-15T14:35:00Z"])).rows);
    expect(later.map((r) => r.kind)).toEqual(["calendar"]);
    const hour = await asServer(db, async () => (await db.query<{ kind: string }>("select kind from public.dispatch_feeds_due($1::timestamptz, 5)", ["2026-10-15T15:06:00Z"])).rows);
    expect(hour.map((r) => r.kind).sort()).toEqual(["bills", "calendar"]);
  });
});

describe("checklists and habit summaries", () => {
  it("a checklist belongs to its owner only", async () => {
    const item = await db.query<{ id: string }>("insert into public.items (user_id, title, type) values ($1, 'Game day', 'work') returning id", [user]);
    await asUser(db, user, async () => db.query("insert into public.item_checklist (user_id, item_id, text) values ($1, $2, 'Bring cones')", [user, item.rows[0].id]));
    const seen = await asUser(db, other, async () => (await db.query("select * from public.item_checklist")).rows);
    expect(seen).toHaveLength(0);
    await db.query("delete from public.items");
    expect((await db.query("select * from public.item_checklist")).rows).toHaveLength(0); // goes with the item
  });

  it("the new item kinds are accepted, and an unknown one is not", async () => {
    for (const type of ["work", "habit", "birthday", "renewal"]) {
      await db.query("insert into public.items (user_id, title, type) values ($1, $2, $3)", [user, type, type]);
    }
    await expect(db.query("insert into public.items (user_id, title, type) values ($1, 'x', 'wizard')", [user])).rejects.toThrow();
  });

  it("the habit summary goes out once a day, only when something is still open, and only if switched on", async () => {
    await db.query("update public.profiles set features = '{\"habits\": true}', prefs = '{\"habit_summary\": true, \"habit_summary_time\": \"20:00\"}' where user_id = $1", [user]);
    const item = await db.query<{ id: string }>("insert into public.items (user_id, title, type, due_at, rrule) values ($1, 'Read', 'habit', '2026-10-15T23:00:00Z', 'FREQ=DAILY') returning id", [user]);
    await db.query("insert into public.occurrences (user_id, item_id, due_at) values ($1, $2, '2026-10-15T23:00:00Z')", [user, item.rows[0].id]);
    const run = async (at: string) =>
      asServer(db, async () => (await db.query<{ pending: number }>("select pending from public.dispatch_habit_summaries($1::timestamptz)", [at])).rows);
    expect(await run("2026-10-15T23:30:00Z")).toHaveLength(0); // 7:30 PM New York: too early
    expect(await run("2026-10-16T00:10:00Z")).toEqual([{ pending: 1 }]); // 8:10 PM
    expect(await run("2026-10-16T00:20:00Z")).toHaveLength(0); // already sent today
  });
});
