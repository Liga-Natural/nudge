// The rules behind scripts/check-secrets.mjs, kept separate so they can be tested.

/** Decodes the middle part of a JWT (a Supabase key), or null when it is not one. */
export function jwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Why a value may NOT be used as the public Supabase key, or null when it is fine (publishable or anon only). */
export function publicKeyProblem(value) {
  if (!value) return null;
  if (/^sb_secret_/.test(value)) return "A secret key was put in the public Supabase key.";
  if (/^sb_publishable_/.test(value)) return null;
  const payload = jwtPayload(value);
  if (payload) {
    return payload.role === "anon" ? null : `The public Supabase key is a JWT with role "${payload.role}". Only the publishable key or the anon key may be public.`;
  }
  return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY does not look like a publishable or anon key.";
}

/** Finds Supabase keys with a powerful role inside a file's text. Returns the roles found. */
export function dangerousJwtRoles(text) {
  const found = new Set();
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = jwtPayload(m[0]);
    if (payload && payload.role && payload.role !== "anon") found.add(String(payload.role));
  }
  return [...found];
}
