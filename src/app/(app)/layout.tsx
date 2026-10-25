import { AppFreshness } from "@/components/app-freshness";
import { Opening } from "@/components/opening";
import { ToastProvider } from "@/components/ui/toast";
import { ViewTransitionProvider } from "@/components/ui/vt-link";
import { BottomNav } from "@/components/bottom-nav";
import { PullToRefresh } from "@/components/pull-to-refresh";
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
      <ViewTransitionProvider>
        <ToastProvider>
          <Opening enabled={ctx.profile.prefs?.opening_animation !== false} />
          <AppFreshness />
          <PullToRefresh />
          <div className="flex-1 pb-28">{children}</div>
          <BottomNav mode={ctx.profile.mode} />
        </ToastProvider>
      </ViewTransitionProvider>
    </I18nProvider>
  );
}
