import { AccentTitle } from "@/components/accent-title";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { loadSpaces } from "@/lib/queries";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const t = makeT(ctx.profile.language);
  const spaces = await loadSpaces(ctx.supabase);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <AccentTitle pre={t("settings.title.pre")} accent={t("settings.title.accent")} post={t("settings.title.post")} />
      <SettingsForm profile={ctx.profile} spaces={spaces} />
    </main>
  );
}
