import { createHash, randomBytes } from "node:crypto";
import type { Rpc } from "./dispatch";
import { apiError, hashToken, tooManyRequests, type ApiError } from "./inbox-auth";
import type { WidgetPayload } from "./widget-data";

// The /api/widget address, written so it can be tested without a web server. It answers one read-only
// summary for the Scriptable Home Screen widgets. A widget token (ndw_...) can do nothing else: the
// import address only accepts ndg_ tokens, and this one only accepts ndw_ tokens.

export const WIDGET_PREFIX = "ndw_";
export const WIDGET_TOKEN_NAME = "Home Screen widgets";
/** How long an answer is reused (per person). Widgets refresh every few minutes, so this keeps the database calm. */
export const CACHE_SECONDS = 30;

export function generateWidgetToken(): { token: string; prefix: string; hash: string } {
  const token = WIDGET_PREFIX + randomBytes(32).toString("base64url");
  return { token, prefix: token.slice(0, 8), hash: createHash("sha256").update(token, "utf8").digest("hex") };
}

export type WidgetDeps = {
  rpc: Rpc;
  clientIp: string;
  /** Builds the answer for one person (the database part). */
  load: (userId: string, now: Date) => Promise<WidgetPayload>;
  now?: () => Date;
};

type Cached = { at: number; body: string };
const cache = new Map<string, Cached>();
export const clearWidgetCache = () => cache.clear();

const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } });

const fail = (e: ApiError | (ApiError & { retryAfter: number })) =>
  json(JSON.stringify({ ok: false, code: e.code, error: e.error }), e.status, { "Cache-Control": "no-store", ...("retryAfter" in e ? { "Retry-After": String(e.retryAfter) } : {}) });

async function hit(rpc: Rpc, key: string, limit: number) {
  const res = await rpc("api_rate_hit", { p_key: key, p_limit: limit, p_window_seconds: 60 });
  if (res.error) return null; // never lock a person out because the limiter had a hiccup
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { allowed?: boolean; retry_after?: number } | null;
  return row && row.allowed === false ? tooManyRequests(row.retry_after ?? 60) : null;
}

function readWidgetBearer(headers: Headers): { ok: true; token: string } | ApiError {
  const raw = headers.get("authorization");
  if (raw === null) return apiError(401, "no_token", "No token was sent. Paste your widget token into the script (Settings → Home Screen widgets).");
  if (!/^Bearer(\s|$)/i.test(raw)) return apiError(401, "bad_header", 'The Authorization header must be "Bearer " followed by your widget token.');
  const token = raw.replace(/^Bearer\s*/i, "").trim();
  if (!token.startsWith(WIDGET_PREFIX) || token.length < 30 || token.length > 100 || /\s/.test(token)) {
    return apiError(401, "wrong_token_type", `That is not a widget token (they start with ${WIDGET_PREFIX}). Make one under Settings → Home Screen widgets.`);
  }
  return { ok: true, token };
}

export async function handleWidget(request: Request, deps: WidgetDeps): Promise<Response> {
  if (request.method !== "GET") return fail(apiError(405, "method_not_allowed", "Widgets only read: use GET."));
  const started = Date.now();
  const now = (deps.now ?? (() => new Date()))();

  const ipLimited = await hit(deps.rpc, `widget:ip:${deps.clientIp}`, 120);
  if (ipLimited) return fail(ipLimited);
  const bearer = readWidgetBearer(request.headers);
  if (!bearer.ok) return fail(bearer);

  const res = await deps.rpc("api_token_lookup", { p_hash: hashToken(bearer.token) });
  if (res.error) return fail(apiError(503, "server_error", "Nudge could not check the token right now. Try again in a minute."));
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { token_id: string | null; user_id: string | null; outcome: string } | null;
  if (!row || row.outcome !== "ok" || !row.user_id || !row.token_id) {
    const why = row?.outcome;
    return fail(
      why === "revoked"
        ? apiError(401, "revoked", "This widget token was revoked. Make a new one under Settings → Home Screen widgets.")
        : why === "expired"
          ? apiError(401, "expired", "This widget token has expired. Make a new one under Settings → Home Screen widgets.")
          : apiError(401, "unknown_token", "This widget token is not recognised. Make a new one under Settings → Home Screen widgets."),
    );
  }
  const tokenLimited = await hit(deps.rpc, `widget:token:${row.token_id}`, 60);
  if (tokenLimited) return fail(tokenLimited);

  const hitCache = cache.get(row.user_id);
  if (hitCache && now.getTime() - hitCache.at < CACHE_SECONDS * 1000) {
    return json(hitCache.body, 200, { "Cache-Control": `private, max-age=${CACHE_SECONDS}`, "X-Widget-Cache": "hit", "X-Widget-Ms": String(Date.now() - started) });
  }
  try {
    const payload = await deps.load(row.user_id, now);
    const body = JSON.stringify(payload);
    cache.set(row.user_id, { at: now.getTime(), body });
    if (cache.size > 200) for (const [k, v] of cache) if (now.getTime() - v.at > CACHE_SECONDS * 1000) cache.delete(k);
    return json(body, 200, { "Cache-Control": `private, max-age=${CACHE_SECONDS}`, "X-Widget-Cache": "miss", "X-Widget-Ms": String(Date.now() - started) });
  } catch (e) {
    console.error("widget failed:", e instanceof Error ? e.message : e);
    return fail(apiError(500, "server_error", "Nudge could not build your summary. Try again in a minute."));
  }
}
