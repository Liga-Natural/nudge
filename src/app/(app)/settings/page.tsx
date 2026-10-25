import { AccentTitle } from "@/components/accent-title";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inboxUrl } from "@/app/actions-p3";
import { appOrigin } from "@/app/actions-widgets";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { loadSpaces } from "@/lib/queries";
import type { Course, FeedRow, TokenRow } from "@/lib/types";
import { featureOn } from "@/lib/features";
import { SettingsForm } from "./settings-form";
import { WidgetsSection } from "./widgets-section";

const FEED_COLUMNS = "id,name,host,default_type,enabled,last_synced_at,last_error,item_count,kind,course_id";

export default async function SettingsPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const t = makeT(ctx.profile.language);
  const { profile, supabase } = ctx;
  const wantsFeeds = featureOn(profile, "feeds") || featureOn(profile, "school") || featureOn(profile, "bills");
  const [spaces, feedRes, courseRes, tokenRes, endpoint] = await Promise.all([
    loadSpaces(supabase),
    wantsFeeds ? supabase.from("calendar_feeds").select(FEED_COLUMNS).order("created_at") : Promise.resolve({ data: [] }),
    featureOn(profile, "school") ? supabase.from("courses").select("id,name,color").order("created_at") : Promise.resolve({ data: [] }),
    supabase.from("api_tokens").select("id,name,token_prefix,created_at,last_used_at,expires_at,revoked_at").order("created_at", { ascending: false }),
    inboxUrl(),
  ]);
  // Import tokens (ndg_) and widget tokens (ndw_) live in one table; each section shows its own kind.
  const allTokens = (tokenRes.data ?? []) as TokenRow[];
  const importTokens = featureOn(profile, "inbox") ? allTokens.filter((tk) => !tk.token_prefix.startsWith("ndw_")) : [];
  const widgetTokens = allTokens.filter((tk) => tk.token_prefix.startsWith("ndw_"));
  const origin = await appOrigin();
  let script = "";
  try {
    script = readFileSync(join(process.cwd(), "scripts", "nudge-widget.js"), "utf8").replace("__NUDGE_URL__", origin || "__NUDGE_URL__");
  } catch {
    script = "";
  }
  const feeds = (feedRes.data ?? []) as FeedRow[];
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("settings.title.pre")} accent={t("settings.title.accent")} post={t("settings.title.post")} />
      <SettingsForm
        profile={profile}
        spaces={spaces}
        feeds={feeds.filter((f) => (f.kind ?? "calendar") === "calendar")}
        classroomFeeds={feeds.filter((f) => f.kind === "classroom")}
        billsFeeds={feeds.filter((f) => f.kind === "bills")}
        courses={(courseRes.data ?? []) as Course[]}
        tokens={importTokens}
        endpoint={endpoint}
      />
      <WidgetsSection tokens={widgetTokens} script={script} />
    </main>
  );
}
