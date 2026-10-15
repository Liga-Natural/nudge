import type { Rpc } from "./dispatch";
import { apiError, describeLookup, hashToken, readBearer, tooManyRequests, type ApiError } from "./inbox-auth";
import { parseInboxText } from "./inbox-schema";
import { runImport } from "./import-run";

// The /api/inbox address, written so it can be tested without a web server.
// GET  = "is my token good?" (what the Test token button uses)
// POST = bring in classes, assignments and grades (add ?dry_run=1 to only preview)

export const MAX_BODY_BYTES = 1_000_000;

export type InboxDeps = {
  rpc: Rpc;
  /** The person's time zone (so a date with no time lands at the end of THEIR day). */
  timezone: (userId: string) => Promise<string | null>;
  clientIp: string;
};

type Json = Record<string, unknown>;

const json = (body: Json, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const fail = (e: ApiError | (ApiError & { retryAfter: number }), extra: Json = {}) =>
  json({ ok: false, code: e.code, error: e.error, ...extra }, e.status, "retryAfter" in e ? { "Retry-After": String(e.retryAfter) } : {});

async function hit(rpc: Rpc, key: string, limit: number): Promise<ReturnType<typeof tooManyRequests> | null> {
  const res = await rpc("api_rate_hit", { p_key: key, p_limit: limit, p_window_seconds: 60 });
  if (res.error) return null; // never lock a person out because the limiter had a hiccup
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { allowed?: boolean; retry_after?: number } | null;
  return row && row.allowed === false ? tooManyRequests(row.retry_after ?? 60) : null;
}

type Who = { ok: true; userId: string; tokenId: string; name: string; lastUsedAt: string | null } | { ok: false; response: Response };

async function authenticate(request: Request, deps: InboxDeps): Promise<Who> {
  // Slow down guessing before looking at anything else.
  const ipLimited = await hit(deps.rpc, `inbox:ip:${deps.clientIp}`, 120);
  if (ipLimited) return { ok: false, response: fail(ipLimited) };

  const bearer = readBearer(request.headers);
  if (!bearer.ok) return { ok: false, response: fail(bearer) };

  const res = await deps.rpc("api_token_lookup", { p_hash: hashToken(bearer.token) });
  if (res.error) {
    return { ok: false, response: fail(apiError(503, "server_error", "Nudge could not check the token right now (the database did not answer). Try again in a minute.")) };
  }
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { token_id: string | null; user_id: string | null; name: string | null; outcome: string; last_used_at: string | null } | null;
  const problem = describeLookup(row?.outcome ?? "unknown");
  if (problem || !row?.user_id || !row.token_id) return { ok: false, response: fail(problem ?? apiError(401, "unknown_token", "This token is not recognised.")) };

  const tokenLimited = await hit(deps.rpc, `inbox:token:${row.token_id}`, 30);
  if (tokenLimited) return { ok: false, response: fail(tokenLimited) };
  return { ok: true, userId: row.user_id, tokenId: row.token_id, name: row.name ?? "", lastUsedAt: row.last_used_at };
}

export async function handleInbox(request: Request, deps: InboxDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return fail(apiError(405, "method_not_allowed", "Use POST to send data, or GET to test your token."));
  }
  const who = await authenticate(request, deps);
  if (!who.ok) return who.response;

  if (request.method === "GET") {
    return json({ ok: true, message: "Token is good.", token_name: who.name, last_used_at: who.lastUsedAt });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return fail(apiError(413, "too_big", `That is too much data at once (limit ${MAX_BODY_BYTES / 1000} KB). Send it in smaller batches.`));
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return fail(apiError(413, "too_big", `That is too much data at once (limit ${MAX_BODY_BYTES / 1000} KB). Send it in smaller batches.`));
  }
  const parsed = parseInboxText(text);
  if (!parsed.ok) {
    return json({ ok: false, code: "invalid_payload", error: "The data was not in the expected format.", problems: parsed.problems }, 400);
  }

  const tz = (await deps.timezone(who.userId)) ?? "America/New_York";
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const out = await runImport(deps.rpc, who.userId, parsed.payload, tz, !dryRun);
  if (!out.ok) return json({ ok: false, code: "import_failed", error: out.problems[0], problems: out.problems }, out.status);
  return json({ ok: true, dry_run: dryRun, ...out.report });
}
