import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runDispatch } from "@/lib/dispatch";
import { expandRule } from "@/lib/recurrence";
import { fireTime, type ReminderSpec } from "@/lib/reminders";
import { wallToInstant } from "@/lib/time";
import { addUser, readyDb } from "./harness";
import { fakePush, pgRpc } from "./pg-rpc";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h: number, mi = 0, s = 0) =>
  new Date(wallToInstant({ y, m, d, h, mi }, NY).getTime() + s * 1000);

let db: PGlite;
let user: string;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db);
  // Start with the summary and quiet hours off, so each test controls only what it is about.
  await db.query(
    "insert into public.profiles (user_id, onboarded, morning_enabled, quiet_start, quiet_end) values ($1, true, false, '00:00', '00:00')",
    [user],
  );
  await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/phone', 'k', 'a')", [user]);
});

afterEach(async () => {
  await db.close();
});

type NewItem = {
  title?: string;
  due: Date;
  type?: string;
  allDay?: boolean;
  priority?: number;
  rrule?: string;
  reminders: ReminderSpec[];
};

async function addItem(o: NewItem) {
  const item = await db.query<{ id: string }>(
    "insert into public.items (user_id, title, type, due_at, all_day, timezone, priority, rrule) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [user, o.title ?? "Thing", o.type ?? "task", o.due.toISOString(), o.allDay ?? false, NY, o.priority ?? 0, o.rrule ?? null],
  );
  const itemId = item.rows[0].id;
  const occ = await db.query<{ id: string }>(
    "insert into public.occurrences (user_id, item_id, due_at) values ($1,$2,$3) returning id",
    [user, itemId, o.due.toISOString()],
  );
  for (const r of o.reminders) {
    if ("offsetMinutes" in r) {
      await db.query("insert into public.reminders (user_id, item_id, offset_minutes) values ($1,$2,$3)", [user, itemId, r.offsetMinutes]);
    } else {
      await db.query("insert into public.reminders (user_id, item_id, days_before, at_time) values ($1,$2,$3,$4)", [user, itemId, r.daysBefore, r.atTime]);
    }
  }
  return { itemId, occId: occ.rows[0].id };
}

async function tick(now: Date, extra: Partial<Parameters<typeof runDispatch>[0]> = {}) {
  const push = fakePush();
  const result = await runDispatch({ rpc: pgRpc(db), send: push.sender, now, ...extra });
  return { push, result };
}

describe("on time, once", () => {
  it("a 11:59 PM item reminds at 11:59 PM and not a second before", async () => {
    await addItem({ due: at(2026, 10, 14, 23, 59), reminders: [{ offsetMinutes: 0 }] });
    expect((await tick(at(2026, 10, 14, 23, 58, 59))).push.calls).toHaveLength(0);
    const hit = await tick(at(2026, 10, 14, 23, 59, 5));
    expect(hit.push.calls).toHaveLength(1);
    expect(hit.push.calls[0].payload.body).toMatch(/now/i);
  });

  it("running the clock again in the same minute sends nothing new", async () => {
    await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const first = await tick(at(2026, 10, 14, 9, 0, 10));
    const second = await tick(at(2026, 10, 14, 9, 0, 40));
    const third = await tick(at(2026, 10, 14, 9, 1, 30)); // still inside the 2 minute window
    expect(first.push.calls).toHaveLength(1);
    expect(second.push.calls).toHaveLength(0);
    expect(third.push.calls).toHaveLength(0);
  });

  it("two clocks firing at the very same moment still send once", async () => {
    await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const now = at(2026, 10, 14, 9, 0, 10);
    const a = fakePush();
    const b = fakePush();
    await Promise.all([
      runDispatch({ rpc: pgRpc(db), send: a.sender, now }),
      runDispatch({ rpc: pgRpc(db), send: b.sender, now }),
    ]);
    expect(a.calls.length + b.calls.length).toBe(1);
    const sent = await db.query("select count(*)::int as n from public.reminder_sends where status = 'sent'");
    expect((sent.rows[0] as { n: number }).n).toBe(1);
  });

  it("a send that fails is retried next minute and arrives once", async () => {
    await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const push = fakePush();
    push.failNext(1);
    const t1 = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 9, 0, 10) });
    expect(t1.failed).toBe(1);
    expect(push.calls).toHaveLength(0);
    const t2 = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 9, 1, 10) });
    expect(t2.sent).toBe(1);
    expect(push.calls).toHaveLength(1);
    const t3 = await runDispatch({ rpc: pgRpc(db), send: push.sender, now: at(2026, 10, 14, 9, 2, 10) });
    expect(t3.sent).toBe(0);
    expect(push.calls).toHaveLength(1);
  });

  it("a clock that crashed after claiming is rescued once, not endlessly", async () => {
    const { occId } = await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query(
      "insert into public.reminder_sends (user_id, occurrence_id, key, fire_at, status, claimed_at) select $1, $2, 'r:' || id::text, $3, 'claimed', $3 from public.reminders limit 1",
      [user, occId, at(2026, 10, 14, 9, 0).toISOString()],
    );
    expect((await tick(at(2026, 10, 14, 9, 1))).push.calls).toHaveLength(0); // too soon to call it a crash
    expect((await tick(at(2026, 10, 14, 9, 5))).push.calls).toHaveLength(1);
    expect((await tick(at(2026, 10, 14, 9, 10))).push.calls).toHaveLength(0);
  });

  it("reminders due in the same minute become one notification", async () => {
    await addItem({ title: "One", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await addItem({ title: "Two", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await addItem({ title: "Three", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const { push } = await tick(at(2026, 10, 14, 9, 0, 5));
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.title).toMatch(/3 reminders/);
  });
});

describe("never for finished things", () => {
  it("done before the reminder means no reminder", async () => {
    const { occId } = await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query("update public.occurrences set status = 'done' where id = $1", [occId]);
    expect((await tick(at(2026, 10, 14, 9, 0, 5))).push.calls).toHaveLength(0);
  });

  it("an item marked done as a whole sends nothing", async () => {
    const { itemId } = await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query("update public.items set status = 'done' where id = $1", [itemId]);
    expect((await tick(at(2026, 10, 14, 9, 0, 5))).push.calls).toHaveLength(0);
  });

  it("a muted type or muted space sends nothing", async () => {
    await addItem({ type: "homework", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query(`update public.profiles set type_switches = '{"homework": false}' where user_id = $1`, [user]);
    expect((await tick(at(2026, 10, 14, 9, 0, 5))).push.calls).toHaveLength(0);
  });
});

describe("daylight saving", () => {
  it("1 day before at 6 PM, for a 9 AM item the morning clocks spring forward", async () => {
    await addItem({ due: at(2026, 3, 8, 9, 0), reminders: [{ daysBefore: 1, atTime: "18:00" }] });
    const fire = at(2026, 3, 7, 18, 0); // still EST
    expect(fire.toISOString()).toBe("2026-03-07T23:00:00.000Z");
    expect((await tick(new Date(fire.getTime() - 5000))).push.calls).toHaveLength(0);
    expect((await tick(new Date(fire.getTime() + 5000))).push.calls).toHaveLength(1);
  });

  it("the day-of 9 AM reminder fires at 9 AM EDT on the spring-forward morning", async () => {
    await addItem({ type: "payment", allDay: true, due: at(2026, 3, 8, 23, 59), reminders: [{ daysBefore: 0, atTime: "09:00" }] });
    const fire = at(2026, 3, 8, 9, 0);
    expect(fire.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect((await tick(new Date(fire.getTime() + 5000))).push.calls).toHaveLength(1);
  });

  it("the fall-back day: 6 PM the evening before is 6 PM EST", async () => {
    await addItem({ due: at(2026, 11, 2, 9, 0), reminders: [{ daysBefore: 1, atTime: "18:00" }] });
    const fire = at(2026, 11, 1, 18, 0);
    expect(fire.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect((await tick(new Date(fire.getTime() + 5000))).push.calls).toHaveLength(1);
  });

  it("a repeating 9 AM reminder fires at 9 AM every day across the change", async () => {
    const dues = expandRule({ rule: "FREQ=DAILY", start: at(2026, 3, 6, 9), tz: NY, to: at(2026, 3, 10, 9) });
    const { itemId } = await addItem({ due: dues[0], rrule: "FREQ=DAILY", reminders: [{ offsetMinutes: 0 }] });
    for (const d of dues.slice(1)) {
      await db.query("insert into public.occurrences (user_id, item_id, due_at) values ($1,$2,$3)", [user, itemId, d.toISOString()]);
    }
    let sent = 0;
    for (const d of dues) sent += (await tick(new Date(d.getTime() + 5000))).push.calls.length;
    expect(sent).toBe(dues.length);
  });
});

describe("the TypeScript and SQL agree on when reminders fire", () => {
  const specs: ReminderSpec[] = [
    { offsetMinutes: 0 },
    { offsetMinutes: 10 },
    { offsetMinutes: 1440 },
    { daysBefore: 3, atTime: "09:00" },
    { daysBefore: 0, atTime: "09:00" },
    { daysBefore: 1, atTime: "18:00" },
  ];
  for (const due of [at(2026, 10, 14, 23, 59), at(2026, 3, 8, 9, 0), at(2026, 11, 1, 1, 30), at(2026, 11, 2, 8, 0)]) {
    for (const spec of specs) {
      it(`${due.toISOString()} ${JSON.stringify(spec)}`, async () => {
        await addItem({ due, reminders: [spec] });
        const fire = fireTime(spec, due, NY);
        expect((await tick(new Date(fire.getTime() - 1500))).push.calls).toHaveLength(0);
        expect((await tick(new Date(fire.getTime() + 1500))).push.calls).toHaveLength(1);
      });
    }
  }
});

describe("quiet hours", () => {
  beforeEach(async () => {
    await db.query("update public.profiles set quiet_start = '22:00', quiet_end = '07:00' where user_id = $1", [user]);
  });

  it("a reminder that is not urgent waits until quiet hours end", async () => {
    // Due 9 AM, reminder 10 hours before = 11 PM, which is quiet time and 10 hours ahead.
    await addItem({ due: at(2026, 10, 15, 9, 0), reminders: [{ offsetMinutes: 600 }] });
    expect((await tick(at(2026, 10, 14, 23, 0, 10))).push.calls).toHaveLength(0);
    expect((await tick(at(2026, 10, 15, 3, 0))).push.calls).toHaveLength(0);
    expect((await tick(at(2026, 10, 15, 6, 59))).push.calls).toHaveLength(0);
    const morning = await tick(at(2026, 10, 15, 7, 0, 5));
    expect(morning.push.calls).toHaveLength(1);
    expect((await tick(at(2026, 10, 15, 7, 1, 5))).push.calls).toHaveLength(0);
  });

  it("urgent items (due within an hour) break through", async () => {
    await addItem({ due: at(2026, 10, 14, 23, 30), reminders: [{ offsetMinutes: 30 }] });
    const t = await tick(at(2026, 10, 14, 23, 0, 10));
    expect(t.push.calls).toHaveLength(1);
  });

  it("with the override off, even urgent items wait", async () => {
    await db.query("update public.profiles set urgent_override = false where user_id = $1", [user]);
    await addItem({ due: at(2026, 10, 14, 23, 30), reminders: [{ offsetMinutes: 30 }] });
    expect((await tick(at(2026, 10, 14, 23, 0, 10))).push.calls).toHaveLength(0);
    expect((await tick(at(2026, 10, 15, 7, 0, 5))).push.calls).toHaveLength(1);
  });

  it("quiet hours that do not cross midnight work too (1 PM to 3 PM)", async () => {
    await db.query("update public.profiles set quiet_start = '13:00', quiet_end = '15:00', urgent_override = false where user_id = $1", [user]);
    await addItem({ due: at(2026, 10, 14, 17, 0), reminders: [{ offsetMinutes: 180 }] }); // fires 2 PM
    expect((await tick(at(2026, 10, 14, 14, 0, 10))).push.calls).toHaveLength(0);
    expect((await tick(at(2026, 10, 14, 15, 0, 5))).push.calls).toHaveLength(1);
  });

  it("a held reminder is dropped if it was finished overnight", async () => {
    const { occId } = await addItem({ due: at(2026, 10, 15, 9, 0), reminders: [{ offsetMinutes: 600 }] });
    await tick(at(2026, 10, 14, 23, 0, 10)); // held
    await db.query("update public.occurrences set status = 'done' where id = $1", [occId]);
    expect((await tick(at(2026, 10, 15, 7, 0, 5))).push.calls).toHaveLength(0);
  });
});

describe("snooze", () => {
  it("fires again when the snooze ends, once", async () => {
    const { occId } = await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await tick(at(2026, 10, 14, 9, 0, 5)); // original
    await db.query("update public.occurrences set snoozed_until = $2, snooze_count = 1 where id = $1", [occId, at(2026, 10, 14, 10, 0).toISOString()]);
    expect((await tick(at(2026, 10, 14, 9, 30))).push.calls).toHaveLength(0);
    const back = await tick(at(2026, 10, 14, 10, 0, 5));
    expect(back.push.calls).toHaveLength(1);
    expect((await tick(at(2026, 10, 14, 10, 1, 5))).push.calls).toHaveLength(0);
  });

  it("snoozing before the reminder holds the original back", async () => {
    const { occId } = await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query("update public.occurrences set snoozed_until = $2 where id = $1", [occId, at(2026, 10, 14, 11, 0).toISOString()]);
    expect((await tick(at(2026, 10, 14, 9, 0, 5))).push.calls).toHaveLength(0);
    expect((await tick(at(2026, 10, 14, 11, 0, 5))).push.calls).toHaveLength(1);
  });
});

describe("missed while offline", () => {
  it("the daily catch-up sends what the minute clock missed, labelled, once", async () => {
    await addItem({ title: "Pay rent", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    // The clock was down all morning; nothing ran at 9:00.
    const noon = at(2026, 10, 14, 12, 0);
    const normal = await tick(noon);
    expect(normal.push.calls).toHaveLength(0);
    const catchUp = await tick(noon, { windowMinutes: 36 * 60, minAgeMinutes: 5, label: "missed", withSummaries: false });
    expect(catchUp.push.calls).toHaveLength(1);
    expect(catchUp.push.calls[0].payload.title).toMatch(/Missed while you were away/);
    const again = await tick(at(2026, 10, 14, 12, 1), { windowMinutes: 36 * 60, minAgeMinutes: 5, label: "missed", withSummaries: false });
    expect(again.push.calls).toHaveLength(0);
  });

  it("the catch-up never repeats something the clock already sent", async () => {
    await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    expect((await tick(at(2026, 10, 14, 9, 0, 10))).push.calls).toHaveLength(1);
    const catchUp = await tick(at(2026, 10, 14, 20, 0), { windowMinutes: 36 * 60, minAgeMinutes: 5, label: "missed", withSummaries: false });
    expect(catchUp.push.calls).toHaveLength(0);
  });

  it("the catch-up leaves the last few minutes to the minute clock", async () => {
    await addItem({ due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const early = await tick(at(2026, 10, 14, 9, 1), { windowMinutes: 36 * 60, minAgeMinutes: 5, label: "missed", withSummaries: false });
    expect(early.push.calls).toHaveLength(0);
  });
});

describe("morning summary", () => {
  beforeEach(async () => {
    await db.query("update public.profiles set morning_enabled = true where user_id = $1", [user]);
  });

  it("is sent once per day at the chosen time", async () => {
    await addItem({ due: at(2026, 10, 14, 17, 0), reminders: [{ offsetMinutes: 0 }] });
    expect((await tick(at(2026, 10, 14, 7, 59))).push.calls).toHaveLength(0);
    const eight = await tick(at(2026, 10, 14, 8, 0, 10));
    expect(eight.push.calls).toHaveLength(1);
    expect(eight.push.calls[0].payload.body).toMatch(/Today: 1 thing/);
    expect((await tick(at(2026, 10, 14, 8, 1, 10))).push.calls).toHaveLength(0);
    // The next morning the unfinished item shows up as late.
    const next = await tick(at(2026, 10, 15, 8, 0, 10));
    expect(next.push.calls).toHaveLength(1);
    expect(next.push.calls[0].payload.body).toMatch(/1 late/);
  });

  it("stays quiet when there is nothing to say", async () => {
    expect((await tick(at(2026, 10, 14, 8, 0, 10))).push.calls).toHaveLength(0);
  });

  it("mentions late items and payments coming up", async () => {
    await addItem({ title: "Old", due: at(2026, 10, 13, 17, 0), reminders: [] });
    await addItem({ title: "Phone", type: "payment", due: at(2026, 10, 16, 9, 0), reminders: [] });
    await db.query("update public.items set amount_cents = 4500 where title = 'Phone'");
    const { push } = await tick(at(2026, 10, 14, 8, 0, 10));
    expect(push.calls[0].payload.body).toMatch(/1 late/);
    expect(push.calls[0].payload.body).toMatch(/\$45\.00/);
  });

  it("can be turned off", async () => {
    await addItem({ due: at(2026, 10, 14, 17, 0), reminders: [] });
    await db.query("update public.profiles set morning_enabled = false where user_id = $1", [user]);
    expect((await tick(at(2026, 10, 14, 8, 0, 10))).push.calls).toHaveLength(0);
  });
});

describe("repeating items", () => {
  it("the clock keeps 30 days of occurrences ready and never duplicates them", async () => {
    const start = at(2026, 10, 14, 9);
    const dues = expandRule({ rule: "FREQ=DAILY", start, tz: NY, to: new Date(start.getTime() + 2 * 86400000) });
    const { itemId } = await addItem({ due: start, rrule: "FREQ=DAILY", reminders: [{ offsetMinutes: 0 }] });
    expect(dues.length).toBeGreaterThan(1);
    const first = await tick(at(2026, 10, 14, 6, 0), { withSummaries: false });
    expect(first.result.topped).toBeGreaterThan(25);
    const second = await tick(at(2026, 10, 14, 6, 1), { withSummaries: false });
    expect(second.result.topped).toBe(0);
    const n = await db.query("select count(*)::int as n from public.occurrences where item_id = $1", [itemId]);
    expect((n.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(30);
  });

  it("done on one day leaves the rest of the series alone", async () => {
    const start = at(2026, 10, 14, 9);
    const { itemId, occId } = await addItem({ due: start, rrule: "FREQ=DAILY", reminders: [{ offsetMinutes: 0 }] });
    await tick(at(2026, 10, 14, 6, 0), { withSummaries: false });
    await db.query("update public.occurrences set status = 'done' where id = $1", [occId]);
    expect((await tick(new Date(start.getTime() + 5000))).push.calls).toHaveLength(0);
    const tomorrow = at(2026, 10, 15, 9, 0, 5);
    expect((await tick(tomorrow)).push.calls).toHaveLength(1);
    const item = await db.query<{ status: string }>("select status from public.items where id = $1", [itemId]);
    expect(item.rows[0].status).toBe("open");
  });
});

describe("the log", () => {
  it("every run is written down", async () => {
    await tick(at(2026, 10, 14, 9, 0));
    await tick(at(2026, 10, 14, 9, 1));
    const n = await db.query("select count(*)::int as n from public.dispatch_log");
    expect((n.rows[0] as { n: number }).n).toBe(2);
  });
});

describe("autopay payments", () => {
  it("get a heads-up, never a 'pay now' wording", async () => {
    const { itemId } = await addItem({ type: "payment", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    await db.query("update public.items set autopay = true where id = $1", [itemId]);
    const { push } = await tick(at(2026, 10, 14, 9, 0, 5));
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.body).toMatch(/Heads up: autopay is on/);
    expect(push.calls[0].payload.body).not.toMatch(/Due now|Due in/);
  });

  it("normal payments keep the normal wording", async () => {
    await addItem({ type: "payment", due: at(2026, 10, 14, 9, 0), reminders: [{ offsetMinutes: 0 }] });
    const { push } = await tick(at(2026, 10, 14, 9, 0, 5));
    expect(push.calls[0].payload.body).toMatch(/Due now/);
  });
});
