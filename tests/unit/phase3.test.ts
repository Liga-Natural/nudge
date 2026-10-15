import { describe, expect, it } from "vitest";
import { parseBillsFeed } from "@/lib/bills-feed";
import { classAverage, letterFor, percentOf } from "@/lib/grades";
import { parseInboxText, toDatabasePayload } from "@/lib/inbox-schema";
import { tonightAt } from "@/lib/occurrences";
import { matchCourse, parseQuickAdd } from "@/lib/parser";
import { defaultReminders } from "@/lib/reminders";
import { computeStreak, type HabitDay } from "@/lib/streak";
import { instantToWall, wallToInstant } from "@/lib/time";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, h = 9, mi = 0) => wallToInstant({ y, m, d, h, mi }, NY);
// Wednesday, Oct 14, 2026, 4:30 PM in New York
const NOW = at(2026, 10, 14, 16, 30);
const parse = (text: string, courses?: string[]) => parseQuickAdd(text, { now: NOW, tz: NY, lang: "auto", courses });
const wall = (d: Date | null) => (d ? instantToWall(d, NY) : null);

describe("smart quick-add", () => {
  it("math hw friday 8pm becomes homework, due Friday at 8 PM", () => {
    const r = parse("math hw friday 8pm");
    expect(r.type).toBe("homework");
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 16, h: 20, mi: 0 });
    expect(r.allDay).toBe(false);
    expect(r.title).toBe("Math hw");
  });

  it("names the class when the words match one of yours", () => {
    expect(parse("math hw friday 8pm", ["Math 101", "English"]).courseName).toBe("Math 101");
    expect(parse("english essay friday", ["Math 101", "English"]).courseName).toBe("English");
    // two classes could fit: do not guess
    expect(parse("math hw friday", ["Math 101", "Math 202"]).courseName).toBeNull();
    expect(matchCourse("nothing here", ["Math 101"])).toBeNull();
  });

  it("pay phone bill every 15th is a payment that repeats monthly on the 15th", () => {
    const r = parse("pay phone bill every 15th");
    expect(r.type).toBe("payment");
    expect(r.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(r.title).toBe("Pay phone bill");
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 15 });
  });

  it("understands other ways to say the same repeat", () => {
    expect(parse("netflix on the 3rd of every month $15.99").rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=3");
    expect(parse("rent monthly on the 1st").rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(parse("rent every month on the 1st").rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    // "every 2nd week" is a week repeat, not the 2nd of the month
    expect(parse("trash every 2nd week").rrule).not.toBe("FREQ=MONTHLY;BYMONTHDAY=2");
  });

  it("mom's birthday oct 20 is a yearly birthday", () => {
    const r = parse("mom's birthday oct 20");
    expect(r.type).toBe("birthday");
    expect(r.rrule).toBe("FREQ=YEARLY");
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 20 });
  });

  it("a birthday GIFT is still just a task", () => {
    expect(parse("buy a birthday gift").type).toBe("task");
  });

  it("gym every mon wed fri is a habit; an explicit habit word works without a repeat", () => {
    const g = parse("gym every monday wednesday friday");
    expect(g.type).toBe("habit");
    expect(g.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(parse("read 20 pages daily").type).toBe("habit");
    expect(parse("morning routine").type).toBe("habit");
  });

  it("Liga Natural work: game day, registrations, sponsor follow-up, posting", () => {
    const game = parse("game day saturday 9am");
    expect(game.type).toBe("work");
    expect(game.subtype).toBe("game_day");
    expect(parse("sponsor follow-up with Nike friday").subtype).toBe("sponsor");
    expect(parse("player registrations close sunday").subtype).toBe("registration");
    expect(parse("post on instagram thursday 6pm").subtype).toBe("posting");
  });

  it("car registration is a renewal, not Liga work", () => {
    expect(parse("car registration expires march 5").type).toBe("renewal");
  });

  it("an appointment can carry a place after @", () => {
    const r = parse("dentist friday 3pm @ Dr Lopez office");
    expect(r.type).toBe("event");
    expect(r.location).toBe("Dr Lopez office");
    expect(r.title).toBe("Dentist");
  });

  it("the old examples still work", () => {
    const r = parse("pay phone bill friday 5pm $45");
    expect(r.type).toBe("payment");
    expect(r.amountCents).toBe(4500);
  });
});

describe("default reminders for the new kinds", () => {
  it("birthdays: 3 days before and the day of", () => {
    expect(defaultReminders("birthday", true)).toEqual([
      { daysBefore: 3, atTime: "09:00" },
      { daysBefore: 0, atTime: "09:00" },
    ]);
  });
  it("game days: the evening before and 2 hours before", () => {
    expect(defaultReminders("work", false, "on_time", "game_day")).toEqual([{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 120 }]);
  });
  it("habits remind at the time, or at 9 AM for an all-day habit", () => {
    expect(defaultReminders("habit", false)).toEqual([{ offsetMinutes: 0 }]);
    expect(defaultReminders("habit", true)).toEqual([{ daysBefore: 0, atTime: "09:00" }]);
  });
});

describe("habit streaks", () => {
  const day = (d: number, status: HabitDay["status"]): HabitDay => ({ dueAt: at(2026, 10, d, 9).toISOString(), status });
  const today = at(2026, 10, 14, 12);

  it("counts consecutive done days", () => {
    const s = computeStreak([day(11, "done"), day(12, "done"), day(13, "done"), day(14, "open")], today, NY);
    expect(s).toMatchObject({ current: 3, best: 3, doneToday: false });
  });

  it("today being done adds one", () => {
    expect(computeStreak([day(12, "done"), day(13, "done"), day(14, "done")], today, NY)).toMatchObject({ current: 3, doneToday: true });
  });

  it("skip today does NOT break the streak and does not add to it", () => {
    const s = computeStreak([day(11, "done"), day(12, "done"), day(13, "done"), day(14, "skipped")], today, NY);
    expect(s).toMatchObject({ current: 3, best: 3, skippedToday: true });
  });

  it("a skipped day in the middle keeps the streak going", () => {
    expect(computeStreak([day(10, "done"), day(11, "skipped"), day(12, "done"), day(13, "done")], today, NY)).toMatchObject({ current: 3, best: 3 });
  });

  it("a missed day (still open after it passed) breaks it, and best remembers the old run", () => {
    const s = computeStreak([day(8, "done"), day(9, "done"), day(10, "done"), day(11, "open"), day(12, "done"), day(13, "done")], today, NY);
    expect(s).toMatchObject({ current: 2, best: 3 });
  });

  it("today still open never breaks anything, and the future is ignored", () => {
    expect(computeStreak([day(13, "done"), day(14, "open"), day(15, "open")], today, NY).current).toBe(1);
  });

  it("no days at all is a zero streak", () => {
    expect(computeStreak([], today, NY)).toEqual({ current: 0, best: 0, doneToday: false, skippedToday: false });
  });
});

describe("grades", () => {
  it("the class average is points earned over points possible", () => {
    // 5/5 and 45/100 -> 50/105, not the average of 100% and 45%
    expect(classAverage([{ score: 5, out_of: 5 }, { score: 45, out_of: 100 }])).toBe(47.6);
    expect(classAverage([{ score: 18, out_of: 20 }])).toBe(90);
  });
  it("no grades means no average, never a fake 0%", () => {
    expect(classAverage([])).toBeNull();
    expect(percentOf(1, 0)).toBeNull();
  });
  it("letters follow the usual cut-offs", () => {
    expect([95, 90, 89.9, 80, 70, 60, 59.9].map(letterFor)).toEqual(["A", "A", "B", "B", "C", "D", "F"]);
  });
});

describe("the import format", () => {
  const good = {
    source: "classroom",
    classes: [{ external_id: "c1", name: "Math 101" }],
    assignments: [{ external_id: "a1", class: "c1", title: "Chapter 3", due: "2026-10-20" }],
    grades: [{ external_id: "g1", class: "c1", title: "Quiz", score: 18, out_of: 20 }],
  };
  it("accepts a good payload", () => {
    expect(parseInboxText(JSON.stringify(good)).ok).toBe(true);
  });
  it("says where JSON is broken, and what is empty", () => {
    const broken = parseInboxText("{ nope");
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.problems[0]).toMatch(/not valid JSON/);
    expect(!parseInboxText("   ").ok).toBe(true);
    expect(parseInboxText("[]")).toMatchObject({ ok: false });
  });
  it("names each wrong field", () => {
    const r = parseInboxText(JSON.stringify({ source: "classroom", assignments: [{ external_id: "", title: "", due: "next friday" }], extra: 1 }));
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.problems.join("\n") : "";
    expect(text).toMatch(/assignments\[1\]\.external_id: must not be empty/);
    expect(text).toMatch(/assignments\[1\]\.due: must be a date like "2026-10-20"/);
    expect(text).toMatch(/unknown field "extra"/);
  });
  it("a date with no time is the END of that day in the person's zone; a zone is respected", () => {
    const r = parseInboxText(
      JSON.stringify({ source: "manual", assignments: [{ external_id: "a", title: "A", due: "2026-10-20" }, { external_id: "b", title: "B", due: "2026-10-20T08:00:00-04:00" }, { external_id: "c", title: "C", due: "2026-10-20T08:00" }] }),
    );
    if (!r.ok) throw new Error("should parse");
    const db = toDatabasePayload(r.payload, NY);
    expect(db.assignments.map((a) => a.due_at)).toEqual(["2026-10-21T03:59:00.000Z", "2026-10-20T12:00:00.000Z", "2026-10-20T12:00:00.000Z"]);
  });
});

describe("Joker bills feed format", () => {
  const ok = { version: 1, bills: [{ id: "b1", name: "Phone", amount_cents: 4500, due_date: "2026-10-20" }] };
  it("accepts the documented shape (or a bare list)", () => {
    expect(parseBillsFeed(JSON.stringify(ok))).toMatchObject({ ok: true });
    expect(parseBillsFeed(JSON.stringify(ok.bills))).toMatchObject({ ok: true });
  });
  it("explains what is wrong", () => {
    expect(parseBillsFeed("<html>")).toMatchObject({ ok: false, message: expect.stringMatching(/did not return JSON/) });
    const noDate = parseBillsFeed(JSON.stringify({ bills: [{ id: "x", name: "Y" }] }));
    expect(noDate.ok).toBe(false);
    expect(!noDate.ok && noDate.message).toMatch(/bills\[1\]\.due_date/);
    const dupe = parseBillsFeed(JSON.stringify({ bills: [ok.bills[0], ok.bills[0]] }));
    expect(!dupe.ok && dupe.message).toMatch(/twice/);
    const cents = parseBillsFeed(JSON.stringify({ bills: [{ ...ok.bills[0], amount_cents: 45.5 }] }));
    expect(!cents.ok && cents.message).toMatch(/whole number of cents/);
  });
});

describe("snooze: tonight", () => {
  it("is 8 PM today, but not offered late in the evening", () => {
    expect(wall(tonightAt(at(2026, 10, 14, 16, 30), NY))).toMatchObject({ d: 14, h: 20, mi: 0 });
    expect(tonightAt(at(2026, 10, 14, 19, 0), NY)).toBeNull();
    expect(tonightAt(at(2026, 10, 14, 23, 3), NY)).toBeNull();
  });
});
