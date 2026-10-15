import webpush from "web-push";
import type { Sender } from "./dispatch";
import { checkVapidSetup, describePushFailure } from "./push-errors";

export function createWebPushSender(): Sender {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const problem = checkVapidSetup({ publicKey, privateKey, subject });
  if (problem) throw new Error(problem);
  webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high", timeout: 8000 },
      );
      return { ok: true };
    } catch (e) {
      const err = e as { statusCode?: number; message?: string; body?: string };
      const status = err.statusCode;
      return {
        ok: false,
        gone: status === 404 || status === 410,
        status,
        error: describePushFailure({ status, message: err.message, body: err.body }),
      };
    }
  };
}
