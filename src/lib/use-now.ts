"use client";

import { useEffect, useState } from "react";

/** The current time in ms, refreshed every `everyMs` while the screen is open. Starts at the server's time so both agree. */
export function useNow(initialMs: number, everyMs = 15_000): number {
  const [now, setNow] = useState(initialMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    const onShow = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [everyMs]);
  return now;
}
