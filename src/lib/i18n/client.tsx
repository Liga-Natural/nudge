"use client";

import { createContext, useContext, useMemo } from "react";
import { dictionaries, makeT, type Lang, type TFn } from ".";

const Ctx = createContext<{ lang: Lang; t: TFn; tz: string }>({ lang: "en", t: makeT("en"), tz: "America/New_York" });

export function I18nProvider({ lang, tz, children }: { lang: Lang; tz: string; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang), tz }), [lang, tz]);
  // dictionaries is imported so the client bundle has both languages (a few KB) for instant switching.
  void dictionaries;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
