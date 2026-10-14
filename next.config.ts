import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const e2e = process.env.NUDGE_E2E === "1";
if (e2e && process.env.VERCEL) {
  // The pretend-data test mode must never be deployed.
  throw new Error("NUDGE_E2E=1 is for local test builds only and cannot be built on Vercel.");
}

const nextConfig: NextConfig = {
  distDir: e2e ? ".next-e2e" : ".next",
  // Baked in at build time, so a normal build contains none of the test-mode code.
  env: { NUDGE_E2E: e2e ? "1" : "" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must never be cached for long.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
