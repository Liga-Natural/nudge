import { createClient } from "@supabase/supabase-js";

// Server-only. Uses the secret key, which bypasses row level security, so it is only
// ever used by the reminder clock routes and never imported by pages or the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("The server key for the reminder clock is not set (SUPABASE_SECRET_KEY).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
