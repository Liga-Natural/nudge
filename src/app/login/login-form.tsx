"use client";

import { useActionState } from "react";
import { makeT, type Lang } from "@/lib/i18n";
import { requestCode, verifyCode, type LoginState } from "./actions";

export function LoginForm({ lang }: { lang: Lang }) {
  const t = makeT(lang);
  const [state, action, pending] = useActionState<LoginState, FormData>(
    async (prev, formData) => (prev.step === "email" ? requestCode(prev, formData) : verifyCode(prev, formData)),
    { step: "email" },
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.step === "email" ? (
        <>
          <label htmlFor="email" className="text-sm font-semibold text-muted">
            {t("login.email")}
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="field" defaultValue={state.email} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted">{t("login.codeSent", { email: state.email ?? "" })}</p>
          <label htmlFor="code" className="text-sm font-semibold text-muted">
            {t("login.code")}
          </label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="field text-xl tracking-widest" />
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {t(state.error)}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? t("common.loading") : state.step === "email" ? t("login.sendCode") : t("login.signIn")}
      </button>
    </form>
  );
}
