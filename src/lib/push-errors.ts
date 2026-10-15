// Turns what a push service (Apple, Google, Mozilla) answered into a sentence a person can act on.

export type PushFailure = { status?: number; message?: string; body?: string };

export function describePushFailure(f: PushFailure): string {
  const code = f.status;
  const body = (f.body ?? "").toLowerCase();
  if (code === 404 || code === 410) {
    return "This phone's notification permission expired, so it was removed. Open Settings and tap Turn on notifications again.";
  }
  if (code === 401 || code === 403) {
    if (body.includes("badjwttoken") || body.includes("vapid") || body.includes("jwt")) {
      return "The push service refused our notification key (HTTP " + code + "). The key on the server (VAPID) does not match the one this phone signed up with, or VAPID_SUBJECT is not a mailto: or https:// address. Turn notifications off and on again in Settings.";
    }
    return "The push service refused the notification (HTTP " + code + "). Turn notifications off and on again in Settings.";
  }
  if (code === 400) return "The push service said the request was malformed (HTTP 400). Turn notifications off and on again in Settings.";
  if (code === 413) return "The notification was too big for the push service (HTTP 413).";
  if (code === 429) return "The push service is limiting how many we send (HTTP 429). It will retry in a minute.";
  if (code !== undefined && code >= 500) return `The push service had a problem (HTTP ${code}). Nudge retries for the next 10 minutes.`;
  const msg = (f.message ?? "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    return "The push service did not answer in time. Nudge retries for the next 10 minutes.";
  }
  if (msg.includes("enotfound") || msg.includes("econnre") || msg.includes("network")) {
    return "Nudge could not reach the push service (network problem). It retries for the next 10 minutes.";
  }
  return f.message ? `The notification could not be sent: ${f.message}`.slice(0, 300) : "The notification could not be sent (unknown reason).";
}

/** The pieces of VAPID setup that make Apple reject pushes, checked without sending anything. */
export function checkVapidSetup(env: { publicKey?: string; privateKey?: string; subject?: string }): string | null {
  if (!env.publicKey || !env.privateKey || !env.subject) {
    return "Notification keys are not fully set up on the server (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).";
  }
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(env.subject)) {
    return "VAPID_SUBJECT must look like mailto:you@example.com or https://your-site. Apple refuses pushes otherwise.";
  }
  return null;
}
