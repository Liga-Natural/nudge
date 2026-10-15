import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runDispatch } from "@/lib/dispatch";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { fakePush, pgRpc } from "./pg-rpc";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0) => wallToInstant({ y, m, d, h, mi }, NY);

let db: PGlite;
let user: string;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded, morning_enabled, quiet_start, quiet_end) values ($1, true, false, '00:00', '00:00')", [user]);
  await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/phone', 'k', 'a')", [user]);
});
afterEach(async () => db.close());

describe("New grade pushes", () => {
  async function newGrade(title: string, score: number) {
    const c = await db.query<{ id: string }>("insert into public.courses (user_id, name) values ($1, 'Math 101') on conflict (user_id, name) do update set name = excluded.name returning id", [user]);
    await db.query("insert into public.grades (user_id, course_id, title, score, out_of, source, external_id) values ($1, $2, $3, $4, 20, 'classroom', $3)", [user, c.rows[0].id, title, score]);
  }

  it("says 'New grade posted in <class>' once, even if the clock runs twice", async () => {
    await newGrade("Quiz 2", 18);
    const push = fakePush();
    const now = at(2026, 10, 15, 12);
    const [a, b] = await Promise.all([runDispatch({ rpc: pgRpc(db), send: push.sender, now }), runDispatch({ rpc: pgRpc(db), send: push.sender, now })]);
    void a;
    void b;
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.title).toBe("New grade posted in Math 101");
    expect(push.calls[0].payload.body).toBe("Quiz 2: 18/20 (90%)");
    expect(push.calls[0].payload.url).toBe("/grades");
    const again = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: again.sender, now: at(2026, 10, 15, 12, 1) });
    expect(again.calls).toHaveLength(0);
  });

  it("two grades in one class arrive as one push", async () => {
    await newGrade("Quiz 2", 18);
    await newGrade("Quiz 3", 20);
    const push = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 12) });
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.body).toContain("Quiz 2");
    expect(push.calls[0].payload.body).toContain("Quiz 3");
  });

  it("a push that fails puts the grade back in the queue, and it is logged", async () => {
    await newGrade("Quiz 2", 18);
    const push = fakePush();
    push.failNext(1);
    await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 12) });
    expect(push.calls).toHaveLength(0);
    const retry = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: retry.sender, now: at(2026, 10, 15, 12, 1) });
    expect(retry.calls).toHaveLength(1);
    const log = await db.query<{ kind: string; status: string }>("select kind, status from public.delivery_attempts order by created_at");
    expect(log.rows).toEqual([
      { kind: "grade", status: "failed" },
      { kind: "grade", status: "sent" },
    ]);
  });
});

describe("habits: one summary instead of many pings", () => {
  async function habit() {
    await db.query("update public.profiles set features = '{\"habits\": true}', prefs = '{\"habit_summary\": true, \"habit_summary_time\": \"20:00\"}'");
    const due = at(2026, 10, 15, 9);
    const item = await db.query<{ id: string }>("insert into public.items (user_id, title, type, due_at, rrule, timezone) values ($1, 'Read 20 pages', 'habit', $2, 'FREQ=DAILY', $3) returning id", [user, due.toISOString(), NY]);
    await db.query("insert into public.occurrences (user_id, item_id, due_at) values ($1, $2, $3)", [user, item.rows[0].id, due.toISOString()]);
    await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1, $2, 0)", [user, item.rows[0].id]);
  }

  it("the habit's own ping is not sent (the log says why); the evening summary is, once", async () => {
    await habit();
    const morning = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: morning.sender, now: at(2026, 10, 15, 9) });
    expect(morning.calls).toHaveLength(0);
    expect(r.skipped).toBe(1);
    const why = await db.query<{ status: string; error: string }>("select status, error from public.delivery_attempts");
    expect(why.rows[0].status).toBe("skipped");
    expect(why.rows[0].error).toMatch(/habit summary/i);

    const evening = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: evening.sender, now: at(2026, 10, 15, 20, 5) });
    expect(evening.calls).toHaveLength(1);
    expect(evening.calls[0].payload.title).toMatch(/Habits/);
    expect(evening.calls[0].payload.body).toBe("1 of 1 habit still to do today");

    const again = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: again.sender, now: at(2026, 10, 15, 20, 20) });
    expect(again.calls).toHaveLength(0);
  });

  it("without the summary switched on, a habit pings like any other reminder", async () => {
    await habit();
    await db.query("update public.profiles set prefs = '{}'");
    const push = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 9) });
    expect(push.calls).toHaveLength(1);
  });
});

describe("tapping a notification", () => {
  it("opens the item with the quick buttons on top, and carries Android buttons too", async () => {
    const due = at(2026, 10, 15, 9);
    const item = await db.query<{ id: string }>("insert into public.items (user_id, title, type, due_at, timezone) values ($1, 'Call mom', 'task', $2, $3) returning id", [user, due.toISOString(), NY]);
    const occ = await db.query<{ id: string }>("insert into public.occurrences (user_id, item_id, due_at) values ($1, $2, $3) returning id", [user, item.rows[0].id, due.toISOString()]);
    await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1, $2, 0)", [user, item.rows[0].id]);
    const push = fakePush();
    await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 9) });
    const p = push.calls[0].payload;
    expect(p.url).toBe(`/item/${item.rows[0].id}?occ=${occ.rows[0].id}&quick=1`);
    expect(p.occ).toBe(occ.rows[0].id);
    expect(p.actions?.map((a) => a.action)).toEqual(["done", "snooze10", "snooze60"]);
  });
});
