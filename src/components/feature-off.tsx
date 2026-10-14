import Link from "next/link";
import type { Key } from "@/lib/i18n";
import { makeT, type Lang } from "@/lib/i18n";

// Shown when someone opens a page for a feature they have not switched on.
export function FeatureOff({ lang, name, body }: { lang: Lang; name: Key; body: Key }) {
  const t = makeT(lang);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10">
      <h1 className="text-[2rem] font-extrabold leading-tight">{t(name)}</h1>
      <p className="card p-6 text-muted">{t(body)}</p>
      <Link href="/settings" className="btn-primary">
        {t("nav.settings")} → {t("settings.features")}
      </Link>
    </main>
  );
}
