import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type Db = ReturnType<typeof createServerClient>;

export async function createClient(): Promise<Db> {
  // The literal comparison below is replaced at build time, so a normal build drops this branch
  // (and the fake code with it); scripts/check-secrets.mjs proves it.
  if (process.env.NUDGE_E2E === "1") {
    // Only in builds made with NUDGE_E2E=1: pretend data for automated browser tests.
    const { createFakeClient } = await import("./fake");
    return (await createFakeClient()) as unknown as Db;
  }
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; the proxy refreshes the session.
          }
        },
      },
    },
  );
}
