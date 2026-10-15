import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asAnon, asServer, asUser, readyDb } from "./harness";

let db: PGlite;
let alice: string;
let bob: string;
let aliceItem: string;

beforeAll(async () => {
  db = await readyDb();
  alice = await addUser(db, "alice@example.test");
  bob = await addUser(db, "bob@example.test");
  await asUser(db, alice, async () => {
    await db.query("select public.ensure_profile()");
    const r = await db.query<{ id: string }>(
      "insert into public.items (user_id, title, due_at) values ($1, 'Alice private', now() + interval '1 day') returning id",
      [alice],
    );
    aliceItem = r.rows[0].id;
    await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1, $2, 0)", [alice, aliceItem]);
    await db.query("select public.sync_item_occurrences($1, array[now() + interval '1 day'])", [aliceItem]);
  });
});

describe("a stranger sees nothing", () => {
  it("signed-in stranger reads zero rows from every table", async () => {
    await asUser(db, bob, async () => {
      await db.query("select public.ensure_profile()");
      for (const t of ["items", "occurrences", "reminders", "item_events", "reminder_sends"]) {
        const r = await db.query(`select * from public.${t}`);
        expect(r.rows, t).toEqual([]);
      }
      const p = await db.query<{ user_id: string }>("select user_id from public.profiles");
      expect(p.rows.map((x) => x.user_id)).toEqual([bob]);
    });
  });

  it("a stranger cannot change or delete someone else's item", async () => {
    await asUser(db, bob, async () => {
      const u = await db.query("update public.items set title = 'hacked' where id = $1 returning id", [aliceItem]);
      expect(u.rows).toEqual([]);
      const d = await db.query("delete from public.items where id = $1 returning id", [aliceItem]);
      expect(d.rows).toEqual([]);
    });
    const still = await db.query<{ title: string }>("select title from public.items where id = $1", [aliceItem]);
    expect(still.rows[0].title).toBe("Alice private");
  });

  it("a stranger cannot write rows that claim to belong to someone else", async () => {
    await asUser(db, bob, async () => {
      await expect(
        db.query("insert into public.items (user_id, title) values ($1, 'planted')", [alice]),
      ).rejects.toThrow();
    });
  });

  it("a stranger cannot sync someone else's occurrences", async () => {
    await asUser(db, bob, async () => {
      await expect(db.query("select public.sync_item_occurrences($1, array[now()])", [aliceItem])).rejects.toThrow();
    });
  });
});

describe("signed-out visitors", () => {
  it("get permission denied everywhere", async () => {
    await asAnon(db, async () => {
      for (const t of ["profiles", "spaces", "items", "occurrences", "reminders", "reminder_sends", "push_subscriptions", "dispatch_log"]) {
        await expect(db.query(`select * from public.${t}`), t).rejects.toThrow(/permission denied/);
      }
    });
  });
});

describe("server-only parts", () => {
  it("signed-in users cannot read the logs or run the clock functions", async () => {
    await asUser(db, alice, async () => {
      await expect(db.query("select * from public.dispatch_log")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.summary_sends")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.dispatch_claim(now())")).rejects.toThrow(/permission denied/);
    });
  });

  it("the server key can run the clock functions", async () => {
    await asServer(db, async () => {
      const r = await db.query("select * from public.dispatch_claim(now())");
      expect(Array.isArray(r.rows)).toBe(true);
    });
  });
});
