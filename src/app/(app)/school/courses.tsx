"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCourse, deleteCourse } from "@/app/actions";
import { setCourseLook } from "@/app/actions-p6";
import { CourseBadge } from "@/components/course-badge";
import { Sheet } from "@/components/sheet";
import { COURSE_COLORS, COURSE_EMOJIS } from "@/lib/course-look";
import { useT } from "@/lib/i18n/client";
import type { Course } from "@/lib/types";

type Looked = Course & { emoji: string };

export function Courses({ courses }: { courses: Looked[] }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Looked | null>(null);
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState("");
  const [pending, start] = useTransition();

  function edit(c: Looked) {
    setEditing(c);
    setEmoji(c.emoji);
    setColor(c.color);
  }

  return (
    <section aria-labelledby="co-h" className="card flex flex-col gap-3 p-5">
      <h2 id="co-h" className="text-lg font-bold">
        {t("school.courses")}
      </h2>
      {courses.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <li key={c.id} className="flex items-center rounded-full border border-line" style={{ background: c.color, color: "#1c1917" }}>
              <button className="flex min-h-[44px] items-center gap-1.5 rounded-full pl-3 font-semibold" aria-label={`${t("school.editCourse")}: ${c.name}`} onClick={() => edit(c)}>
                <span aria-hidden>{c.emoji}</span>
                {c.name}
              </button>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full"
                aria-label={`${t("school.deleteCourse")}: ${c.name}`}
                onClick={() => start(async () => { await deleteCourse(c.id); router.refresh(); })}
              >
                <span aria-hidden>✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (!name.trim()) return;
          start(async () => {
            const r = await createCourse(name);
            if (r.ok) {
              setName("");
              router.refresh();
            } else setError(t("common.error"));
          });
        }}
      >
        <label htmlFor="course-name" className="sr-only">
          {t("school.courseName")}
        </label>
        <input id="course-name" className="field" placeholder={t("school.courseName")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button className="btn-quiet flex-none" type="submit" disabled={pending}>
          {t("school.addCourse")}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-semibold text-late-ink">
          {error}
        </p>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ""}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <CourseBadge emoji={emoji || "🎓"} color={color || "#e4edff"} size={52} />
            <p className="min-w-0 flex-1 truncate text-lg font-bold">{editing?.name}</p>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-muted">{t("school.emoji")}</legend>
            <div className="flex flex-wrap gap-2">
              {COURSE_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={emoji === e}
                  aria-label={e}
                  onClick={() => setEmoji(e)}
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl border-2 text-xl ${emoji === e ? "border-accent bg-accent-soft" : "border-line bg-card"}`}
                >
                  <span aria-hidden>{e}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-muted">{t("school.color")}</legend>
            <div className="flex flex-wrap gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color.toLowerCase() === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`h-11 w-11 rounded-full border-2 ${color.toLowerCase() === c ? "border-accent" : "border-line"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !emoji || !color}
            onClick={() =>
              editing &&
              start(async () => {
                const r = await setCourseLook({ id: editing.id, emoji, color });
                if (r.ok) {
                  setEditing(null);
                  router.refresh();
                } else setError(t("common.error"));
              })
            }
          >
            {t("action.save")}
          </button>
        </div>
      </Sheet>
    </section>
  );
}
