import { AccentTitle } from "@/components/accent-title";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { makeT } from "@/lib/i18n";
import { detectLang } from "@/lib/lang";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const lang = await detectLang();
  const t = makeT(lang);
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <AccentTitle pre={t("login.welcome.pre")} accent={APP_NAME} />
      <p className="text-muted">{lang === "es" ? t("onb.welcome.subtitle") : APP_TAGLINE}</p>
      <LoginForm lang={lang} />
    </main>
  );
}
