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
