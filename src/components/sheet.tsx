"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A bottom sheet that springs open (and drags shut), used for snoozing, quick actions and prompts.
 * Escape and a tap outside close it; focus moves into it and back out.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [dy, setDy] = useState(0);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("button, a[href], input, select, textarea");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop fixed inset-0 z-40 flex items-end justify-center" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-panel w-full max-w-md rounded-t-[28px] bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 flex h-6 w-24 cursor-grab touch-none items-start justify-center"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => startY.current !== null && setDy(Math.max(0, e.clientY - startY.current))}
          onPointerUp={() => {
            const d = dy;
            startY.current = null;
            setDy(0);
            if (d > 90) onClose();
          }}
        >
          <span className="mt-1 block h-1.5 w-10 rounded-full bg-line" />
        </div>
        <h2 className="mb-3 text-xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
