"use client";

import { useSyncExternalStore } from "react";

/** True when the phone is set to "Reduce Motion". */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Same, but updates live while the app is open. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      mq?.addEventListener("change", notify);
      return () => mq?.removeEventListener("change", notify);
    },
    prefersReducedMotion,
    () => false,
  );
}

/** A small burst of confetti from a point (or the middle of the screen). Does nothing for Reduce Motion. */
export function fireConfetti(origin?: { x: number; y: number }) {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;z-index:90;pointer-events:none;overflow:hidden";
  const cx = origin?.x ?? window.innerWidth / 2;
  const cy = origin?.y ?? window.innerHeight / 2;
  const colors = ["#e8590c", "#e5484d", "#ffb703", "#fb8500", "#ff758f", "#8ecae6"];
  const holder = document.createElement("div");
  holder.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:0;height:0`;
  for (let i = 0; i < 26; i++) {
    const p = document.createElement("span");
    p.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
    const dist = 70 + Math.random() * 110;
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist - 40}px`);
    p.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
    holder.appendChild(p);
  }
  layer.appendChild(holder);
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}
