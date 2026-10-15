import Link from "next/link";
import { AccentTitle } from "@/components/accent-title";
import { NotificationsPanel } from "@/components/notifications-panel";
import { getReadyCtx } from "@/lib/context";
import { makeT, type Key } from "@/lib/i18n";
import { checkVapidSetup } from "@/lib/push-errors";
import { formatDay, formatTime } from "@/lib/time";

type Attempt = { id: string; kind: string; title: string; status: string; error: string | null; http_status: number | null; created_at: string };

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-[#e2f5e8] text-ink",
  failed: "bg-late-bg text-late-ink",
  held: "bg-[#ffefd6] text-ink",
  skipped: "bg-[#eee] text-ink",
  no_phone: "bg-late-bg text-late-ink",
};

export default async function DeliveryLogPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const t = makeT(profile.language);
  const tz = profile.timezone;
  const lang = profile.language;

  const [attemptsRes, subsRes] = await Promise.all([
    supabase.from("delivery_attempts").select("id,kind,title,status,error,http_status,created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("push_subscriptions").select("endpoint"),
  ]);
  // Without file 0007 this table does not exist yet; say so plainly instead of showing an empty log.
  const missingTable = !!attemptsRes.error;
  const attempts = (attemptsRes.data ?? []) as Attempt[];
  const phones = ((subsRes.data ?? []) as { endpoint: string }[]).map((s) => {
    try {
      return new URL(s.endpoint).hostname;
    } catch {
      return "unknown";
    }
  });
  const vapidProblem = checkVapidSetup({
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <Link href="/settings" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
      <AccentTitle pre={t("delivery.title.pre")} accent={t("delivery.title.accent")} post="" />
      <p className="text-muted">{t("delivery.body")}</p>

      <section className="card flex flex-col gap-2 p-5" aria-labelledby="d-health">
        <h2 id="d-health" className="text-lg font-bold">
          {t("delivery.health")}
        </h2>
        <p>{phones.length === 0 ? t("delivery.noPhones") : t("delivery.phones", { n: phones.length, hosts: [...new Set(phones)].join(", ") })}</p>
        {process.env.NUDGE_E2E !== "1" && <p className={vapidProblem ? "font-semibold text-late-ink" : ""}>{vapidProblem ?? t("delivery.keysOk")}</p>}
        <p className="text-sm text-muted">
          {t("delivery.quiet", {
            from: profile.quiet_start.slice(0, 5),
            to: profile.quiet_end.slice(0, 5),
            urgent: profile.urgent_override ? t("delivery.urgentOn") : t("delivery.urgentOff"),
          })}
        </p>
      </section>

      <NotificationsPanel />

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="d-log">
        <h2 id="d-log" className="text-lg font-bold">
          {t("delivery.last")}
        </h2>
        {missingTable ? (
          <p className="font-semibold text-late-ink">{t("delivery.missingSql")}</p>
        ) : attempts.length === 0 ? (
          <p className="text-muted">{t("delivery.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {attempts.map((a) => (
              <li key={a.id} className="rounded-2xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-semibold">{a.title || t(`delivery.kind.${a.kind}` as Key)}</p>
                  <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status] ?? ""}`}>
                    {t(`delivery.status.${a.status}` as Key)}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {formatDay(new Date(a.created_at), tz, lang)} · {formatTime(new Date(a.created_at), tz, lang)} · {t(`delivery.kind.${a.kind}` as Key)}
                </p>
                {a.error && <p className="mt-1 text-sm">{a.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
