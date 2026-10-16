"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { prefersReducedMotion } from "@/lib/motion";
import { formatTime } from "@/lib/time";
import { NudgeMark } from "./ui/nudge-mark";

// A cold start = the first screen of this app launch (sessionStorage is empty then). A tiny script in
// the page head (layout.tsx) marks <html data-cold="1"> before anything paints, so the overlay below,
// which is in the page's HTML, covers the gap between the iPhone launch image and the app.
//
// Timing rules (from the brief): never adds wait. Everything is over by about 1.2 s after the page
// started loading; if the app was opened within the last 30 minutes (or Reduce Motion is on) it is
// only a 300 ms fade; if the data is not ready after 1.2 s you are let in with skeletons, and after
// 4 s a "Still syncing..." note appears.
const LEAVE_BY_MS = 1200;
const SLOW_MS = 4000;
const WARM_MS = 30 * 60_000;

const isReady = () => !document.querySelector('[aria-busy="true"]');

export function Opening({ enabled }: { enabled: boolean }) {
  const { t, lang, tz } = useI18n();
  const [phase, setPhase] = useState<"show" | "gone">("show");
  const [leaving, setLeaving] = useState(false);
  const [progress, setProgress] = useState(0.15);
  const [slow, setSlow] = useState(false);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const cold = root.dataset.cold === "1";
    const done = () => {
      root.dataset.splash = "done";
      setPhase("gone");
    };
    try {
      sessionStorage.setItem("nudge-opened", "1");
      localStorage.setItem("nudge-opening", enabled ? "on" : "off");
    } catch {
      // private mode: the animation just runs every time
    }
    if (!cold || !enabled) {
      done();
      return;
    }

    let warm = false;
    try {
      warm = Date.now() - Number(localStorage.getItem("nudge-last-open") || 0) < WARM_MS;
      localStorage.setItem("nudge-last-open", String(Date.now()));
    } catch {
      // ignore
    }
    const quick = warm || prefersReducedMotion();
    const sinceNav = () => performance.now();
    // Keep the pop-in on screen long enough to see, but never past the 1.2 s mark.
    const minShow = quick ? 0 : Math.max(0, Math.min(700, LEAVE_BY_MS - 420 - sinceNav()));
    const shownAt = performance.now();
    let finished = false;
    let timers: ReturnType<typeof setTimeout>[] = [];

    function leave() {
      if (finished) return;
      finished = true;
      setProgress(1);
      const target = document.getElementById("header-mark");
      const mark = markRef.current;
      if (!quick && target && mark && mark.animate) {
        const a = mark.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        mark.animate(
          [
            { transform: "none" },
            { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.width / a.width})` },
          ],
          { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
        );
        timers.push(setTimeout(() => setLeaving(true), 140), setTimeout(done, 480));
      } else {
        setLeaving(true);
        timers.push(setTimeout(done, 320));
      }
    }

    function check() {
      if (finished) return;
      if (isReady()) {
        setProgress(0.85);
        const wait = Math.max(0, minShow - (performance.now() - shownAt));
        timers.push(setTimeout(leave, wait));
        observer.disconnect();
      }
    }
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    timers.push(setTimeout(() => setProgress((p) => Math.max(p, 0.5)), 120));
    // Let in with skeletons rather than make anyone wait for slow data.
    timers.push(setTimeout(leave, Math.max(0, LEAVE_BY_MS - sinceNav())));
    check();

    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      timers = [];
    };
  }, [enabled]);

  // "Still syncing...": still on skeletons after 4 s.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!isReady()) setSlow(true);
    }, Math.max(0, SLOW_MS - performance.now()));
    const observer = new MutationObserver(() => isReady() && setSlow(false));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    return () => {
      clearTimeout(id);
      observer.disconnect();
    };
  }, []);

  // Offline note, with when the data was last fresh.
  const [offline, setOffline] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  useEffect(() => {
    const stamp = () => {
      try {
        if (navigator.onLine) localStorage.setItem("nudge-last-sync", String(Date.now()));
        const v = Number(localStorage.getItem("nudge-last-sync") || 0);
        setUpdated(v || null);
      } catch {
        // ignore
      }
    };
    const update = () => {
      stamp();
      setOffline(!navigator.onLine);
    };
    update();
    const every = setInterval(stamp, 60_000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      clearInterval(every);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <>
      {phase === "show" && (
        <div className="splash" data-leaving={leaving} aria-hidden>
          <div className="splash-line" style={{ transform: `scaleX(${progress})` }} />
          <div ref={markRef} className="splash-mark">
            <NudgeMark size={96} id="sp" />
          </div>
        </div>
      )}
      {(slow || offline) && (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4" role="status">
          <span className="slide-in rounded-full bg-ink px-4 py-2 text-sm font-bold text-background shadow-card">
            {offline ? t("offline.badge", { time: updated ? formatTime(new Date(updated), tz, lang) : "—" }) : t("opening.syncing")}
          </span>
        </div>
      )}
    </>
  );
}
