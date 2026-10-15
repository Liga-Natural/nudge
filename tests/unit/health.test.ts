import { describe, expect, it } from "vitest";
import { judgeHealth } from "@/lib/health";

const now = new Date("2026-10-14T12:00:00Z");

describe("judgeHealth", () => {
  it("a healthy database and a recent clock mean no email", () => {
    expect(judgeHealth({ databaseError: null, lastClockRun: new Date(now.getTime() - 60_000), now }).ok).toBe(true);
  });

  it("a database that does not answer sends the 'paused' email", () => {
    const v = judgeHealth({ databaseError: "fetch failed", lastClockRun: null, now });
    expect(v.ok).toBe(false);
    expect(v.problems[0].text).toContain("Nudge's database is paused, restore it in the Supabase dashboard");
  });

  it("a clock silent for more than 15 minutes sends the 'clock stopped' email", () => {
    const v = judgeHealth({ databaseError: null, lastClockRun: new Date(now.getTime() - 20 * 60_000), now });
    expect(v.ok).toBe(false);
    expect(v.problems[0].subject).toMatch(/clock has stopped/);
  });

  it("a clock that never ran is not an alarm (the clock may not be switched on yet)", () => {
    expect(judgeHealth({ databaseError: null, lastClockRun: null, now }).ok).toBe(true);
  });
});
