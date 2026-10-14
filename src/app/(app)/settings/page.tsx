import { AccentTitle } from "@/components/accent-title";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { loadSpaces } from "@/lib/queries";
import type { FeedRow } from "@/lib/types";
import { featureOn } from "@/lib/features";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const t = makeT(ctx.profile.language);
  const spaces = await loadSpaces(ctx.supabase);
  let feeds: FeedRow[] = [];
  if (featureOn(ctx.profile, "feeds")) {
    const { data } = await ctx.supabase.from("calendar_feeds").select("id,name,host,default_type,enabled,last_synced_at,last_error,item_count").order("created_at");
    feeds = (data ?? []) as FeedRow[];
  }
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("settings.title.pre")} accent={t("settings.title.accent")} post={t("settings.title.post")} />
      <SettingsForm profile={ctx.profile} spaces={spaces} feeds={feeds} />
    </main>
  );
}
