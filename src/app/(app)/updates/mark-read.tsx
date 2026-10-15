"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markUpdatesRead } from "@/app/actions";
import { useT } from "@/lib/i18n/client";

export function MarkRead() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button className="btn-quiet w-fit" disabled={pending} onClick={() => start(async () => { await markUpdatesRead(); router.refresh(); })}>
      ✓ {t("action.done")}
    </button>
  );
}
