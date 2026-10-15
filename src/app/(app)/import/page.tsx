import { AccentTitle } from "@/components/accent-title";
import { FeatureOff } from "@/components/feature-off";
import { getReadyCtx } from "@/lib/context";
import { featureOn } from "@/lib/features";
import { makeT } from "@/lib/i18n";
import { ImportClient } from "./import-client";

export default async function ImportPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const { profile } = ctx;
  const t = makeT(profile.language);
  if (!featureOn(profile, "inbox")) return <FeatureOff lang={profile.language} name="feature.inbox" body="feature.inbox.body" />;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("import.title.pre")} accent={t("import.title.accent")} post="" />
      <p className="text-muted">{t("import.body")}</p>
      <ImportClient />
    </main>
  );
}
