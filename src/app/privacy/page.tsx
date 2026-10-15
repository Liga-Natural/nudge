import Link from "next/link";
import { makeT } from "@/lib/i18n";
import { detectLang } from "@/lib/lang";

export default async function PrivacyPage() {
  const t = makeT(await detectLang());
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-[2rem] font-extrabold">{t("privacy.title")}</h1>
      <p>{t("privacy.body1")}</p>
      <p>{t("privacy.body2")}</p>
      <Link href="/" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
    </main>
  );
}
