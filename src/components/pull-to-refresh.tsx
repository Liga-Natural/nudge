"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";

const PULL_AT = 72;

/**
 * Pull down from the top of any screen to re-read its data. Does nothing while a sheet is open,
 * and never blocks normal scrolling (the page is only watched, never held back).
 */
export function PullToRefresh() {
  const t = useT();
  const router = useRouter();
  const [dy, setDy] = useState(0);
  const [pending, start] = useTransition();
  const startY = useRef<number | null>(null);
  const pulled = useRef(0);

  useEffect(() => {
    const down = (e: TouchEvent) => {
      const busy = !!document.querySelector('[role="dialog"]');
      startY.current = window.scrollY <= 0 && !busy && e.touches.length === 1 ? e.touches[0].clientY : null;
      pulled.current = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY.current === null) return;
      const d = e.touches[0].clientY - startY.current;
      if (d <= 0 || window.scrollY > 0) {
        pulled.current = 0;
        setDy(0);
        return;
      }
      pulled.current = Math.min(d, PULL_AT * 1.6);
      setDy(pulled.current);
    };
    const up = () => {
      const go = pulled.current >= PULL_AT;
      startY.current = null;
      pulled.current = 0;
      setDy(0);
      if (go) start(() => router.refresh());
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [router]);

  const show = dy > 8 || pending;
  if (!show) return null;
  const ready = dy >= PULL_AT;
  return (
    <div
      role="status"
      aria-label={pending ? t("ptr.refreshing") : ready ? t("ptr.release") : t("ptr.pull")}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[calc(0.5rem+env(safe-area-inset-top))]"
      style={{ transform: `translateY(${pending ? 8 : Math.min(dy, PULL_AT) / 2}px)` }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-lg shadow-card" aria-hidden>
        <span className={pending ? "ptr-spin inline-block" : "inline-block"} style={pending ? undefined : { transform: `rotate(${Math.min(dy / PULL_AT, 1) * 180}deg)` }}>
          {pending ? "⟳" : "↓"}
        </span>
      </span>
    </div>
  );
}
