import Link from "next/link";
import { makeT } from "@/lib/i18n";
import { detectLang } from "@/lib/lang";

export default async function TermsPage() {
  const t = makeT(await detectLang());
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-[2rem] font-extrabold">{t("terms.title")}</h1>
      <p>{t("terms.body1")}</p>
      <p>{t("terms.body2")}</p>
      <Link href="/" className="btn-quiet w-fit">
        ← {t("action.back")}
      </Link>
    </main>
  );
}
