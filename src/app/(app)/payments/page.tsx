import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { PaymentRow } from "@/components/payment-row";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { makeT } from "@/lib/i18n";
import { dueLabel, moneyLabel } from "@/lib/labels";
import { splitPayments, todayKey } from "@/lib/payments";
import { loadAgenda } from "@/lib/queries";
import { addLocalDays, endOfLocalDay, formatDay, formatMoney } from "@/lib/time";
import type { AgendaEntry } from "@/lib/types";

export default async function PaymentsPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const lang = profile.language;
  const tz = profile.timezone;
  if (!featureOn(profile, "payments")) return <FeatureOff lang={lang} name="feature.payments" body="feature.payments.body" />;

  const now = new Date();
  const { entries } = await loadAgenda(supabase, { from: addLocalDays(now, tz, -90), to: endOfLocalDay(addLocalDays(now, tz, 45), tz) });
  const g = splitPayments(entries, now, tz);
  const today = todayKey(now, tz);

  const { data: paidData } = await supabase.from("item_payments").select("id,item_id,amount_cents,currency,paid_on").order("paid_on", { ascending: false }).limit(8);
  const paid = (paidData ?? []) as { id: string; item_id: string; amount_cents: number; currency: string; paid_on: string }[];
  const titles = new Map<string, string>();
  if (paid.length) {
    const { data: items } = await supabase.from("items").select("id,title").in("id", [...new Set(paid.map((p) => p.item_id))]);
    for (const i of (items ?? []) as { id: string; title: string }[]) titles.set(i.id, i.title);
  }

  const list = (rows: AgendaEntry[], late = false) => (
    <ul className="flex flex-col gap-2">
      {rows.map((e) => (
        <PaymentRow key={e.occId} entry={e} late={late} today={today} timeLabel={dueLabel(e, now, tz, lang, t)} money={moneyLabel(e, lang)} />
      ))}
    </ul>
  );
  const section = (id: string, title: string, total: number, rows: AgendaEntry[], late = false) =>
    rows.length ? (
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={id} className={`text-lg font-bold ${late ? "text-late-ink" : ""}`}>
            {title}
          </h2>
          <span className="font-bold">{formatMoney(total, "USD", lang)}</span>
        </div>
        {list(rows, late)}
      </section>
    ) : null;

  const none = !g.late.length && !g.week.length && !g.month.length;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("payments.title.pre")} accent={t("payments.title.accent")} post={t("payments.title.post")} />
      {!none && (
        <div className="card grid grid-cols-2 gap-3 p-4" aria-label="Totals">
          <div>
            <p className="text-sm text-muted">{t("payments.totalWeek")}</p>
            <p className="text-2xl font-extrabold">{formatMoney(g.totals.week, "USD", lang)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">{t("payments.totalMonth")}</p>
            <p className="text-2xl font-extrabold">{formatMoney(g.totals.month, "USD", lang)}</p>
          </div>
        </div>
      )}
      {section("p-late", t("payments.late"), g.totals.late, g.late, true)}
      {section("p-week", t("payments.thisWeek"), g.totals.week, g.week)}
      {section("p-month", t("payments.thisMonth"), g.totals.month, g.month)}
      {none && <p className="card p-6 text-center text-muted">{t("payments.empty")}</p>}

      <section aria-labelledby="p-hist" className="card flex flex-col gap-2 p-5">
        <h2 id="p-hist" className="text-lg font-bold">
          {t("payments.history")}
        </h2>
        {paid.length === 0 ? (
          <p className="text-muted">{t("payments.noHistory")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {paid.map((p) => {
              const [y, m, d] = p.paid_on.split("-").map(Number);
              return (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="truncate font-semibold">{titles.get(p.item_id) ?? "—"}</span>
                  <span className="flex-none text-muted">
                    {t("payments.paidLine", {
                      amount: formatMoney(p.amount_cents, p.currency, lang),
                      day: formatDay(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", lang),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
