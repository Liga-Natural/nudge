"use client";

import { useState, useTransition } from "react";
import { confirmImport, previewImport } from "@/app/actions-p3";
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n";
import type { ImportReport, ImportStatus } from "@/lib/import-run";

const EXAMPLE = JSON.stringify(
  {
    source: "classroom",
    classes: [{ external_id: "math-101", name: "Math 101", teacher: "Ms. Cruz" }],
    assignments: [{ external_id: "hw-3", class: "math-101", title: "Chapter 3 problems", due: "2026-10-22T23:59:00-04:00", notes: "Odd numbers only", link: "https://classroom.google.com/c/abc/a/def" }],
    grades: [{ external_id: "quiz-2", class: "math-101", assignment: "hw-3", title: "Quiz 2", score: 18, out_of: 20, posted: "2026-10-14" },
      { external_id: "avg-q1", class: "math-101", title: "Quarter 1 average", score: 2.72, out_of: 4, letter: "B", points: 2.72, posted: "2026-10-14" },
    ],
  },
  null,
  2,
);

const CHIP: Record<ImportStatus, string> = {
  new: "bg-ok-bg",
  updated: "bg-warn-bg",
  unchanged: "bg-neutral-bg",
};

/** Paste JSON, see what would change, confirm. A browser agent can use this page too: no token needed. */
export function ImportClient() {
  const t = useT();
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [previewOf, setPreviewOf] = useState("");
  const [pending, start] = useTransition();

  function preview() {
    setProblems([]);
    setReport(null);
    start(async () => {
      const r = await previewImport(text);
      if (r.ok) {
        setReport(r.report);
        setPreviewOf(text);
      } else setProblems(r.problems);
    });
  }

  function confirm() {
    setProblems([]);
    start(async () => {
      const r = await confirmImport(previewOf);
      if (r.ok) setReport(r.report);
      else setProblems(r.problems);
    });
  }

  const changes = report ? report.results.filter((r) => r.status !== "unchanged").length : 0;
  // If the pasted text changed after the preview, the preview no longer describes it.
  const stale = !!report && !report.committed && previewOf !== text;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="import-json" className="mb-1 block text-sm font-semibold text-muted">
          {t("import.paste")}
        </label>
        <textarea
          id="import-json"
          className="field min-h-[200px] font-mono text-sm"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="btn-quiet mt-2" onClick={() => setText(EXAMPLE)}>
          {t("import.example")}
        </button>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="rounded-2xl bg-late-bg p-4 text-late-ink">
          <p className="font-semibold">{t("import.problems")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {report && (
        <section aria-labelledby="imp-h" className="card flex flex-col gap-3 p-5">
          <h2 id="imp-h" className="text-lg font-bold">
            {report.committed ? t("import.done") : t("import.preview.title")}
          </h2>
          <ul className="grid grid-cols-3 gap-2 text-center text-sm">
            {(["new", "updated", "unchanged"] as const).map((s) => (
              <li key={s} className={`rounded-2xl p-2 ${CHIP[s]}`}>
                <span className="block text-2xl font-extrabold">{(["classes", "assignments", "grades"] as const).reduce((n, k) => n + report.counts[k][s], 0)}</span>
                {t(`import.${s}` as Key)}
              </li>
            ))}
          </ul>
          {report.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-late-ink">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <ul className="flex flex-col gap-1.5">
            {report.results.slice(0, 80).map((r) => (
              <li key={`${r.kind}-${r.external_id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-muted">{t(`import.kind.${r.kind}` as Key)}: </span>
                  {r.title}
                </span>
                <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[r.status]}`}>{t(`import.${r.status}` as Key)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && !report.committed && !stale && (
        <button type="button" className="btn-primary" disabled={pending || changes === 0} onClick={confirm}>
          {changes === 0 ? t("import.nothingToDo") : `${t("import.confirm")} (${changes})`}
        </button>
      )}
      {(!report || report.committed || stale) && (
        <button type="button" className="btn-primary" disabled={pending || !text.trim()} onClick={preview}>
          {pending ? t("common.loading") : `${t("import.preview")} →`}
        </button>
      )}
    </div>
  );
}
