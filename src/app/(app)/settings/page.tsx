import { AccentTitle } from "@/components/accent-title";
import { inboxUrl } from "@/app/actions-p3";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { loadSpaces } from "@/lib/queries";
import type { Course, FeedRow, TokenRow } from "@/lib/types";
import { featureOn } from "@/lib/features";
import { SettingsForm } from "./settings-form";

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
    featureOn(profile, "inbox")
      ? supabase.from("api_tokens").select("id,name,token_prefix,created_at,last_used_at,expires_at,revoked_at").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    inboxUrl(),
  ]);
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
        tokens={(tokenRes.data ?? []) as TokenRow[]}
        endpoint={endpoint}
      />
    </main>
  );
}
