import { createHash, randomBytes } from "node:crypto";

// Access tokens for /api/inbox. Only a SHA-256 fingerprint is stored; the token itself is shown
// once, when it is made. Every way a request can fail gets its own plain message.

export const TOKEN_PREFIX = "ndg_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): { token: string; prefix: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, prefix: token.slice(0, 8), hash: hashToken(token) };
}

export type ApiError = { ok: false; status: number; code: string; error: string };

export function apiError(status: number, code: string, error: string): ApiError {
  return { ok: false, status, code, error };
}

/** Reads `Authorization: Bearer <token>` and checks it has the right shape, before touching the database. */
export function readBearer(headers: Headers): { ok: true; token: string } | ApiError {
  const raw = headers.get("authorization");
  if (raw === null) {
    return apiError(401, "no_token", "No token was sent. Add the header Authorization: Bearer <your token>. Make a token in Nudge under Settings → Agent import.");
  }
  if (!/^Bearer(\s|$)/i.test(raw)) {
    return apiError(401, "bad_header", 'The Authorization header must start with "Bearer " followed by your token, for example: Authorization: Bearer ndg_abc...');
  }
  const token = raw.replace(/^Bearer\s*/i, "").trim();
  if (!token) return apiError(401, "empty_token", 'The Authorization header says "Bearer" but the token after it is empty.');
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 30 || token.length > 100 || /\s/.test(token)) {
    return apiError(401, "wrong_token_type", `That does not look like a Nudge token (they start with ${TOKEN_PREFIX}). Make one under Settings → Agent import.`);
  }
  return { ok: true, token };
}

export function describeLookup(outcome: string): ApiError | null {
  switch (outcome) {
    case "ok":
      return null;
    case "revoked":
      return apiError(401, "revoked", "This token was revoked. Make a new one under Settings → Agent import.");
    case "expired":
      return apiError(401, "expired", "This token has expired. Make a new one under Settings → Agent import.");
    default:
      return apiError(401, "unknown_token", "This token is not recognised. It may be copied wrongly or deleted. Make a new one under Settings → Agent import.");
  }
}

export function tooManyRequests(retryAfter: number): ApiError & { retryAfter: number } {
  return { ...apiError(429, "rate_limited", `Too many requests. Wait ${retryAfter} second${retryAfter === 1 ? "" : "s"} and try again.`), retryAfter };
}
