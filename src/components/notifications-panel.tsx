"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";

type Status = "checking" | "needs-install" | "unsupported" | "blocked" | "off" | "on";

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

export function NotificationsPanel({ showTest = true, bare = false, onEnabled }: { showTest?: boolean; bare?: boolean; onEnabled?: () => void }) {
  const t = useT();
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
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setStatus("unsupported");
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
          setMessage(e instanceof Error ? e.message : t("common.error"));
        }
        return;
      }
      setStatus("off");
    })().catch(() => setStatus("unsupported"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setStatus(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));
      await saveSubscription(sub);
      setStatus("on");
      setMessage(t("notif.on"));
      onEnabled?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("common.error"));
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
      setMessage(res.ok ? t("notif.sent") : (body.error ?? t("common.error")));
    } catch {
      setMessage(t("notif.offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={bare ? "flex flex-col gap-4" : "card flex flex-col gap-4 p-5"}>
      {!bare && <h2 className="text-xl font-bold">{t("notif.title")}</h2>}
      {status === "checking" && <p className="text-muted">{t("notif.checking")}</p>}
      {status === "needs-install" && <p>{t("notif.needsInstall")}</p>}
      {status === "unsupported" && <p>{t("notif.unsupported")}</p>}
      {status === "blocked" && <p>{t("notif.blocked")}</p>}
      {status === "off" && (
        <>
          <p>{t("notif.off")}</p>
          <button className="btn-primary" onClick={turnOn} disabled={busy}>
            {t("notif.turnOn")}
          </button>
        </>
      )}
      {status === "on" && showTest && (
        <button className="btn-primary" onClick={sendTest} disabled={busy}>
          {t("notif.test")}
        </button>
      )}
      {status === "on" && !showTest && <p className="font-semibold">✓ {t("notif.on")}</p>}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
