// Test mode for automated browser tests: pretend data and a pretend login, no real Supabase.
// It only exists in builds made with NUDGE_E2E=1 (see next.config.ts). In a normal build the
// constant below is the literal `false`, and scripts/check-secrets.mjs fails the build if the
// fake code was bundled anyway.
export const isFakeMode = (): boolean => process.env.NUDGE_E2E === "1";
