import { cookies, headers } from "next/headers";
import { isLang, type Lang } from "@/lib/i18n";

/** For pages shown before sign-in: the saved choice, else the phone's language, else English. */
export async function detectLang(): Promise<Lang> {
  const saved = (await cookies()).get("nudge-lang")?.value;
  if (isLang(saved)) return saved;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("es") ? "es" : "en";
}
