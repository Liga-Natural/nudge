import Link from "next/link";
import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { makeT, type Key } from "@/lib/i18n";
import { formatDay, formatMoney, formatTime } from "@/lib/time";
import type { UpdateRow } from "@/lib/types";
import { MarkRead } from "./mark-read";

const EMOJI: Record<string, string> = { new_item: "🆕", changed: "✏️", removed: "🗑️", paid: "💳", info: "ℹ️", grade: "🎓", bill: "🧾" };

export default async function UpdatesPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const lang = profile.language;
  const tz = profile.timezone;
  if (!featureOn(profile, "updates")) return <FeatureOff lang={lang} name="feature.updates" body="feature.updates.body" />;

  const { data } = await supabase.from("updates").select("id,kind,title,body,item_id,created_at,read_at").order("created_at", { ascending: false }).limit(60);
  const rows = (data ?? []) as UpdateRow[];
  const unread = rows.some((r) => !r.read_at);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("updates.title.pre")} accent={t("updates.title.accent")} post={t("updates.title.post")} />
      {unread && <MarkRead />}
      {rows.length === 0 ? (
        <p className="card p-6 text-center text-muted">{t("updates.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const when = new Date(r.created_at);
            const body = (r.kind === "paid" || r.kind === "bill") && r.body && /^\d+$/.test(r.body) ? formatMoney(Number(r.body), "USD", lang) : r.kind === "new_item" ? null : r.body;
            const inner = (
              <>
                <span aria-hidden className="text-2xl">
                  {EMOJI[r.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    <span className="mr-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs">{t(`updates.${r.kind}` as Key)}</span>
                    {r.title}
                  </span>
                  <span className="block text-sm text-muted">
                    {body ? `${body} · ` : ""}
                    {formatDay(when, tz, lang)} · {formatTime(when, tz, lang)}
                  </span>
                </span>
                {!r.read_at && <span className="h-2.5 w-2.5 flex-none rounded-full bg-accent" aria-hidden />}
              </>
            );
            return (
              <li key={r.id} className="list-none">
                {r.item_id ? (
                  <Link href={`/item/${r.item_id}`} className="card flex items-center gap-3 p-3">
                    {inner}
                  </Link>
                ) : (
                  <div className="card flex items-center gap-3 p-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
