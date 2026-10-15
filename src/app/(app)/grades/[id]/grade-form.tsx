"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addGrade, deleteGrade } from "@/app/actions-p3";
import { useT } from "@/lib/i18n/client";

export function GradeForm({ courseId }: { courseId: string }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [outOf, setOutOf] = useState("100");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <form
      className="card flex flex-col gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const s = parseFloat(score);
        const o = parseFloat(outOf);
        if (Number.isNaN(s) || Number.isNaN(o) || o <= 0 || s < 0) return setError(t("grades.error.invalid"));
        start(async () => {
          const r = await addGrade({ courseId, title, score: s, outOf: o });
          if (r.ok) {
            setTitle("");
            setScore("");
            router.refresh();
          } else setError(r.error === "setup" ? t("setup.title") : t(r.error));
        });
      }}
    >
      <h2 className="text-lg font-bold">{t("grades.add")}</h2>
      <div>
        <label htmlFor="g-title" className="mb-1 block text-sm font-semibold text-muted">
          {t("grades.field.title")}
        </label>
        <input id="g-title" className="field" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="g-score" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.score")}
          </label>
          <input id="g-score" className="field" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="g-out" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.outOf")}
          </label>
          <input id="g-out" className="field" inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value)} required />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("common.loading") : t("grades.add.button")}
      </button>
    </form>
  );
}

export function GradeRowActions({ id, title }: { id: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-quiet"
      disabled={pending}
      aria-label={`${t("action.delete")}: ${title}`}
      onClick={() =>
        start(async () => {
          await deleteGrade(id);
          router.refresh();
        })
      }
    >
      ✕
    </button>
  );
}
