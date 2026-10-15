import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("lets the first few through, then asks to slow down, then lets people back in", () => {
    const key = "test-" + Math.random();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000, t0 + i).ok).toBe(true);
    const blocked = rateLimit(key, 3, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit(key, 3, 60_000, t0 + 61_000).ok).toBe(true);
  });

  it("counts different people separately", () => {
    const t0 = 5_000_000;
    expect(rateLimit("a-" + t0, 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit("b-" + t0, 1, 60_000, t0).ok).toBe(true);
  });
});
