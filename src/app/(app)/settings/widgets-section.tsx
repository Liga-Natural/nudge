"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revokeApiToken, deleteApiToken } from "@/app/actions-p3";
import { createWidgetToken } from "@/app/actions-widgets";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { formatDay, formatTime } from "@/lib/time";
import type { TokenRow } from "@/lib/types";

const PARAMS = ["next", "today", "school", "grades", "week", "habits", "rotate"] as const;

export function WidgetsSection({ tokens, script }: { tokens: TokenRow[]; script: string }) {
  const { t, lang, tz } = useI18n();
  const router = useRouter();
  const [fresh, setFresh] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(done);
    } catch {
      setNote(t("widgets.copyFailed"));
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-widgets">
      <h2 id="s-widgets" className="text-lg font-bold">
        {t("widgets.title")}
      </h2>
      <p className="text-sm text-muted">{t("widgets.body")}</p>

      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm" aria-label={t("widgets.steps")}>
        {(["widgets.step1", "widgets.step2", "widgets.step3", "widgets.step4"] as Key[]).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>

      <button type="button" className="btn-quiet w-full" onClick={() => void copy(script, t("widgets.scriptCopied"))}>
        {t("widgets.copyScript")}
      </button>
      {note && (
        <p role="status" className="text-sm font-semibold">
          {note}
        </p>
      )}

      <h3 className="mt-1 text-base font-bold">{t("widgets.params")}</h3>
      <ul className="flex flex-col gap-1.5">
        {PARAMS.map((p) => (
          <li key={p} className="text-sm">
            <code className="rounded-lg bg-accent-soft px-1.5 py-0.5 font-bold text-ink">{p}</code> <span className="text-muted">{t(`widgets.param.${p}` as Key)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{t("widgets.lock")}</p>
      <p className="text-sm text-muted">{t("widgets.docs")}</p>

      {tokens.length === 0 ? (
        <p className="text-sm text-muted">{t("widgets.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((tk) => (
            <li key={tk.id} className="rounded-2xl border border-line p-3">
              <p className="font-semibold">
                <code className="text-sm text-muted">{tk.token_prefix}…</code>
              </p>
              <p className="text-sm text-muted">
                {tk.revoked_at
                  ? t("tokens.revokedOn", { when: formatDay(new Date(tk.revoked_at), tz, lang) })
                  : tk.last_used_at
                    ? t("tokens.lastUsed", { when: `${formatDay(new Date(tk.last_used_at), tz, lang)} ${formatTime(new Date(tk.last_used_at), tz, lang)}` })
                    : t("tokens.neverUsed")}
              </p>
              <div className="mt-2 flex gap-2">
                {!tk.revoked_at && (
                  <button className="btn-quiet" disabled={pending} aria-label={`${t("tokens.revoke")}: ${tk.token_prefix}`} onClick={() => start(async () => { await revokeApiToken(tk.id); router.refresh(); })}>
                    {t("tokens.revoke")}
                  </button>
                )}
                <button className="btn-quiet" disabled={pending} aria-label={`${t("action.delete")}: ${tk.token_prefix}`} onClick={() => start(async () => { await deleteApiToken(tk.id); router.refresh(); })}>
                  {t("action.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fresh && (
        <div role="status" className="rounded-2xl border-2 border-accent bg-accent-soft p-3">
          <p className="font-semibold">{t("widgets.once")}</p>
          <code className="my-2 block break-all rounded-xl bg-card p-2 text-sm" data-testid="new-widget-token">
            {fresh}
          </code>
          <button className="btn-quiet" onClick={() => void copy(fresh, t("tokens.copied"))}>
            {t("tokens.copy")}
          </button>
        </div>
      )}

      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() => {
          setError("");
          setNote("");
          start(async () => {
            const r = await createWidgetToken();
            if (r.ok) {
              setFresh(r.token);
              router.refresh();
            } else setError(r.error === "setup" ? t("setup.title") : r.error === "tokens.error.limit" ? t("widgets.error.limit") : t(r.error));
          });
        }}
      >
        {t("widgets.create")}
      </button>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
    </section>
  );
}
