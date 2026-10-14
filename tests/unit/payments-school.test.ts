import { describe, expect, it } from "vitest";
import { splitPayments, todayKey } from "@/lib/payments";
import { groupByCourse, isExam, upcomingExams } from "@/lib/school";
import { wallToInstant } from "@/lib/time";
import type { AgendaEntry, Course } from "@/lib/types";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h = 9) => wallToInstant({ y, m, d, h, mi: 0 }, NY);
const NOW = at(2026, 10, 14, 16);

const e = (id: string, due: Date, extra: Partial<AgendaEntry> = {}): AgendaEntry => ({
  occId: id, itemId: id, title: id, type: "payment", dueAt: due.toISOString(), allDay: false, amountCents: 1000,
  currency: "USD", spaceId: null, snoozedUntil: null, recurring: false, priority: 0, courseId: null, autopay: false, ...extra,
});

describe("payment totals", () => {
  it("splits late, next 7 days and the rest of the month, and adds up cents exactly", () => {
    const g = splitPayments(
      [
        e("late", at(2026, 10, 12), { amountCents: 1999 }),
        e("tonight", at(2026, 10, 14, 23), { amountCents: 4500 }),
        e("friday", at(2026, 10, 16), { amountCents: 10 }),
        e("in7", at(2026, 10, 21, 20), { amountCents: 5 }),
        e("end-of-month", at(2026, 10, 30), { amountCents: 90000 }),
        e("next-month", at(2026, 11, 1), { amountCents: 777 }),
        e("homework", at(2026, 10, 15), { type: "homework" }),
      ],
      NOW,
      NY,
    );
    expect(g.late.map((x) => x.occId)).toEqual(["late"]);
    expect(g.week.map((x) => x.occId)).toEqual(["tonight", "friday", "in7"]);
    expect(g.month.map((x) => x.occId)).toEqual(["end-of-month"]);
    expect(g.totals).toEqual({ late: 1999, week: 4515, month: 90000 });
  });

  it("works in December (rolls to the next year)", () => {
    const dec = at(2026, 12, 10);
    const g = splitPayments([e("a", at(2026, 12, 31)), e("b", at(2027, 1, 2))], dec, NY);
    expect(g.month.map((x) => x.occId)).toEqual(["a"]);
  });

  it("payments with no amount count as zero", () => {
    expect(splitPayments([e("a", at(2026, 10, 15), { amountCents: null })], NOW, NY).totals.week).toBe(0);
  });

  it("today's date for the Paid box follows the person's zone", () => {
    expect(todayKey(wallToInstant({ y: 2026, m: 10, d: 14, h: 23, mi: 30 }, NY), NY)).toBe("2026-10-14");
  });
});

describe("school", () => {
  const courses: Course[] = [
    { id: "c1", name: "Math", color: "#e4edff" },
    { id: "c2", name: "Art", color: "#ffefd6" },
  ];
  const hw = (id: string, courseId: string | null, title = id) => e(id, at(2026, 10, 15), { type: "homework", courseId, title });

  it("groups homework by course in saved order, with no-course last", () => {
    const g = groupByCourse([hw("a", "c2"), hw("b", "c1"), hw("c", null), hw("d", "gone"), e("pay", NOW)], courses);
    expect(g.map((x) => [x.course?.name ?? "none", x.entries.map((y) => y.occId)])).toEqual([
      ["Math", ["b"]],
      ["Art", ["a"]],
      ["none", ["c", "d"]],
    ]);
  });

  it("spots exams in English and Spanish", () => {
    for (const t of ["Midterm exam", "Chapter 3 quiz", "Final", "Examen de historia", "Prueba de mate"]) expect(isExam(t), t).toBe(true);
    for (const t of ["Essay draft", "Contest entry", "Attestation"]) expect(isExam(t), t).toBe(false);
    expect(upcomingExams([hw("a", null, "Math quiz"), hw("b", null, "Read ch. 4")]).map((x) => x.occId)).toEqual(["a"]);
  });
});
