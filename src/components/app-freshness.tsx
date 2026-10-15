"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

const BUILD = process.env.NUDGE_BUILD ?? "dev";
const CHECK_EVERY_MS = 30_000;
const REFRESH_EVERY_MS = 60_000;

/**
 * Keeps the app current on a phone that never really closes it:
 *  - registers the service worker and asks for a newer one whenever the app comes back to the front;
 *  - shows "Update available — tap to reload" when a newer deploy is live;
 *  - re-reads the screen's data when the app comes back to the front (and once a minute while open),
 *    so what you did on another device shows up here.
 */
export function AppFreshness() {
  const t = useT();
  const router = useRouter();
  const [stale, setStale] = useState(false);
  const lastCheck = useRef(0);
  const lastRefresh = useRef(Date.now());

  useEffect(() => {
    let reg: ServiceWorkerRegistration | undefined;
    let cleanupSw: (() => void) | undefined;
    const hadController = !!navigator.serviceWorker?.controller;

    async function checkVersion() {
      const now = Date.now();
      if (now - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = now;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { build?: string };
          if (body.build && body.build !== BUILD) setStale(true);
        }
      } catch {
        // offline: try again next time
      }
      reg?.update().catch(() => {});
    }

    function onShow() {
      if (document.visibilityState !== "visible") return;
      void checkVersion();
      if (Date.now() - lastRefresh.current > 15_000) {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((r) => {
          reg = r;
        })
        .catch(() => {});
      // A new worker took over while an old one was running: a new version is live.
      const onController = () => {
        if (hadController) setStale(true);
      };
      navigator.serviceWorker.addEventListener("controllerchange", onController);
      cleanupSw = () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
    }

    void checkVersion();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    }, REFRESH_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      window.clearInterval(timer);
      cleanupSw?.();
    };
  }, [router]);

  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <button
        className="btn-primary max-w-md shadow-card"
        onClick={() => {
          navigator.serviceWorker?.getRegistration().then((r) => r?.waiting?.postMessage("SKIP_WAITING")).finally(() => window.location.reload());
        }}
      >
        {t("update.available")}
      </button>
    </div>
  );
}
