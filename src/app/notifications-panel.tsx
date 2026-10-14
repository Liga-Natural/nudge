"use client";

import { useEffect, useState } from "react";

type Status =
  | "checking"
  | "needs-install"
  | "unsupported"
  | "blocked"
  | "off"
  | "on";

const buttonClass =
  "w-full min-h-[54px] rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 text-lg font-semibold text-white disabled:opacity-50";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub: PushSubscription) {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Something went wrong.");
  }
}

export function NotificationsPanel() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isIos && !standalone) return setStatus("needs-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return setStatus("unsupported");
      }
      if (Notification.permission === "denied") return setStatus("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const existing = await reg.pushManager.getSubscription();
      if (existing && Notification.permission === "granted") {
        // Make sure the server really has this phone, then show the test button.
        try {
          await saveSubscription(existing);
          setStatus("on");
        } catch (e) {
          setStatus("off");
          setMessage(e instanceof Error ? e.message : "Something went wrong.");
        }
        return;
      }
      setStatus("off");
    })().catch(() => setStatus("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
          ),
        }));
      await saveSubscription(sub);
      setStatus("on");
      setMessage("Notifications are on. Tap the test button.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? "Sent! It should appear in a few seconds." : (body.error ?? "Something went wrong."));
    } catch {
      setMessage("We couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-bold">Notifications</h2>

      {status === "checking" && <p className="text-neutral-600">Checking…</p>}

      {status === "needs-install" && (
        <p className="text-neutral-700">
          On iPhone, notifications only work after you add Nudge to your Home
          Screen. In Safari tap <strong>Share</strong>, then{" "}
          <strong>Add to Home Screen</strong>, then open Nudge from the new icon.
        </p>
      )}

      {status === "unsupported" && (
        <p className="text-neutral-700">
          This browser can&apos;t show notifications. Try Safari on iPhone
          (installed to the Home Screen) or Chrome on a computer.
        </p>
      )}

      {status === "blocked" && (
        <p className="text-neutral-700">
          Notifications are blocked for Nudge. Turn them on in your phone&apos;s
          Settings, then come back.
        </p>
      )}

      {status === "off" && (
        <>
          <p className="text-neutral-700">
            Nudge will only ping you for things you asked it to remember.
          </p>
          <button className={buttonClass} onClick={turnOn} disabled={busy}>
            Turn on notifications
          </button>
        </>
      )}

      {status === "on" && (
        <button className={buttonClass} onClick={sendTest} disabled={busy}>
          Send me a test notification
        </button>
      )}

      {message && (
        <p role="status" className="text-sm text-neutral-700">
          {message}
        </p>
      )}
    </section>
  );
}
