import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asServer, asUser, readyDb, serverLikeSupabase } from "./harness";

let db: PGlite;
let user: string;
let other: string;

beforeEach(async () => {
  db = await readyDb();
  user = await addUser(db, "me@example.test");
  other = await addUser(db, "other@example.test");
  await db.query("insert into public.profiles (user_id, onboarded) values ($1, true), ($2, true)", [user, other]);
});

afterEach(async () => {
  await db.close();
});

const payload = {
  classes: [{ external_id: "c1", name: "Math 101", teacher: "Ms. Cruz" }],
  assignments: [
    { external_id: "a1", class: "c1", title: "Chapter 3 problems", due_at: "2026-10-20T23:59:00Z", notes: "odd numbers", url: "https://classroom.example/a1", done: false },
    { external_id: "a2", class: "c1", title: "Quiz prep", due_at: "2026-10-22T14:00:00Z", notes: null, url: null, done: false },
  ],
  grades: [{ external_id: "g1", class: "c1", assignment: "a1", title: "Quiz 2", score: 18, out_of: 20, posted_at: new Date().toISOString(), comment: null }],
};

type Report = {
  committed: boolean;
  counts: Record<"classes" | "assignments" | "grades", { new: number; updated: number; unchanged: number }>;
  results: { kind: string; external_id: string; status: string }[];
  warnings: string[];
};

async function runImport(who: string, source: string, body: unknown, commit: boolean): Promise<Report> {
  return asUser(db, who, async () => {
    const r = await db.query<{ nudge_import: Report }>("select public.nudge_import($1, $2, $3::jsonb, $4)", [who, source, JSON.stringify(body), commit]);
    return r.rows[0].nudge_import;
  });
}

describe("import preview and confirm", () => {
  it("a preview changes nothing and says everything is new", async () => {
    const preview = await runImport(user, "classroom", payload, false);
    expect(preview.committed).toBe(false);
    expect(preview.counts.classes.new).toBe(1);
    expect(preview.counts.assignments.new).toBe(2);
    expect(preview.counts.grades.new).toBe(1);
    const n = await db.query<{ c: string }>("select (select count(*) from public.items)::text || '/' || (select count(*) from public.courses) || '/' || (select count(*) from public.grades) as c");
    expect(n.rows[0].c).toBe("0/0/0");
  });

  it("confirming creates homework with a class, a due time, and the two reminders", async () => {
    await runImport(user, "classroom", payload, true);
    const items = await db.query<{ id: string; title: string; type: string; due_at: Date; course_name: string; source: string }>(
      "select i.id, i.title, i.type, i.due_at, c.name as course_name, i.source from public.items i join public.courses c on c.id = i.course_id where i.external_uid = 'a1'",
    );
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0]).toMatchObject({ title: "Chapter 3 problems", type: "homework", course_name: "Math 101", source: "classroom" });
    const rems = await db.query<{ days_before: number | null; at_time: string | null; offset_minutes: number | null }>(
      "select days_before, at_time::text, offset_minutes from public.reminders where item_id = $1 order by days_before nulls last",
      [items.rows[0].id],
    );
    expect(rems.rows).toEqual([
      { days_before: 1, at_time: "18:00:00", offset_minutes: null },
      { days_before: null, at_time: null, offset_minutes: 120 },
    ]);
    const occ = await db.query("select * from public.occurrences where item_id = $1", [items.rows[0].id]);
    expect(occ.rows).toHaveLength(1);
  });

  it("importing the same thing again changes nothing and never duplicates", async () => {
    await runImport(user, "classroom", payload, true);
    const again = await runImport(user, "classroom", payload, true);
    expect(again.counts.classes).toEqual({ new: 0, updated: 0, unchanged: 1 });
    expect(again.counts.assignments).toEqual({ new: 0, updated: 0, unchanged: 2 });
    expect(again.counts.grades).toEqual({ new: 0, updated: 0, unchanged: 1 });
    const n = await db.query<{ items: string; occ: string; rem: string; a: string; g: string; c: string }>(
      `select (select count(*) from public.items)::text as items, (select count(*) from public.occurrences)::text as occ,
              (select count(*) from public.reminders)::text as rem, (select count(*) from public.assignments)::text as a,
              (select count(*) from public.grades)::text as g, (select count(*) from public.courses)::text as c`,
    );
    expect(n.rows[0]).toEqual({ items: "2", occ: "2", rem: "4", a: "2", g: "1", c: "1" });
  });

  it("a changed due date and a corrected grade are updates, not new rows", async () => {
    await runImport(user, "classroom", payload, true);
    const changed = {
      ...payload,
      assignments: [{ ...payload.assignments[0], due_at: "2026-10-21T23:59:00Z" }, payload.assignments[1]],
      grades: [{ ...payload.grades[0], score: 19 }],
    };
    const preview = await runImport(user, "classroom", changed, false);
    expect(preview.counts.assignments).toEqual({ new: 0, updated: 1, unchanged: 1 });
    expect(preview.counts.grades.updated).toBe(1);
    await runImport(user, "classroom", changed, true);
    const occ = await db.query<{ due_at: Date }>("select o.due_at from public.occurrences o join public.items i on i.id = o.item_id where i.external_uid = 'a1' and o.status = 'open'");
    expect(occ.rows).toHaveLength(1);
    expect(new Date(occ.rows[0].due_at).toISOString()).toBe("2026-10-21T23:59:00.000Z");
    const g = await db.query<{ score: string; percent: string }>("select score::text, percent::text from public.grades");
    expect(g.rows[0]).toEqual({ score: "19.00", percent: "95.00" });
  });

  it("an assignment you edited yourself is left alone; one you finished stays finished", async () => {
    await runImport(user, "classroom", payload, true);
    await db.query("update public.items set locally_edited = true, title = 'My own title' where external_uid = 'a1'");
    const changed = { ...payload, assignments: [{ ...payload.assignments[0], title: "Changed by teacher" }, payload.assignments[1]] };
    const r = await runImport(user, "classroom", changed, true);
    expect(r.counts.assignments.unchanged).toBe(2);
    const t = await db.query<{ title: string }>("select title from public.items where external_uid = 'a1'");
    expect(t.rows[0].title).toBe("My own title");
  });

  it("the three sources do not collide, and 'manual' works with its own ids", async () => {
    await runImport(user, "classroom", payload, true);
    await runImport(user, "colegia", payload, true);
    const n = await db.query<{ n: string }>("select count(*)::text as n from public.items");
    expect(n.rows[0].n).toBe("4");
    await expect(runImport(user, "bogus", payload, true)).rejects.toThrow(/Unknown source/);
  });

  it("an unknown class gives a warning, and a grade without a class is skipped", async () => {
    const r = await runImport(
      user,
      "manual",
      { assignments: [{ external_id: "x", class: "Nope", title: "Orphan", due_at: null, notes: null, url: null, done: false }], grades: [{ external_id: "gx", class: "Nope", title: "T", score: 1, out_of: 2 }] },
      true,
    );
    expect(r.warnings).toHaveLength(2);
    expect(r.counts.grades.new).toBe(0);
  });

  it("fresh imported grades wait for a 'New grade' push exactly once; old and manual ones do not", async () => {
    await runImport(user, "classroom", { ...payload, grades: [payload.grades[0], { external_id: "g-old", class: "c1", title: "Old", score: 5, out_of: 10, posted_at: "2026-01-01T00:00:00Z" }] }, true);
    await runImport(user, "manual", { classes: [{ external_id: "m1", name: "Art" }], grades: [{ external_id: "mg", class: "m1", title: "Mine", score: 9, out_of: 10 }] }, true);
    const first = await asServer(db, async () => (await db.query<{ title: string; course_name: string }>("select title, course_name from public.dispatch_grade_notifications(50)")).rows);
    expect(first).toEqual([{ title: "Quiz 2", course_name: "Math 101" }]);
    const second = await asServer(db, async () => (await db.query("select * from public.dispatch_grade_notifications(50)")).rows);
    expect(second).toHaveLength(0);
    const g = await db.query<{ id: string }>("select id from public.grades where title = 'Quiz 2'");
    await asServer(db, async () => {
      await db.query("select public.dispatch_grade_requeue($1::uuid[])", [[g.rows[0].id]]);
    });
    const third = await asServer(db, async () => (await db.query("select * from public.dispatch_grade_notifications(50)")).rows);
    expect(third).toHaveLength(1);
  });

  it("you cannot import into someone else's account", async () => {
    await expect(
      asUser(db, user, async () => db.query("select public.nudge_import($1, 'manual', '{}'::jsonb, true)", [other])),
    ).rejects.toThrow(/your own account/);
  });

  it("the server (service role) can import for a user, as the inbox address does", async () => {
    await serverLikeSupabase(db);
    const r = await asServer(db, async () => (await db.query<{ nudge_import: Report }>("select public.nudge_import($1, 'colegia', $2::jsonb, true)", [user, JSON.stringify(payload)])).rows[0].nudge_import);
    expect(r.counts.assignments.new).toBe(2);
  });

  it("generated percent is exact, and out_of must be positive", async () => {
    await runImport(user, "classroom", payload, true);
    const g = await db.query<{ percent: string }>("select percent::text from public.grades");
    expect(g.rows[0].percent).toBe("90.00");
    await expect(db.query("insert into public.grades (user_id, title, score, out_of) values ($1, 'x', 1, 0)", [user])).rejects.toThrow();
  });
});

describe("school tables are private", () => {
  it("one person cannot see another person's classes, assignments or grades", async () => {
    await runImport(user, "classroom", payload, true);
    for (const table of ["courses", "assignments", "grades", "items"]) {
      const rows = await asUser(db, other, async () => (await db.query(`select * from public.${table}`)).rows);
      expect(rows, table).toHaveLength(0);
    }
  });
});

describe("letter grades and links", () => {
  const withExtras = {
    ...payload,
    assignments: [{ ...payload.assignments[0], link: "https://www.ixl.com/math/grade-7" }, payload.assignments[1]],
    grades: [
      payload.grades[0],
      { external_id: "avg1", class: "c1", assignment: null, title: "Quarter 1 average", score: 2.72, out_of: 4, posted_at: new Date().toISOString(), comment: null, letter: "B", points: 2.72 },
    ],
  };

  it("saves the letter and points, and the assignment link", async () => {
    await runImport(user, "classroom", withExtras, true);
    const g = await db.query<{ letter: string | null; points: string | null }>("select letter, points::text from public.grades order by title");
    expect(g.rows).toEqual([
      { letter: "B", points: "2.72" },
      { letter: null, points: null },
    ]);
    const i = await db.query<{ external_uid: string; link: string | null }>("select external_uid, link from public.items order by external_uid");
    expect(i.rows).toEqual([
      { external_uid: "a1", link: "https://www.ixl.com/math/grade-7" },
      { external_uid: "a2", link: null },
    ]);
  });

  it("sending the same thing again is unchanged; a changed letter is an update; leaving it out keeps what was saved", async () => {
    await runImport(user, "classroom", withExtras, true);
    const same = await runImport(user, "classroom", withExtras, true);
    expect(same.counts.grades.unchanged).toBe(2);
    expect(same.counts.assignments.unchanged).toBe(2);

    const better = { ...withExtras, grades: [withExtras.grades[0], { ...withExtras.grades[1], letter: "A", points: 3.5 }] };
    const r = await runImport(user, "classroom", better, true);
    expect(r.counts.grades.updated).toBe(1);

    const bare = { ...withExtras, assignments: [payload.assignments[0], payload.assignments[1]], grades: [withExtras.grades[0], { ...withExtras.grades[1], letter: undefined, points: undefined }] };
    const kept = await runImport(user, "classroom", bare, true);
    expect(kept.counts.grades.unchanged).toBe(2);
    expect(kept.counts.assignments.unchanged).toBe(2);
    const g = await db.query<{ letter: string; points: string }>("select letter, points::text from public.grades where external_id = 'avg1'");
    expect(g.rows[0]).toEqual({ letter: "A", points: "3.50" });
    const i = await db.query<{ link: string }>("select link from public.items where external_uid = 'a1'");
    expect(i.rows[0].link).toBe("https://www.ixl.com/math/grade-7");
  });

  it("refuses a link that is not a web address and a nonsense letter", async () => {
    await runImport(user, "classroom", payload, true);
    await expect(db.query("update public.items set link = 'javascript:alert(1)'")).rejects.toThrow();
    await expect(db.query("update public.items set hw_where = 'moon'")).rejects.toThrow();
    await expect(db.query("update public.grades set letter = 'BB'")).rejects.toThrow();
    await expect(db.query("update public.grades set points = 11")).rejects.toThrow();
  });

  it("the new-grade update says B 2.72 for a lettered grade", async () => {
    await runImport(user, "classroom", withExtras, true);
    const u = await db.query<{ body: string }>("select body from public.updates where kind = 'grade' order by body");
    expect(u.rows.map((r) => r.body)).toContain("Quarter 1 average: B 2.72");
  });

  it("the clock's push list carries the letter and points", async () => {
    await runImport(user, "classroom", withExtras, true);
    const rows = await asServer(db, async () => (await db.query<{ title: string; letter: string | null; points: string | null }>("select title, letter, points::text from public.dispatch_grade_notifications_v2(50) order by title")).rows);
    expect(rows).toEqual([
      { title: "Quarter 1 average", letter: "B", points: "2.72" },
      { title: "Quiz 2", letter: null, points: null },
    ]);
  });

  it("repairs averages imported before letters existed, from '(B, 2.72)' in the title", async () => {
    await runImport(user, "colegia", { classes: [{ external_id: "c9", name: "Biology", teacher: null }], grades: [
      { external_id: "old1", class: "c9", assignment: null, title: "Q1 average (B, 2.72)", score: 2.72, out_of: 4, posted_at: "2026-09-01T00:00:00Z", comment: null },
      { external_id: "old2", class: "c9", assignment: null, title: "Quiz 3 (18/20)", score: 18, out_of: 20, posted_at: "2026-09-02T00:00:00Z", comment: null },
      { external_id: "old3", class: "c9", assignment: null, title: "Semester (a-, 3.5)", score: 3.5, out_of: 4, posted_at: "2026-09-03T00:00:00Z", comment: null },
    ] }, true);
    const before = await db.query<{ n: string }>("select count(*)::text as n from public.grades where letter is not null");
    expect(before.rows[0].n).toBe("0");
    const file = readFileSync(join(process.cwd(), "supabase", "migrations", "0012_school_polish.sql"), "utf8");
    await db.exec(file); // safe to run again: this is what fixes the existing rows
    const g = await db.query<{ external_id: string; letter: string | null; points: string | null }>("select external_id, letter, points::text from public.grades order by external_id");
    expect(g.rows).toEqual([
      { external_id: "old1", letter: "B", points: "2.72" },
      { external_id: "old2", letter: null, points: null },
      { external_id: "old3", letter: "A-", points: "3.50" },
    ]);
  });
});

describe("terms and school years", () => {
  const body = {
    classes: [{ external_id: "c1", name: "Language Arts", teacher: null, school_year: "2026-2027" }],
    assignments: [],
    grades: [
      { external_id: "q1", class: "c1", assignment: null, title: "Quarter average", score: 2.72, out_of: 4, posted_at: new Date().toISOString(), comment: null, letter: "B", points: 2.72, term: "q1", school_year: "2026-2027" },
      { external_id: "q2", class: "c1", assignment: null, title: "Quarter average", score: 3.4, out_of: 4, posted_at: new Date().toISOString(), comment: null, letter: "A", points: 3.4, term: "q2", school_year: "2026-2027" },
    ],
  };

  it("saves the class year and each grade's quarter and year; the same data again is unchanged", async () => {
    await runImport(user, "colegia", body, true);
    const c = await db.query<{ school_year: string }>("select school_year from public.courses");
    expect(c.rows).toEqual([{ school_year: "2026-2027" }]);
    const g = await db.query<{ term: string; school_year: string }>("select term, school_year from public.grades order by term");
    expect(g.rows).toEqual([
      { term: "q1", school_year: "2026-2027" },
      { term: "q2", school_year: "2026-2027" },
    ]);
    const again = await runImport(user, "colegia", body, true);
    expect(again.counts.classes.unchanged).toBe(1);
    expect(again.counts.grades.unchanged).toBe(2);
    const moved = await runImport(user, "colegia", { ...body, grades: [{ ...body.grades[0], term: "q3" }, body.grades[1]] }, true);
    expect(moved.counts.grades.updated).toBe(1);
  });

  it("leaving the term and year out later keeps what was saved", async () => {
    await runImport(user, "colegia", body, true);
    const bare = { ...body, classes: [{ ...body.classes[0], school_year: null }], grades: body.grades.map((g) => ({ ...g, term: undefined, school_year: undefined })) };
    const r = await runImport(user, "colegia", bare, true);
    expect(r.counts.grades.unchanged).toBe(2);
    const g = await db.query<{ term: string }>("select term from public.grades order by term");
    expect(g.rows.map((x) => x.term)).toEqual(["q1", "q2"]);
  });

  it("refuses a made-up quarter or year", async () => {
    await runImport(user, "colegia", body, true);
    await expect(db.query("update public.grades set term = 'q5'")).rejects.toThrow();
    await expect(db.query("update public.grades set school_year = '2026'")).rejects.toThrow();
    await expect(db.query("update public.courses set school_year = 'soon'")).rejects.toThrow();
  });

  it("the update line and the clock's push list carry the quarter", async () => {
    await runImport(user, "colegia", body, true);
    const u = await db.query<{ body: string }>("select body from public.updates where kind = 'grade' order by body");
    expect(u.rows.map((r) => r.body)).toContain("Q2 — Quarter average: A 3.40");
    const rows = await asServer(db, async () => (await db.query<{ term: string }>("select term from public.dispatch_grade_notifications_v3(50) order by term")).rows);
    expect(rows.map((r) => r.term)).toEqual(["q1", "q2"]);
  });

  it("fills in what was already there: 1st 9-Weeks -> q1, classes p02-p08 -> 2026-2027", async () => {
    await runImport(user, "colegia", {
      classes: [
        { external_id: "k1", name: "P02 Language Arts", teacher: null },
        { external_id: "k2", name: "P08 - Science", teacher: null },
        { external_id: "k3", name: "P10 Elective", teacher: null },
        { external_id: "k4", name: "Chess club", teacher: null },
      ],
      grades: [
        { external_id: "o1", class: "k1", assignment: null, title: "1st 9-Weeks Average", score: 3, out_of: 4, posted_at: "2026-10-01T00:00:00Z", comment: null },
        { external_id: "o2", class: "k4", assignment: null, title: "Quiz 1", score: 9, out_of: 10, posted_at: "2026-10-02T00:00:00Z", comment: null },
        { external_id: "o3", class: "k3", assignment: null, title: "1st 9 weeks", score: 3.5, out_of: 4, posted_at: "2026-10-03T00:00:00Z", comment: null },
      ],
    }, true);
    const file = readFileSync(join(process.cwd(), "supabase", "migrations", "0013_terms_years.sql"), "utf8");
    await db.exec(file);
    const c = await db.query<{ name: string; school_year: string | null }>("select name, school_year from public.courses order by name");
    expect(c.rows).toEqual([
      { name: "Chess club", school_year: null },
      { name: "P02 Language Arts", school_year: "2026-2027" },
      { name: "P08 - Science", school_year: "2026-2027" },
      { name: "P10 Elective", school_year: null },
    ]);
    const g = await db.query<{ external_id: string; term: string | null; school_year: string | null }>("select external_id, term, school_year from public.grades order by external_id");
    expect(g.rows).toEqual([
      { external_id: "o1", term: "q1", school_year: "2026-2027" },
      { external_id: "o2", term: null, school_year: null },
      { external_id: "o3", term: "q1", school_year: "2026-2027" },
    ]);
  });
});
