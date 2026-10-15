"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCourse, deleteCourse } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { Course } from "@/lib/types";

export function Courses({ courses }: { courses: Course[] }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="co-h" className="card flex flex-col gap-3 p-5">
      <h2 id="co-h" className="text-lg font-bold">
        {t("school.courses")}
      </h2>
      {courses.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <li key={c.id} className="flex items-center rounded-full border border-line pl-3" style={{ background: c.color }}>
              <span className="font-semibold">{c.name}</span>
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
    </section>
  );
}
