import { en, type Key } from "./en";
import { es } from "./es";

export type Lang = "en" | "es";
export type { Key };
export const LANGS: Lang[] = ["en", "es"];
export const dictionaries: Record<Lang, Record<Key, string>> = { en, es };

export type Vars = Record<string, string | number>;
export type TFn = (key: Key, vars?: Vars) => string;

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  let text: string = dictionaries[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

export const makeT =
  (lang: Lang): TFn =>
  (key, vars) =>
    translate(lang, key, vars);

export const isLang = (v: unknown): v is Lang => v === "en" || v === "es";
