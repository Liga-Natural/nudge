"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type LoginState } from "./actions";

const inputClass =
  "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg shadow-sm outline-none focus:border-orange-500";
const buttonClass =
  "w-full min-h-[54px] rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 text-lg font-semibold text-white disabled:opacity-50";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    async (prev, formData) =>
      prev.step === "email"
        ? requestCode(prev, formData)
        : verifyCode(prev, formData),
    { step: "email" },
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.step === "email" ? (
        <>
          <label htmlFor="email" className="text-sm text-neutral-600">
            Your email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
          />
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            We sent a code to {state.email}. Type the numbers here.
          </p>
          <label htmlFor="code" className="text-sm text-neutral-600">
            Code from your email
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={inputClass}
          />
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "One moment…" : state.step === "email" ? "Send me a code" : "Sign in"}
      </button>
    </form>
  );
}
