import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { generateToken } from "@/lib/inbox-auth";
import { handleInbox } from "@/lib/inbox-handler";
import { addUser, readyDb, serverLikeSupabase } from "./harness";
import { pgRpc } from "./pg-rpc";

let db: PGlite;
let user: string;
let good: string;

const BODY = {
  source: "classroom",
  classes: [{ external_id: "c1", name: "Math 101" }],
  assignments: [{ external_id: "a1", class: "c1", title: "Chapter 3", due: "2026-10-20", notes: "odd numbers" }],
  grades: [{ external_id: "g1", class: "c1", assignment: "a1", title: "Quiz 2", score: 18, out_of: 20, posted: new Date().toISOString() }],
};

beforeEach(async () => {
  db = await readyDb();
  await serverLikeSupabase(db);
  user = await addUser(db);
  await db.query("insert into public.profiles (user_id, onboarded) values ($1, true)", [user]);
  const t = generateToken();
  good = t.token;
  await db.query("insert into public.api_tokens (user_id, name, token_hash, token_prefix) values ($1, 'My agent', $2, $3)", [user, t.hash, t.prefix]);
});

afterEach(async () => {
  await db.close();
});

type Reply = { status: number; body: Record<string, unknown>; headers: Headers };

async function call(method: "GET" | "POST", opts: { auth?: string | null; body?: unknown; raw?: string; query?: string; ip?: string; contentLength?: number } = {}): Promise<Reply> {
  const headers = new Headers();
  if (opts.auth !== null) headers.set("authorization", opts.auth ?? `Bearer ${good}`);
  if (opts.contentLength) headers.set("content-length", String(opts.contentLength));
  const req = new Request(`http://localhost/api/inbox${opts.query ?? ""}`, {
    method,
    headers,
    body: method === "POST" ? (opts.raw ?? JSON.stringify(opts.body ?? BODY)) : undefined,
  });
  const res = await handleInbox(req, {
    rpc: pgRpc(db),
    clientIp: opts.ip ?? "203.0.113.5",
    timezone: async () => "America/New_York",
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

describe("token errors say exactly what is wrong", () => {
  it("no header", async () => {
    const r = await call("GET", { auth: null });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("no_token");
    expect(String(r.body.error)).toMatch(/Authorization: Bearer/);
  });
  it("header without Bearer", async () => {
    const r = await call("GET", { auth: good });
    expect(r.body.code).toBe("bad_header");
    expect(String(r.body.error)).toMatch(/start with "Bearer "/);
  });
  it("Bearer with nothing after it", async () => {
    expect((await call("GET", { auth: "Bearer " })).body.code).toBe("empty_token");
  });
  it("something that is not a Nudge token", async () => {
    const r = await call("GET", { auth: "Bearer sk_live_" + "x".repeat(40) });
    expect(r.body.code).toBe("wrong_token_type");
  });
  it("a Nudge-shaped token that was never made", async () => {
    const r = await call("GET", { auth: `Bearer ${generateToken().token}` });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("unknown_token");
  });
  it("a revoked token", async () => {
    await db.query("update public.api_tokens set revoked_at = now()");
    expect((await call("GET")).body.code).toBe("revoked");
  });
  it("an expired token", async () => {
    await db.query("update public.api_tokens set expires_at = now() - interval '1 hour'");
    expect((await call("GET")).body.code).toBe("expired");
  });
});

describe("the Test token check", () => {
  it("answers ok with the token's name, and notes it was used", async () => {
    const r = await call("GET");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, token_name: "My agent" });
    const used = await db.query<{ last_used_at: Date | null }>("select last_used_at from public.api_tokens");
    expect(used.rows[0].last_used_at).not.toBeNull();
  });
});

describe("sending data", () => {
  it("imports, and sending the same data again duplicates nothing", async () => {
    const first = await call("POST");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, committed: true });
    expect((first.body.counts as Record<string, Record<string, number>>).assignments.new).toBe(1);
    const second = await call("POST");
    expect((second.body.counts as Record<string, Record<string, number>>).assignments).toEqual({ new: 0, updated: 0, unchanged: 1 });
    const n = await db.query<{ items: string; grades: string }>("select (select count(*) from public.items)::text as items, (select count(*) from public.grades)::text as grades");
    expect(n.rows[0]).toEqual({ items: "1", grades: "1" });
  });

  it("a bare due date means the end of that day in the person's own time zone", async () => {
    await call("POST");
    const r = await db.query<{ due_at: Date }>("select due_at from public.items");
    expect(new Date(r.rows[0].due_at).toISOString()).toBe("2026-10-21T03:59:00.000Z"); // 11:59 PM EDT
  });

  it("?dry_run=1 only previews", async () => {
    const r = await call("POST", { query: "?dry_run=1" });
    expect(r.body).toMatchObject({ ok: true, dry_run: true, committed: false });
    expect((await db.query("select * from public.items")).rows).toHaveLength(0);
  });

  it("broken JSON, wrong shapes and impossible numbers are explained", async () => {
    const broken = await call("POST", { raw: "{not json" });
    expect(broken.status).toBe(400);
    expect(String((broken.body.problems as string[])[0])).toMatch(/not valid JSON/);

    const bad = await call("POST", { body: { source: "canvas", grades: [{ external_id: "g", class: "c", title: "T", score: -1, out_of: 0 }] } });
    expect(bad.status).toBe(400);
    const problems = (bad.body.problems as string[]).join("\n");
    expect(problems).toMatch(/source: must be "classroom", "colegia" or "manual"/);
    expect(problems).toMatch(/grades\[1\]\.score: cannot be negative/);
    expect(problems).toMatch(/grades\[1\]\.out_of: must be more than 0/);

    const empty = await call("POST", { body: { source: "manual" } });
    expect((empty.body.problems as string[])[0]).toMatch(/nothing to import/);

    const dup = await call("POST", { body: { source: "manual", classes: [{ external_id: "x", name: "A" }, { external_id: "x", name: "B" }] } });
    expect((dup.body.problems as string[])[0]).toMatch(/appears twice/);
  });

  it("too much data is refused before it is read", async () => {
    const r = await call("POST", { contentLength: 5_000_000 });
    expect(r.status).toBe(413);
    expect(r.body.code).toBe("too_big");
  });

  it("an account that never opened Nudge gets a clear message", async () => {
    await db.query("delete from public.profiles");
    const r = await call("POST");
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/Open Nudge once/);
  });
});

describe("rate limit", () => {
  it("allows 30 requests a minute per token, then says how long to wait", async () => {
    for (let i = 0; i < 30; i++) expect((await call("GET")).status).toBe(200);
    const blocked = await call("GET");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 30_000);

  it("a flood from one address is stopped even with bad tokens", async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await call("GET", { auth: null, ip: "198.51.100.9" })).status;
    expect(last).toBe(429);
  }, 40_000);
});
