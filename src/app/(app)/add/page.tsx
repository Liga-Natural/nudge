import { AccentTitle } from "@/components/accent-title";
import { getReadyCtx } from "@/lib/context";
import { makeT } from "@/lib/i18n";
import { loadSpaces } from "@/lib/queries";
import { AddFlow } from "./add-flow";

export default async function AddPage() {
  const ctx = await getReadyCtx();
  if (!ctx) return null;
  const t = makeT(ctx.profile.language);
  const spaces = await loadSpaces(ctx.supabase);
  const defaultSpace = spaces.find((s) => s.is_default) ?? spaces[0] ?? null;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8">
      <header className="flex flex-col gap-2">
        <AccentTitle pre={t("add.title.pre")} accent={t("add.title.accent")} post={t("add.title.post")} />
        <p className="text-muted">{t("add.subtitle")}</p>
      </header>
      <AddFlow spaces={spaces} defaultSpaceId={defaultSpace?.id ?? null} showSpaces={ctx.profile.mode === "full"} />
    </main>
  );
}
