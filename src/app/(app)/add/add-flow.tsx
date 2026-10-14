"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createItem, parseText, type ParsedForm } from "@/app/actions";
import { ItemForm } from "@/components/item-form";
import { useT } from "@/lib/i18n/client";
import type { Space } from "@/lib/types";

export function AddFlow({ spaces, defaultSpaceId, showSpaces }: { spaces: Space[]; defaultSpaceId: string | null; showSpaces: boolean }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedForm | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function check(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await parseText(text);
      if (r.ok) setParsed(r.parsed);
      else setError(r.error === "setup" ? t("setup.title") : t(r.error));
    });
  }

  if (parsed) {
    const { warnings, ...rest } = parsed;
    return (
      <section className="slide-in flex flex-col gap-4" aria-labelledby="confirm-h">
        <div>
          <h2 id="confirm-h" className="text-xl font-bold">
            {t("add.confirmTitle")}
          </h2>
          <p className="text-sm text-muted">{t("add.confirmSubtitle")}</p>
        </div>
        <ItemForm
          initial={{ ...rest, spaceId: defaultSpaceId }}
          spaces={spaces}
          showSpaces={showSpaces}
          warnings={warnings}
          submitLabel={t("add.save")}
          onSubmit={async (values) => {
            const r = await createItem(values);
            if (r.ok) router.push("/");
            return r;
          }}
          onCancel={() => setParsed(null)}
        />
      </section>
    );
  }

  return (
    <form onSubmit={check} className="flex flex-col gap-4">
      <label htmlFor="quick" className="sr-only">
        {t("add.title.pre")} {t("add.title.accent")}
      </label>
      <textarea
        id="quick"
        className="field min-h-[120px] text-lg"
        placeholder={t("add.placeholder")}
        value={text}
        maxLength={500}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-sm text-muted">{t("add.examples")}</p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending || !text.trim()}>
        {pending ? t("common.loading") : `${t("add.parse")} →`}
      </button>
    </form>
  );
}
