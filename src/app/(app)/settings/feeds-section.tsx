"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createFeed, deleteFeed, syncFeedNow } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import { formatDay, formatTime } from "@/lib/time";
import type { FeedRow } from "@/lib/types";

const TYPES = ["homework", "payment", "event", "task"] as const;

export function FeedsSection({ feeds }: { feeds: FeedRow[] }) {
  const { t, lang, tz } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("homework");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="s-feeds">
      <h2 id="s-feeds" className="text-lg font-bold">
        {t("feeds.title")}
      </h2>
      <p className="text-sm text-muted">{t("feeds.body")}</p>

      {feeds.length === 0 ? (
        <p className="text-sm">{t("feeds.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feeds.map((f) => (
            <li key={f.id} className="rounded-2xl border border-line p-3">
              <p className="font-semibold">{f.name}</p>
              <p className="text-sm text-muted">
                {f.host} · {t("feeds.items", { n: f.item_count })}
              </p>
              <p className="text-sm text-muted">
                {f.last_synced_at
                  ? t("feeds.lastChecked", { time: `${formatDay(new Date(f.last_synced_at), tz, lang)} ${formatTime(new Date(f.last_synced_at), tz, lang)}` })
                  : t("feeds.never")}
              </p>
              {f.last_error && (
                <p role="status" className="text-sm font-semibold text-late-ink">
                  {t("feeds.problem", { message: f.last_error })}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button className="btn-quiet" disabled={pending} onClick={() => start(async () => { await syncFeedNow(f.id); router.refresh(); })}>
                  {t("feeds.syncNow")}
                </button>
                <button className="btn-quiet" disabled={pending} aria-label={`${t("feeds.remove")}: ${f.name}`} onClick={() => start(async () => { await deleteFeed(f.id); router.refresh(); })}>
                  {t("feeds.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          start(async () => {
            const r = await createFeed({ name, url, defaultType: type });
            if (r.ok) {
              setName("");
              setUrl("");
              router.refresh();
            } else setError(r.error === "setup" ? t("setup.title") : t(r.error as Key));
          });
        }}
      >
        <div>
          <label htmlFor="feed-name" className="mb-1 block text-sm font-semibold text-muted">
            {t("feeds.name")}
          </label>
          <input id="feed-name" className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="feed-url" className="mb-1 block text-sm font-semibold text-muted">
            {t("feeds.url")}
          </label>
          <input id="feed-url" className="field" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="feed-type" className="mb-1 block text-sm font-semibold text-muted">
            {t("feeds.type")}
          </label>
          <select id="feed-type" className="field" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`type.${ty}` as Key)}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-late-ink">
            {error}
          </p>
        )}
        <button className="btn-quiet w-full" type="submit" disabled={pending}>
          {t("feeds.add")}
        </button>
      </form>
    </section>
  );
}
