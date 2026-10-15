"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleChecklist } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { ChecklistRow } from "@/lib/types";

/** The checklist on an item. Ticking is instant on screen and rolls back with a message if it could not be saved. */
export function ChecklistView({ rows }: { rows: ChecklistRow[] }) {
  const t = useT();
  const router = useRouter();
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.id, r.done])));
  const [error, setError] = useState("");
  const [, start] = useTransition();
  const doneCount = rows.filter((r) => done[r.id]).length;

  function tick(row: ChecklistRow, value: boolean) {
    const before = done[row.id];
    setDone((cur) => ({ ...cur, [row.id]: value }));
    setError("");
    start(async () => {
      const r = await toggleChecklist(row.id, value);
      if (!r.ok) {
        setDone((cur) => ({ ...cur, [row.id]: before }));
        setError(r.error === "setup" ? t("setup.title") : t(r.error));
      } else router.refresh();
    });
  }

  return (
    <section className="card flex flex-col gap-2 p-5" aria-labelledby="chk-h">
      <h2 id="chk-h" className="text-lg font-bold">
        {t("item.checklist")} <span className="text-sm font-semibold text-muted">{doneCount}/{rows.length}</span>
      </h2>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <label className="flex min-h-[44px] items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-[#e8590c]" checked={!!done[r.id]} onChange={(e) => tick(r, e.target.checked)} />
              <span className={done[r.id] ? "text-muted line-through" : ""}>{r.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
    </section>
  );
}
