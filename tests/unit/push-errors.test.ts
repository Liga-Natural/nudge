import { describe, expect, it } from "vitest";
import { checkVapidSetup, describePushFailure } from "@/lib/push-errors";

describe("push failures in plain words", () => {
  it("expired subscriptions say what to do", () => {
    expect(describePushFailure({ status: 410 })).toMatch(/Turn on notifications/);
    expect(describePushFailure({ status: 404 })).toMatch(/expired/);
  });
  it("a refused key mentions VAPID and the status", () => {
    const msg = describePushFailure({ status: 403, body: '{"reason":"BadJwtToken"}' });
    expect(msg).toMatch(/403/);
    expect(msg).toMatch(/VAPID/);
  });
  it("server trouble and timeouts say Nudge will retry", () => {
    expect(describePushFailure({ status: 503 })).toMatch(/retries/);
    expect(describePushFailure({ message: "Request timed out" })).toMatch(/in time/);
  });
  it("never returns an empty message", () => {
    expect(describePushFailure({}).length).toBeGreaterThan(10);
  });
});

describe("VAPID setup check", () => {
  it("accepts mailto: and https subjects", () => {
    expect(checkVapidSetup({ publicKey: "a", privateKey: "b", subject: "mailto:me@example.com" })).toBeNull();
    expect(checkVapidSetup({ publicKey: "a", privateKey: "b", subject: "https://nudge.example" })).toBeNull();
  });
  it("catches the subject mistake Apple rejects", () => {
    expect(checkVapidSetup({ publicKey: "a", privateKey: "b", subject: "me@example.com" })).toMatch(/VAPID_SUBJECT/);
  });
  it("catches missing keys", () => {
    expect(checkVapidSetup({ publicKey: "a" })).toMatch(/not fully set up/);
  });
});
