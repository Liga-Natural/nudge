import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { generateToken } from "@/lib/inbox-auth";
import { handleInbox } from "@/lib/inbox-handler";
import { buildWidgetPayload, type WidgetRaw } from "@/lib/widget-data";
import { clearWidgetCache, generateWidgetToken, handleWidget } from "@/lib/widget-handler";
import { addUser, readyDb, serverLikeSupabase } from "./harness";
import { pgRpc } from "./pg-rpc";

let db: PGlite;
let user: string;
let good: string;
let loads: number;

const NOW = new Date("2026-10-24T19:00:00Z"); // Saturday 3 PM in New York
const raw = (): WidgetRaw => ({
  tz: "America/New_York",
  features: { school: true, grades: true, habits: true },
  prefs: {},
  occs: [],
  items: [],
  doneToday: [],
  courses: [],
  grades: [],
  habitItems: [],
  habitOccs: [],
});

beforeEach(async () => {
  clearWidgetCache();
  loads = 0;
  db = await readyDb();
  await serverLikeSupabase(db);
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded) values ($1, true)", [user]);
  const t = generateWidgetToken();
  good = t.token;
  await db.query("insert into public.api_tokens (user_id, name, token_hash, token_prefix) values ($1, 'Home Screen widgets', $2, $3)", [user, t.hash, t.prefix]);
});

afterEach(async () => {
  await db.close();
});

type Reply = { status: number; body: Record<string, unknown>; headers: Headers };

async function call(opts: { auth?: string | null; method?: string; ip?: string } = {}): Promise<Reply> {
  const headers = new Headers();
  if (opts.auth !== null) headers.set("authorization", opts.auth ?? `Bearer ${good}`);
  const res = await handleWidget(new Request("http://localhost/api/widget", { method: opts.method ?? "GET", headers }), {
    rpc: pgRpc(db),
    clientIp: opts.ip ?? "203.0.113.9",
    now: () => NOW,
    load: async (_id, now) => {
      loads++;
      return buildWidgetPayload(raw(), now);
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

describe("the widget address", () => {
  it("answers one summary for a good widget token, and notes the token was used", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ v: 1, tz: "America/New_York", next: null });
    expect((r.body.week as unknown[]).length).toBe(7);
    const used = await db.query<{ last_used_at: Date | null }>("select last_used_at from public.api_tokens");
    expect(used.rows[0].last_used_at).not.toBeNull();
  });

  it("is fast and briefly cached: the second call does not touch the database again", async () => {
    const t0 = Date.now();
    const first = await call();
    expect(Date.now() - t0).toBeLessThan(300);
    expect(first.headers.get("x-widget-cache")).toBe("miss");
    expect(first.headers.get("cache-control")).toMatch(/private, max-age=30/);
    const second = await call();
    expect(second.headers.get("x-widget-cache")).toBe("hit");
    expect(loads).toBe(1);
  });

  it("is read-only: only GET", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const r = await call({ method });
      expect(r.status).toBe(405);
      expect(r.body.code).toBe("method_not_allowed");
    }
  });

  it("token errors say exactly what is wrong", async () => {
    expect((await call({ auth: null })).body.code).toBe("no_token");
    expect((await call({ auth: good })).body.code).toBe("bad_header");
    expect((await call({ auth: "Bearer sk_live_" + "x".repeat(40) })).body.code).toBe("wrong_token_type");
    expect((await call({ auth: `Bearer ${generateWidgetToken().token}` })).body.code).toBe("unknown_token");
    await db.query("update public.api_tokens set revoked_at = now()");
    const revoked = await call();
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("revoked");
  });

  it("an expired token is turned away", async () => {
    await db.query("update public.api_tokens set expires_at = now() - interval '1 hour'");
    expect((await call()).body.code).toBe("expired");
  });

  it("an import token (ndg_) cannot read widgets, and a widget token (ndw_) cannot import", async () => {
    const imp = generateToken();
    await db.query("insert into public.api_tokens (user_id, name, token_hash, token_prefix) values ($1, 'agent', $2, $3)", [user, imp.hash, imp.prefix]);
    const asWidget = await call({ auth: `Bearer ${imp.token}` });
    expect(asWidget.status).toBe(401);
    expect(asWidget.body.code).toBe("wrong_token_type");

    const res = await handleInbox(new Request("http://localhost/api/inbox", { method: "GET", headers: { authorization: `Bearer ${good}` } }), {
      rpc: pgRpc(db),
      clientIp: "203.0.113.10",
      timezone: async () => "America/New_York",
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("wrong_token_type");
  });

  it("slows down a flood: 60 a minute per token, 120 per address", async () => {
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await call({ ip: `198.51.100.${i % 200}` })).status;
    expect(last).toBe(429);
    const flood = await call({ auth: `Bearer ${generateWidgetToken().token}`, ip: "192.0.2.1" });
    expect(flood.status).toBe(401);
    let status = 200;
    for (let i = 0; i < 125; i++) status = (await call({ auth: `Bearer ${generateWidgetToken().token}`, ip: "192.0.2.77" })).status;
    expect(status).toBe(429);
  });
});

describe("what the summary holds", () => {
  const entry = (id: string, type: string, title: string, due: string, extra: Record<string, unknown> = {}) => ({
    item: { id, space_id: null, type, title, notes: null, due_at: due, all_day: false, timezone: "America/New_York", status: "open", priority: 0, amount_cents: null, currency: "USD", rrule: null, autopay: false, course_id: null, ...extra },
    occ: { id: `o-${id}`, item_id: id, due_at: due, status: "open" as const, snoozed_until: null, snooze_count: 0, done_at: null },
  });

  it("next up, today's marks, school with Missing, grades, the week and habits", () => {
    const math = "00000000-0000-4000-8000-0000000000a1";
    const rows = [
      entry("late", "homework", "Old worksheet", "2026-10-22T12:00:00Z", { course_id: math }),
      entry("soon", "homework", "Algebra HW", "2026-10-25T00:00:00Z", { course_id: math, link: "https://x.test" }),
      entry("pay", "payment", "Phone bill", "2026-10-24T22:00:00Z", { amount_cents: 4500 }),
      entry("fri", "event", "Dentist", "2026-10-30T14:00:00Z"),
    ];
    const done = entry("did", "task", "Took out trash", "2026-10-24T13:00:00Z");
    const p = buildWidgetPayload(
      {
        ...raw(),
        occs: rows.map((r) => r.occ),
        items: rows.map((r) => r.item) as never,
        doneToday: [{ occ: done.occ, item: done.item as never }],
        courses: [{ id: math, name: "p03 Algebra", color: "#e4edff", school_year: "2026-2027" }],
        grades: [{ id: "g1", course_id: math, title: "Quiz", score: 18, out_of: 20, percent: 90, posted_at: "2026-10-10T12:00:00Z", source: "manual", comment: null, letter: null, points: null, term: "q1", school_year: null }],
        habitItems: [{ id: "h1", title: "🏃 Run" }],
        habitOccs: [{ id: "ho1", item_id: "h1", due_at: "2026-10-24T22:00:00Z", status: "open", snoozed_until: null, snooze_count: 0, done_at: null }],
      },
      NOW,
    );
    expect(p.next).toMatchObject({ title: "Phone bill", emoji: "💳", course: null });
    expect(p.today.late).toBe(1);
    expect(p.today.items.map((i) => [i.title, i.late, i.done])).toEqual([
      ["Old worksheet", true, false],
      ["Phone bill", false, false],
      ["Algebra HW", false, false],
      ["Took out trash", false, true],
    ]);
    expect(p.progress).toEqual({ done: 1, total: 3 });
    expect(p.school.missing).toBe(1);
    expect(p.school.items[0]).toMatchObject({ title: "Algebra HW", emoji: "➗", course: "p03 Algebra" });
    expect(p.grades).toEqual([{ name: "Algebra", emoji: "➗", color: "#e4edff", text: "90%" }]);
    expect(p.week.map((d) => d.count)).toEqual([3, 0, 0, 0, 0, 0, 1]);
    expect(p.habits).toEqual([{ title: "Run", emoji: "🏃", done: false, streak: 0 }]);
    expect(JSON.stringify(p).length).toBeLessThan(6000);
  });

  it("a past school year's homework never shows up", () => {
    const old = "00000000-0000-4000-8000-0000000000b1";
    const r = entry("hw", "homework", "Old year", "2026-10-25T00:00:00Z", { course_id: old });
    const p = buildWidgetPayload({ ...raw(), occs: [r.occ], items: [r.item as never], courses: [{ id: old, name: "Last year", color: "#e4edff", school_year: "2025-2026" }] }, NOW);
    expect(p.school.items).toEqual([]);
    expect(p.next).toBeNull();
  });
});
