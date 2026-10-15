import { defineConfig } from "@playwright/test";

// Browser tests run against a PRODUCTION build made in test mode (npm run build:e2e), with a
// pretend database. One worker, one test at a time: never two browser runs at once.
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", reducedMotion: "reduce" },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NUDGE_E2E: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "placeholder",
      OWNER_EMAIL: "owner@example.test",
      ENCRYPTION_KEY: "a".repeat(64),
    },
  },
  projects: [
    { name: "phone", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
