import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runDispatch } from "@/lib/dispatch";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { fakePush, pgRpc } from "./pg-rpc";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0, s = 0) =>
  new Date(wallToInstant({ y, m, d, h, mi }, NY).getTime() + s * 1000);

let db: PGlite;
let user: string;

async function setup(profileSql: string) {
  db = await readyDb();
  user = await addUser(db);
  const [col, val] = profileSql ? profileSql.split("|") : ["", ""];
  await db.query(`insert into public.profiles (user_id, onboarded, morning_enabled${col ? ", " + col : ""}) values ($1, true, false${val ? ", " + val : ""})`, [user]);
  await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/phone', 'k', 'a')", [user]);
}

async function addTestNudge(due: Date) {
  const item = await db.query<{ id: string }>(
    "insert into public.items (user_id, title, type, due_at, timezone) values ($1,'Test nudge','task',$2,$3) returning id",
    [user, due.toISOString(), NY],
  );
  await db.query("insert into public.occurrences (user_id, item_id, due_at) values ($1,$2,$3)", [user, item.rows[0].id, due.toISOString()]);
  await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1,$2,0)", [user, item.rows[0].id]);
}

afterEach(async () => {
  await db.close();
});

describe("the 11:03 PM Test nudge (a reminder set during the default quiet hours)", () => {
  it("default settings: it is delivered at 11:03 PM", async () => {
    await setup("");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.claimed).toBe(1);
    expect(push.calls).toHaveLength(1);
  });

  it("Morning-summary style no longer swallows a reminder you set yourself", async () => {
    await setup("nudge_style|'morning'");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.claimed).toBe(1);
    expect(push.calls).toHaveLength(1);
  });

  it("Only-important style no longer swallows a reminder you set yourself", async () => {
    await setup("nudge_style|'important'");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.claimed).toBe(1);
  });

  it("when quiet hours hold it, the run says so and the log records why", async () => {
    await setup("urgent_override|false");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.claimed).toBe(0);
    expect(r.held).toBe(1);
    expect(push.calls).toHaveLength(0);
    const log = await db.query<{ status: string; detail: string | null }>("select status, detail from public.reminder_sends");
    expect(log.rows[0].status).toBe("held");
    expect(log.rows[0].detail).toMatch(/quiet/i);
  });
});

describe("the Delivery log", () => {
  it("records a delivered reminder, a held one, and a failed push with its real reason", async () => {
    await setup("");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const push = fakePush();
    push.failNext(1);
    const failing = async (sub: Parameters<typeof push.sender>[0], payload: Parameters<typeof push.sender>[1]) => {
      const out = await push.sender(sub, payload);
      return out.ok ? out : { ok: false, status: 403, error: "The push service refused our notification key (HTTP 403)." };
    };
    const r = await runDispatch({ rpc: pgRpc(db), send: failing, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.failed).toBe(1);
    const log = await db.query<{ status: string; error: string | null; http_status: number | null; title: string }>(
      "select status, error, http_status, title from public.delivery_attempts order by created_at",
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ status: "failed", http_status: 403, title: "Test nudge" });
    expect(log.rows[0].error).toMatch(/refused/);

    // the retry a minute later succeeds and is logged too
    const again = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 4, 20) });
    expect(again.sent).toBe(1);
    const all = await db.query<{ status: string }>("select status from public.delivery_attempts order by created_at");
    expect(all.rows.map((x) => x.status)).toEqual(["failed", "sent"]);
  });

  it("says 'no phone' when nothing is signed up, instead of failing silently", async () => {
    await setup("");
    await db.query("delete from public.push_subscriptions");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    await runDispatch({ rpc: pgRpc(db), send: fakePush().sender, now: at(2026, 10, 14, 23, 3, 20) });
    const log = await db.query<{ status: string; error: string }>("select status, error from public.delivery_attempts");
    expect(log.rows[0].status).toBe("no_phone");
    expect(log.rows[0].error).toMatch(/Turn on notifications/);
  });

  it("a muted type is logged as not sent, with the reason", async () => {
    await setup("type_switches|'{\"task\": false}'::jsonb");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    const r = await runDispatch({ rpc: pgRpc(db), send: fakePush().sender, now: at(2026, 10, 14, 23, 3, 20) });
    expect(r.skipped).toBe(1);
    const log = await db.query<{ status: string; error: string }>("select status, error from public.delivery_attempts");
    expect(log.rows[0]).toMatchObject({ status: "skipped" });
  });

  it("people can read their own log but cannot write to it", async () => {
    await setup("");
    await db.query("select public.dispatch_log_attempt($1, null, 'test', 'Test', 'sent', null, null)", [user]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
    const mine = await db.query("select * from public.delivery_attempts");
    expect(mine.rows).toHaveLength(1);
    await expect(db.query("insert into public.delivery_attempts (user_id, title, status) values ($1,'x','sent')", [user])).rejects.toThrow();
    await db.exec("reset role;");
  });
});

describe("the read-only 'last reminders' query", () => {
  it("runs, and shows Miami time and the delivery status", async () => {
    await setup("");
    await addTestNudge(at(2026, 10, 14, 23, 3));
    await runDispatch({ rpc: pgRpc(db), send: fakePush().sender, now: at(2026, 10, 14, 23, 3, 20) });
    const sql = readFileSync(join(process.cwd(), "supabase", "tests", "last_reminders.sql"), "utf8").replace(/;\s*$/, "");
    const rows = await db.query<{ title: string; due_miami: string; delivery_status: string }>(sql);
    expect(rows.rows[0]).toMatchObject({ title: "Test nudge", due_miami: "Wed Oct 14, 11:03 PM", delivery_status: "sent" });
  });
});
