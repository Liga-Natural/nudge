import type { AgendaEntry, Course } from "./types";

const EXAM_RE = /\b(exam|exams|quiz|test|midterm|final|examen|examenes|exámenes|prueba|parcial)\b/i;

export const isExam = (title: string) => EXAM_RE.test(title);

export type CourseGroup = { course: Course | null; entries: AgendaEntry[] };

/** Homework grouped by course (courses in their saved order, "no course" last), soonest first. */
export function groupByCourse(entries: AgendaEntry[], courses: Course[]): CourseGroup[] {
  const homework = entries.filter((e) => e.type === "homework");
  const groups: CourseGroup[] = courses
    .map((course) => ({ course, entries: homework.filter((e) => e.courseId === course.id) }))
    .filter((g) => g.entries.length);
  const known = new Set(courses.map((c) => c.id));
  const loose = homework.filter((e) => !e.courseId || !known.has(e.courseId));
  if (loose.length) groups.push({ course: null, entries: loose });
  return groups;
}

export const upcomingExams = (entries: AgendaEntry[]) => entries.filter((e) => e.type === "homework" && isExam(e.title));

export type SchoolSplit = { late: AgendaEntry[]; exams: AgendaEntry[]; groups: CourseGroup[] };

/**
 * The School page's three places. Every homework item lands in exactly one:
 * Late (already past), Upcoming exams (an exam that is still ahead), or Assignments (the rest, by course).
 */
export function splitSchool(entries: AgendaEntry[], courses: Course[], now: Date): SchoolSplit {
  const homework = entries.filter((e) => e.type === "homework");
  const isLate = (e: AgendaEntry) => new Date(e.dueAt) < now;
  const late = homework.filter(isLate).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const ahead = homework.filter((e) => !isLate(e));
  const exams = ahead.filter((e) => isExam(e.title));
  const groups = groupByCourse(ahead.filter((e) => !isExam(e.title)), courses);
  return { late, exams, groups };
}
