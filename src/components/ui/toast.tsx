"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

type ToastInput = { message: string; undo?: () => void | Promise<void>; ms?: number };
type ToastItem = ToastInput & { id: number };

const Ctx = createContext<{ toast: (t: ToastInput) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

/** Little messages at the bottom. Anything destructive gets one with an Undo button for a few seconds. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((i) => i.id !== id)), []);
  const toast = useCallback(
    (input: ToastInput) => {
      const id = next.current++;
      setItems((cur) => [...cur.slice(-2), { ...input, id }]);
      setTimeout(() => dismiss(id), input.ms ?? (input.undo ? 6000 : 3500));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} role="status" className="slide-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-background shadow-card">
            <span className="min-w-0 flex-1 font-semibold">{i.message}</span>
            {i.undo && (
              <button
                className="min-h-[44px] flex-none rounded-full px-3 font-extrabold text-[#ffb07a]"
                onClick={async () => {
                  dismiss(i.id);
                  await i.undo?.();
                }}
              >
                {t("action.undo")}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
