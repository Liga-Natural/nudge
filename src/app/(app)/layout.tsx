import { BottomNav } from "@/components/bottom-nav";
import { SetupNeeded } from "@/components/setup-needed";
import { getCtx } from "@/lib/context";
import { I18nProvider } from "@/lib/i18n/client";
import { detectLang } from "@/lib/lang";

// Everything after sign-in: shows a friendly note if the setup SQL has not been run, and gives
// every screen the right language. (Pages send new people to onboarding with getReadyCtx.)
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (ctx.state === "needs_sql") return <SetupNeeded lang={await detectLang()} />;

  return (
    <I18nProvider lang={ctx.profile.language} tz={ctx.profile.timezone}>
      <div className="flex-1 pb-28">{children}</div>
      <BottomNav mode={ctx.profile.mode} />
    </I18nProvider>
  );
}
