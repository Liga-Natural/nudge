// A simple "slow down" guard. It counts per server instance, which is plenty to stop
// accidental floods on a one-person app; it is not a defence against a determined attacker.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count++;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

export function tooMany(retryAfterSeconds: number) {
  return Response.json(
    { error: "Too many tries. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
