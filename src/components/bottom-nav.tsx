"use client";

import { VTLink as Link } from "@/components/ui/vt-link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AddSheet } from "@/components/add-sheet";
import { ADD_EVENT } from "@/lib/add-events";
import { isAddKind, type AddKind } from "@/lib/add-flows";
import { useT } from "@/lib/i18n/client";

export function BottomNav({ mode }: { mode: "simple" | "full" }) {
  const pathname = usePathname();
  const t = useT();
  const [add, setAdd] = useState<{ kind: AddKind | null; at: number } | null>(null);

  // Any screen can open the sheet (an empty card's button), straight into one kind.
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<{ kind: unknown }>).detail?.kind;
      setAdd({ kind: isAddKind(k) ? k : null, at: Date.now() });
    };
    window.addEventListener(ADD_EVENT, on);
    return () => window.removeEventListener(ADD_EVENT, on);
  }, []);

  if (pathname.startsWith("/onboarding")) return null;

  const tab = (href: string, emoji: string, label: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
          active ? "text-accent-text" : "text-muted"
        }`}
      >
        <span aria-hidden className="text-xl leading-none">
          {emoji}
        </span>
        {label}
      </Link>
    );
  };

  const fab = (
    <button
      key="add"
      type="button"
      aria-label={t("nav.add")}
      aria-haspopup="dialog"
      onClick={() => {
        setAdd({ kind: null, at: Date.now() });
      }}
      className="-mt-6 flex h-14 w-14 flex-none items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-3xl font-bold text-white shadow-card transition-transform active:scale-90"
    >
      <span aria-hidden>+</span>
    </button>
  );
  const today = tab("/", "🏠", t("nav.today"));
  const upcoming = tab("/upcoming", "🗓️", t("nav.upcoming"));

  return (
    <>
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-md items-center px-2">
        {mode === "full" ? [today, upcoming, fab, tab("/settings", "⚙️", t("nav.settings"))] : [today, fab, upcoming]}
      </div>
    </nav>
    {add && <AddSheet open onClose={() => setAdd(null)} startKind={add.kind} openedAt={add.at} />}
    </>
  );
}
