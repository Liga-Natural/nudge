import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runDispatch } from "@/lib/dispatch";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { fakePush, pgRpc } from "./pg-rpc";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0, s = 0) => new Date(wallToInstant({ y, m, d, h, mi }, NY).getTime() + s * 1000);

let db: PGlite;
let user: string;

async function setup() {
  db = await readyDb();
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded, morning_enabled, urgent_override) values ($1, true, false, false)", [user]);
  await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/phone', 'k', 'a')", [user]);
}

async function addNudge(due: Date, ringAnyway: boolean) {
  const item = await db.query<{ id: string }>(
    "insert into public.items (user_id, title, type, due_at, timezone, ring_anyway) values ($1,'Late nudge','task',$2,$3,$4) returning id",
    [user, due.toISOString(), NY, ringAnyway],
  );
  await db.query("insert into public.occurrences (user_id, item_id, due_at) values ($1,$2,$3)", [user, item.rows[0].id, due.toISOString()]);
  await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1,$2,0)", [user, item.rows[0].id]);
}

afterEach(async () => {
  await db.close();
});

describe("11:05 PM reminder inside quiet hours", () => {
  it("is held, logged with the release time, and actually sent when quiet hours end", async () => {
    await setup();
    await addNudge(at(2026, 10, 14, 23, 5), false);
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 5, 20) });
    expect(r.held).toBe(1);
    expect(push.calls).toHaveLength(0);

    const log = await db.query<{ status: string; error: string | null }>("select status, error from public.delivery_attempts");
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].status).toBe("held");
    expect(log.rows[0].error).toBe("Held — quiet hours, will send at 7:00 AM");

    // The next morning's clock releases it.
    const early = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 6, 59) });
    expect(early.claimed).toBe(0);
    const morning = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 15, 7, 0, 10) });
    expect(morning.sent).toBe(1);
    expect(push.calls).toHaveLength(1);
  });

  it("rings straight away when you chose Ring anyway", async () => {
    await setup();
    await addNudge(at(2026, 10, 14, 23, 5), true);
    const push = fakePush();
    const r = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 23, 5, 20) });
    expect(r.held).toBe(0);
    expect(r.sent).toBe(1);
    expect(push.calls).toHaveLength(1);
  });
});
