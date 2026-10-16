"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

type Go = (href: string) => void;
const Ctx = createContext<Go | null>(null);

type WithTransitions = Document & { startViewTransition?: (update: () => Promise<void> | void) => unknown };

/** Page changes cross-fade with the View Transitions API. Browsers without it (or with Reduce Motion) just navigate. */
export function ViewTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const waiting = useRef<(() => void) | null>(null);

  useEffect(() => {
    waiting.current?.();
    waiting.current = null;
  }, [pathname]);

  const go = useCallback<Go>(
    (href) => {
      const doc = document as WithTransitions;
      if (!doc.startViewTransition || prefersReducedMotion()) return router.push(href);
      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            waiting.current = resolve;
            router.push(href);
            setTimeout(resolve, 1200); // never hang the screen if the page is slow
          }),
      );
    },
    [router],
  );

  return <Ctx.Provider value={useMemo(() => go, [go])}>{children}</Ctx.Provider>;
}

export function VTLink({ href, onClick, ...rest }: React.ComponentProps<typeof Link>) {
  const go = useContext(Ctx);
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !go || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (typeof href !== "string" || !href.startsWith("/")) return;
        e.preventDefault();
        go(href);
      }}
    />
  );
}
