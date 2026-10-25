import { z } from "zod";
import { TERMS } from "./grades";
import { wallToInstant } from "./time";

// The one JSON format for bringing school work in: pasted on the Import page, or POSTed to
// /api/inbox. Documented in docs/INBOX_API.md.

export const SOURCES = ["classroom", "colegia", "manual"] as const;
export type Source = (typeof SOURCES)[number];

const id = z.string().trim().min(1, "must not be empty").max(120, "is too long (120 characters at most)");
const when = z
  .string()
  .trim()
  .max(40)
  .refine((v) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) && !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)), {
    message: 'must be a date like "2026-10-20" or a date and time like "2026-10-20T23:59:00-04:00"',
  });

const httpLink = z
  .string()
  .trim()
  .max(500, "is too long (500 characters at most)")
  .refine((v) => /^https?:\/\/\S+$/i.test(v), { message: "must be a web address starting with http:// or https://" });

const schoolYear = z.string().trim().regex(/^\d{4}-\d{4}$/, 'must look like "2026-2027"');

const classSchema = z.object({
  external_id: id,
  name: z.string().trim().min(1, "must not be empty").max(60, "is too long (60 characters at most)"),
  teacher: z.string().trim().max(80).nullish(),
  /** The school year this class belongs to, like "2026-2027". Past years are kept read-only. */
  school_year: schoolYear.nullish(),
});

const assignmentSchema = z.object({
  external_id: id,
  class: z.string().trim().max(120).nullish(),
  title: z.string().trim().min(1, "must not be empty").max(200, "is too long (200 characters at most)"),
  due: when.nullish(),
  notes: z.string().max(3000).nullish(),
  url: z.string().trim().max(500).nullish(),
  /** The assignment page itself (shows as an Open button on the reminder). */
  link: httpLink.nullish(),
  done: z.boolean().optional(),
});

const gradeSchema = z.object({
  external_id: id,
  class: z.string().trim().min(1, "is required: the class this grade belongs to").max(120),
  assignment: z.string().trim().max(120).nullish(),
  title: z.string().trim().min(1, "must not be empty").max(200),
  score: z.number().min(0, "cannot be negative").max(1_000_000),
  out_of: z.number().gt(0, "must be more than 0").max(1_000_000),
  posted: when.nullish(),
  comment: z.string().max(500).nullish(),
  /** A letter grade such as "B" or "A-" (a class average on a 4.0 scale). Shown instead of a percent. */
  letter: z
    .string()
    .trim()
    .regex(/^[A-Za-z][+-]?$/, "must be a letter such as B or A-")
    .nullish(),
  /** Points on a 4.0 scale that go with the letter, such as 2.72. */
  points: z.number().min(0, "cannot be negative").max(10, "is too high (10 at most)").nullish(),
  /** Which part of the year: q1, q2, q3, q4, s1, s2 or final. */
  term: z.enum(TERMS, { message: 'must be one of "q1", "q2", "q3", "q4", "s1", "s2", "final"' }).nullish(),
  school_year: schoolYear.nullish(),
});

export const inboxSchema = z
  .object({
    version: z.literal(1).optional(),
    source: z.enum(SOURCES, { message: 'must be "classroom", "colegia" or "manual"' }),
    classes: z.array(classSchema).max(100, "has too many classes (100 at most)").optional(),
    assignments: z.array(assignmentSchema).max(1000, "has too many assignments (1000 at most)").optional(),
    grades: z.array(gradeSchema).max(2000, "has too many grades (2000 at most)").optional(),
  })
  .strict();

export type InboxPayload = z.infer<typeof inboxSchema>;

/** Plain-words problems, one per line: `grades[2].score: cannot be negative`. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((i) => {
    const path = i.path
      .map((p, n) => (typeof p === "number" ? `[${p + 1}]` : n === 0 ? String(p) : `.${String(p)}`))
      .join("");
    if (i.code === "unrecognized_keys") return `${path || "the top level"}: unknown field ${i.keys.map((k) => `"${k}"`).join(", ")}`;
    return `${path || "the top level"}: ${i.message}`;
  });
}

export type ParseOutcome = { ok: true; payload: InboxPayload } | { ok: false; problems: string[] };

/** Text -> checked payload, with a message that names what is wrong (including where the JSON is broken). */
export function parseInboxText(text: string): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, problems: ["Nothing was pasted. Paste the JSON first."] };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, problems: [`This is not valid JSON: ${e instanceof Error ? e.message : "it could not be read"}`] };
  }
  return parseInboxValue(raw);
}

export function parseInboxValue(raw: unknown): ParseOutcome {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problems: ['The JSON must be an object like {"source": "classroom", "assignments": [...]}.'] };
  }
  const parsed = inboxSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: describeIssues(parsed.error) };
  const p = parsed.data;
  const total = (p.classes?.length ?? 0) + (p.assignments?.length ?? 0) + (p.grades?.length ?? 0);
  if (total === 0) return { ok: false, problems: ["There is nothing to import: add at least one class, assignment or grade."] };
  const dupes = duplicates([...(p.classes ?? []).map((c) => `class:${c.external_id}`), ...(p.assignments ?? []).map((a) => `assignment:${a.external_id}`), ...(p.grades ?? []).map((g) => `grade:${g.external_id}`)]);
  if (dupes.length) return { ok: false, problems: [`The same external_id appears twice: ${dupes.slice(0, 3).join(", ")}. Each one must be unique within its list.`] };
  return { ok: true, payload: p };
}

function duplicates(list: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const x of list) (seen.has(x) ? out : seen).add(x);
  return [...out];
}

/** A date or date-time with no zone is read as the person's own time zone; a bare date means the end of that day. */
export function toInstant(value: string, tz: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value).toISOString();
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time ? time.split(":").map(Number) : [23, 59];
  return wallToInstant({ y, m, d, h, mi }, tz).toISOString();
}

/** The checked payload in the shape the database function wants (all moments as exact instants). */
export function toDatabasePayload(p: InboxPayload, tz: string) {
  return {
    classes: (p.classes ?? []).map((c) => ({ external_id: c.external_id, name: c.name, teacher: c.teacher ?? null, school_year: c.school_year ?? null })),
    assignments: (p.assignments ?? []).map((a) => ({
      external_id: a.external_id,
      class: a.class ?? null,
      title: a.title,
      due_at: a.due ? toInstant(a.due, tz) : null,
      notes: a.notes ?? null,
      url: a.url ?? null,
      link: a.link ?? null,
      done: a.done ?? false,
    })),
    grades: (p.grades ?? []).map((g) => ({
      external_id: g.external_id,
      class: g.class,
      assignment: g.assignment ?? null,
      title: g.title,
      score: g.score,
      out_of: g.out_of,
      posted_at: g.posted ? toInstant(g.posted, tz) : null,
      comment: g.comment ?? null,
      letter: g.letter ? g.letter.toUpperCase() : null,
      points: g.points ?? null,
      term: g.term ?? null,
      school_year: g.school_year ?? null,
    })),
  };
}
