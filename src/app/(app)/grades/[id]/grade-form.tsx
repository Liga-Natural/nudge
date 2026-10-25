"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addGrade, deleteGrade } from "@/app/actions-p3";
import { TERMS, TERM_LABEL } from "@/lib/grades";
import { useT } from "@/lib/i18n/client";

export function GradeForm({ courseId }: { courseId: string }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [outOf, setOutOf] = useState("100");
  const [term, setTerm] = useState("");
  const [letter, setLetter] = useState("");
  const [points, setPoints] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <form
      className="card flex flex-col gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const L = letter.trim();
        // A letter average ("B 2.72") stands on its own: the points are on a 4.0 scale, not a score out of 100.
        const pts = points.trim() ? parseFloat(points) : null;
        const s = L ? (pts ?? 0) : parseFloat(score);
        const o = L ? 4 : parseFloat(outOf);
        const badLetter = L && (!/^[A-Za-z][+-]?$/.test(L) || (pts !== null && (Number.isNaN(pts) || pts > 10)));
        if (Number.isNaN(s) || Number.isNaN(o) || o <= 0 || s < 0 || badLetter) return setError(t("grades.error.invalid"));
        start(async () => {
          const r = await addGrade({ courseId, title, score: s, outOf: o, letter: L || null, points: L ? pts : null, term: term || null });
          if (r.ok) {
            setTitle("");
            setScore("");
            setLetter("");
            setPoints("");
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
      <div>
        <label htmlFor="g-term" className="mb-1 block text-sm font-semibold text-muted">
          {t("grades.field.term")} <span className="font-normal">({t("common.optional")})</span>
        </label>
        <select id="g-term" className="field" value={term} onChange={(e) => setTerm(e.target.value)}>
          <option value="">{t("grades.term.none")}</option>
          {TERMS.map((k) => (
            <option key={k} value={k}>
              {TERM_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="g-score" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.score")}
          </label>
          <input id="g-score" className="field" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} required={!letter.trim()} />
        </div>
        <div>
          <label htmlFor="g-out" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.outOf")}
          </label>
          <input id="g-out" className="field" inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value)} required={!letter.trim()} />
        </div>
      </div>
      <p className="-mb-1 text-sm text-muted">{t("grades.letter.hint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="g-letter" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.letter")}
          </label>
          <input id="g-letter" className="field" value={letter} maxLength={2} autoCapitalize="characters" onChange={(e) => setLetter(e.target.value)} />
        </div>
        <div>
          <label htmlFor="g-points" className="mb-1 block text-sm font-semibold text-muted">
            {t("grades.field.points")}
          </label>
          <input id="g-points" className="field" inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} />
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
