import { describe, expect, it } from "vitest";
import {
  againChips,
  buildGrade,
  buildItem,
  canSaveNow,
  dueFromChip,
  emptyDraft,
  firstOccurrence,
  habitRule,
  padPress,
  quietRelease,
  pickChip,
  readScore,
  recentKinds,
  stepReady,
  STEPS,
  type AddKind,
  type Draft,
} from "@/lib/add-flows";
import { autoLook, courseLook, isPlaceholderColor, withLooks } from "@/lib/course-look";
import { CARD_IDS, comingUp, gradesCard, habitCircles, layoutFor, leadingEmoji, moneyCard, moveCard, schoolCard } from "@/lib/dashboard";
import { currentTerm, gradeValue, parseScoreText } from "@/lib/grades";
import { itemInputSchema } from "@/lib/item-input";
import { buildQuickInput, gateType, quickPreview } from "@/lib/quick-add";
import { parseQuickAdd } from "@/lib/parser";
import type { FeatureKey } from "@/lib/features";
import type { AgendaEntry } from "@/lib/types";

const TZ = "America/New_York";
// Saturday 24 Oct 2026, 3:00 PM in New York.
const NOW = new Date("2026-10-24T19:00:00Z");
const allOn = () => true;
const COURSES = [
  { id: "22222222-2222-4222-8222-222222222222", name: "p03 Algebra" },
  { id: "33333333-3333-4333-8333-333333333333", name: "p02 Language Arts" },
];

const entry = (o: Partial<AgendaEntry>): AgendaEntry => ({
  occId: o.occId ?? Math.random().toString(36),
  itemId: o.itemId ?? "i1",
  title: "x",
  type: "task",
  dueAt: "2026-10-25T12:00:00Z",
  allDay: false,
  amountCents: null,
  currency: "USD",
  spaceId: null,
  snoozedUntil: null,
  recurring: false,
  priority: 0,
  courseId: null,
  autopay: false,
  ...o,
});

describe("quick-type preview", () => {
  const preview = (text: string, isOn: (f: FeatureKey) => boolean = allOn) => quickPreview(text, { now: NOW, tz: TZ, courses: COURSES, isOn });

  it("is empty for an empty bar", () => {
    expect(preview("   ")).toBeNull();
  });

  it("reads kind, class and day from 'algebra hw friday 8pm'", () => {
    const p = preview("algebra hw friday 8pm")!;
    expect(p.type).toBe("homework");
    expect(p.courseId).toBe("22222222-2222-4222-8222-222222222222");
    expect(p.dueAt?.toISOString()).toBe("2026-10-31T00:00:00.000Z"); // Fri 30 Oct, 8 PM EDT
    expect(p.allDay).toBe(false);
    expect(p.past).toBe(false);
  });

  it("reads a link at the end", () => {
    const p = preview("ixl lesson monday 8pm https://www.ixl.com/math/algebra")!;
    expect(p.type).toBe("homework");
    expect(p.link).toBe("https://www.ixl.com/math/algebra");
  });

  it("reads money and says payment", () => {
    const p = preview("pay phone bill friday $45")!;
    expect(p.type).toBe("payment");
    expect(p.amountCents).toBe(4500);
  });

  it("falls back to a plain task for a kind that is switched off", () => {
    expect(gateType("habit", (f) => f !== "habits")).toBe("task");
    expect(gateType("birthday", (f) => f !== "birthdays")).toBe("event");
    expect(gateType("homework", () => false)).toBe("homework");
  });

  it("turns what was typed into a complete item (what Enter saves)", () => {
    const p = parseQuickAdd("algebra hw friday 8pm", { now: NOW, tz: TZ, lang: "auto", courses: COURSES.map((c) => c.name) });
    const form = buildQuickInput(p, "algebra hw friday 8pm", { tz: TZ, nudgeStyle: "on_time", courses: COURSES, isOn: allOn });
    const { warnings, ...rest } = form;
    expect(warnings).toEqual([]);
    expect(itemInputSchema.safeParse({ ...rest, spaceId: null }).success).toBe(true);
    expect(form.courseId).toBe("22222222-2222-4222-8222-222222222222");
    expect(form.reminders.length).toBeGreaterThan(0);
  });
});

describe("class emoji and colour defaults", () => {
  it.each([
    ["p05 Italian", "🇮🇹"],
    ["p04 Science", "🧪"],
    ["p02 Language Arts", "📖"],
    ["p03 Algebra", "➗"],
    ["p06 A/V Production", "🎬"],
    ["p07 Career Research", "💼"],
    ["p08 World History", "🌍"],
    ["Basket weaving", "🎓"],
  ])("%s gets %s", (name, emoji) => {
    expect(autoLook(name).emoji).toBe(emoji);
  });

  it("every class gets a real colour, never white", () => {
    for (const n of ["Italian", "Science", "Language Arts", "Algebra", "A/V", "Career", "History", "Something odd"]) {
      const c = autoLook(n).color;
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(isPlaceholderColor(c)).toBe(c === "#e4edff");
    }
  });

  it("replaces a blank or default colour with the subject's, keeps a chosen one", () => {
    expect(courseLook({ id: "a", name: "Italian", color: "#ffffff" }).color).toBe(autoLook("Italian").color);
    expect(courseLook({ id: "a", name: "Italian", color: "#e4edff" }).color).toBe(autoLook("Italian").color);
    expect(courseLook({ id: "a", name: "Italian", color: "#ffe6ec" }).color).toBe("#ffe6ec");
  });

  it("an emoji you chose wins over the subject's", () => {
    expect(courseLook({ id: "a", name: "Italian" }, { a: "🍕" }).emoji).toBe("🍕");
    expect(withLooks([{ id: "b", name: "Science", color: "#dff3f3" }], { a: "🍕" })[0].emoji).toBe("🧪");
  });
});

describe("add flows: dates and the number pad", () => {
  it("date chips mean what they say (Saturday 24 Oct 2026, 3 PM)", () => {
    expect(dueFromChip("tonight", NOW, TZ)).toEqual({ date: "2026-10-24", time: "20:00" });
    expect(dueFromChip("tomorrow", NOW, TZ).date).toBe("2026-10-25");
    expect(dueFromChip("mon", NOW, TZ).date).toBe("2026-10-26");
    expect(dueFromChip("fri", NOW, TZ).date).toBe("2026-10-30");
    expect(dueFromChip("first", NOW, TZ).date).toBe("2026-11-01");
    expect(dueFromChip("fifteenth", NOW, TZ).date).toBe("2026-11-15");
    expect(dueFromChip("m3", NOW, TZ).date).toBe("2027-01-24");
    expect(dueFromChip("y1", NOW, TZ).date).toBe("2027-10-24");
  });

  it("'Mon' on a Monday means next Monday, and month-ends clamp", () => {
    const monday = new Date("2026-10-26T16:00:00Z");
    expect(dueFromChip("mon", monday, TZ).date).toBe("2026-11-02");
    expect(dueFromChip("m1", new Date("2026-01-31T17:00:00Z"), TZ).date).toBe("2026-02-28");
  });

  it("tonight after 8 PM moves to 11 PM", () => {
    expect(dueFromChip("tonight", new Date("2026-10-25T02:00:00Z"), TZ).time).toBe("23:00");
  });

  it("the number pad builds an amount with two decimals at most", () => {
    let a = "";
    for (const k of ["4", "5", ".", "5", "0", "9"]) a = padPress(a, k);
    expect(a).toBe("45.50");
    expect(padPress(a, "back")).toBe("45.5");
    expect(padPress("", ".")).toBe("0.");
    expect(padPress("0", "7")).toBe("7");
    expect(padPress("1234567", "8")).toBe("1234567");
  });

  it("a habit starts today only if its time is still ahead", () => {
    expect(firstOccurrence(NOW, TZ, [6], "20:00")).toBe("2026-10-24");
    expect(firstOccurrence(NOW, TZ, [6], "08:00")).toBe("2026-10-31");
    expect(firstOccurrence(NOW, TZ, [1, 3], "08:00")).toBe("2026-10-26");
    expect(habitRule([0, 1, 2, 3, 4, 5, 6])).toBe("FREQ=DAILY");
    expect(habitRule([])).toBeNull();
    expect(habitRule([5, 1])).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
  });
});

describe("each add flow saves a complete, valid item", () => {
  const ctx = { nudgeStyle: "on_time" as const, spaceId: null, now: NOW, tz: TZ };
  const draft = (kind: AddKind, patch: Partial<Draft>): Draft => ({ ...emptyDraft(kind, NOW, TZ), ...patch });
  const valid = (item: unknown) => itemInputSchema.safeParse(item).success;

  it("Homework: class, title, a Friday chip, both reminders, link and where", () => {
    const d = pickChip(draft("homework", { courseId: "11111111-1111-4111-8111-111111111111", title: "Worksheet 4.2", link: "https://ixl.com/x", where: "online" }), "fri", NOW, TZ);
    const item = buildItem("homework", d, ctx)!;
    expect(valid(item)).toBe(true);
    expect(item).toMatchObject({ type: "homework", dueLocal: "2026-10-30T08:00", allDay: false, link: "https://ixl.com/x", where: "online" });
    expect(item.reminders).toEqual([{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 120 }]);
  });

  it("Homework due tonight only asks for the 2-hour reminder", () => {
    const d = pickChip(draft("homework", { title: "Read ch. 3" }), "tonight", NOW, TZ);
    const item = buildItem("homework", d, ctx)!;
    expect(item.dueLocal).toBe("2026-10-24T20:00");
    expect(item.reminders).toEqual([{ offsetMinutes: 120 }]);
  });

  it("Homework needs a title and a day", () => {
    expect(buildItem("homework", draft("homework", { title: "x" }), ctx)).toBeNull();
    expect(buildItem("homework", draft("homework", { date: "2026-10-30" }), ctx)).toBeNull();
  });

  it("Task with no day is still a valid, dateless task", () => {
    const item = buildItem("task", draft("task", { title: "Buy stamps" }), ctx)!;
    expect(valid(item)).toBe(true);
    expect(item.dueLocal).toBeNull();
    expect(item.reminders).toEqual([]);
  });

  it("Payment: name, $45.50 from the pad, 1st of the month, monthly, autopay", () => {
    let d = pickChip(draft("payment", { title: "Phone bill", autopay: true }), "first", NOW, TZ);
    for (const k of ["4", "5", ".", "5"]) d = { ...d, amount: padPress(d.amount, k) };
    const item = buildItem("payment", d, ctx)!;
    expect(valid(item)).toBe(true);
    expect(item).toMatchObject({ type: "payment", amountCents: 4550, dueLocal: "2026-11-01", allDay: true, rrule: "FREQ=MONTHLY", autopay: true });
    expect(item.reminders).toEqual([{ daysBefore: 3, atTime: "09:00" }, { daysBefore: 0, atTime: "09:00" }]);
  });

  it("Event and Birthday: date, yearly, heads-up", () => {
    const e = buildItem("event", draft("event", { title: "Dentist", date: "2026-11-03", yearly: false, headsUp: 1 }), ctx)!;
    expect(valid(e)).toBe(true);
    expect(e).toMatchObject({ type: "event", rrule: null, allDay: true });
    expect(e.reminders).toEqual([{ daysBefore: 1, atTime: "09:00" }, { daysBefore: 0, atTime: "09:00" }]);
    const timed = buildItem("event", draft("event", { title: "Recital", date: "2026-11-03", allDay: false, time: "18:30", headsUp: 0 }), ctx)!;
    expect(timed).toMatchObject({ dueLocal: "2026-11-03T18:30", allDay: false });
    expect(timed.reminders).toEqual([{ offsetMinutes: 0 }]);
    const b = buildItem("birthday", draft("birthday", { title: "Abuela", date: "2026-12-12" }), ctx)!;
    expect(valid(b)).toBe(true);
    expect(b).toMatchObject({ type: "birthday", rrule: "FREQ=YEARLY" });
    expect(b.reminders[0]).toEqual({ daysBefore: 3, atTime: "09:00" });
  });

  it("Habit: emoji in the name, weekdays, time", () => {
    const item = buildItem("habit", draft("habit", { title: "Read 10 pages", emoji: "📖", days: [1, 2, 3, 4, 5], time: "21:00" }), ctx)!;
    expect(valid(item)).toBe(true);
    expect(item).toMatchObject({ type: "habit", title: "📖 Read 10 pages", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", dueLocal: "2026-10-26T21:00", allDay: false });
    expect(buildItem("habit", draft("habit", { title: "x", days: [] }), ctx)).toBeNull();
  });

  it("Renewal: expiry chip and a month's notice", () => {
    const d = pickChip(draft("renewal", { title: "Passport", remindDays: 30 }), "y1", NOW, TZ);
    const item = buildItem("renewal", d, ctx)!;
    expect(valid(item)).toBe(true);
    expect(item).toMatchObject({ type: "renewal", dueLocal: "2027-10-24", allDay: true });
    expect(item.reminders).toEqual([{ daysBefore: 30, atTime: "09:00" }, { daysBefore: 0, atTime: "09:00" }]);
  });

  it("Grade: 18/20, a percent, and a letter, defaulting to the current quarter", () => {
    const base = draft("grade", { courseId: "c1", gradeType: "test", title: "Unit 3" });
    expect(base.term).toBe("q2");
    expect(buildGrade({ ...base, score: "18", outOf: "20" })).toMatchObject({ title: "Test: Unit 3", score: 18, outOf: 20, letter: null, term: "q2" });
    expect(buildGrade({ ...base, scoreMode: "percent", percent: "92" })).toMatchObject({ score: 92, outOf: 100 });
    expect(buildGrade({ ...base, scoreMode: "letter", letter: "B", sign: "+", term: "q1" })).toMatchObject({ letter: "B+", points: 3.3, outOf: 4, term: "q1" });
    expect(buildGrade({ ...base, score: "" })).toBeNull();
    expect(buildGrade({ ...base, courseId: null, score: "5" })).toBeNull();
    expect(readScore({ ...base, scoreMode: "letter", letter: "F", sign: "+" })?.letter).toBe("F");
  });

  it("every flow has at most 3 steps and a step that is not ready blocks Next", () => {
    for (const n of Object.values(STEPS)) expect(n).toBeLessThanOrEqual(3);
    expect(stepReady("payment", 1, draft("payment", {}))).toBe(false);
    expect(stepReady("payment", 1, draft("payment", { title: "Rent" }))).toBe(true);
    expect(stepReady("payment", 2, draft("payment", { title: "Rent" }))).toBe(false);
    expect(canSaveNow("payment", draft("payment", { title: "Rent", date: "2026-11-01" }), ctx)).toBe(true);
    expect(canSaveNow("grade", draft("grade", { courseId: "c" }), ctx)).toBe(false);
  });
});

describe("recent kinds and 'Again?'", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();
  const items = [
    { type: "homework", title: "Algebra homework 4.1", course_id: "m", created_at: at(20) },
    { type: "homework", title: "Algebra homework 4.2", course_id: "m", created_at: at(22) },
    { type: "payment", title: "Phone bill", created_at: at(21), course_id: null },
    { type: "task", title: "Buy stamps", created_at: at(19), course_id: null },
    { type: "event", title: "Dentist", created_at: at(18), course_id: null },
    { type: "homework", title: "Algebra homework 4.3", course_id: "m", created_at: at(23) },
  ];

  it("the 3 most recent distinct kinds, newest first", () => {
    expect(recentKinds(items)).toEqual(["homework", "payment", "task"]);
  });

  it("repeated items (numbers ignored, same class) become Again? chips with their newest wording", () => {
    const again = againChips(items);
    expect(again).toEqual([{ kind: "homework", title: "Algebra homework 4.3", courseId: "m", count: 3 }]);
  });

  it("nothing repeated, nothing offered", () => {
    expect(againChips(items.slice(2, 5))).toEqual([]);
  });
});

describe("dashboard cards", () => {
  it("shows cards in your order, hides what you hid, and appends new ones", () => {
    const all = ["school", "grades", "money", "habits", "coming"] as const;
    expect(layoutFor(undefined, [...all]).shown).toEqual([...all]);
    const l = layoutFor({ order: ["coming", "money"], hidden: ["grades"] }, [...all]);
    expect(l.order).toEqual(["coming", "money", "school", "grades", "habits"]);
    expect(l.shown).toEqual(["coming", "money", "school", "habits"]);
    expect(l.hidden).toEqual(["grades"]);
  });

  it("a card whose feature is off never appears, even if saved in the order", () => {
    const l = layoutFor({ order: ["habits", "school", "bogus"], hidden: ["money"] }, ["school", "coming"]);
    expect(l.shown).toEqual(["school", "coming"]);
    expect(l.hidden).toEqual([]);
  });

  it("moving a card up or down stops at the ends", () => {
    expect(moveCard(["school", "grades", "money"], "money", -1)).toEqual(["school", "money", "grades"]);
    expect(moveCard(["school", "grades", "money"], "school", -1)).toEqual(["school", "grades", "money"]);
    expect(moveCard(["school", "grades", "money"], "money", 1)).toEqual(["school", "grades", "money"]);
  });

  it("School: next 3 homework soonest first, and how many are missing", () => {
    const h = (id: string, dueAt: string, extra: Partial<AgendaEntry> = {}) => entry({ occId: id, type: "homework", dueAt, ...extra });
    const s = schoolCard(
      [
        h("late1", "2026-10-22T12:00:00Z"),
        h("late2", "2026-10-23T12:00:00Z"),
        h("snoozedLate", "2026-10-23T12:00:00Z", { snoozedUntil: "2026-10-25T15:00:00Z" }),
        h("d", "2026-10-29T12:00:00Z"),
        h("a", "2026-10-25T12:00:00Z", { link: "https://x.test" }),
        h("c", "2026-10-27T12:00:00Z"),
        h("b", "2026-10-26T12:00:00Z"),
        entry({ occId: "pay", type: "payment" }),
      ],
      NOW,
    );
    expect(s.missing).toBe(2);
    expect(s.next.map((e) => e.occId)).toEqual(["a", "snoozedLate", "b"]);
    expect(s.next[0].link).toBe("https://x.test");
  });

  it("Money: the soonest payment, flagged when overdue", () => {
    const m = moneyCard([entry({ occId: "p2", type: "payment", dueAt: "2026-10-30T12:00:00Z" }), entry({ occId: "p1", type: "payment", dueAt: "2026-10-26T12:00:00Z", amountCents: 4500 }), entry({ type: "task" })], NOW);
    expect(m.next?.occId).toBe("p1");
    expect(m.more).toBe(1);
    expect(m.overdue).toBe(false);
    expect(moneyCard([entry({ type: "payment", dueAt: "2026-10-20T12:00:00Z" })], NOW).overdue).toBe(true);
    expect(moneyCard([], NOW).next).toBeNull();
  });

  it("Coming up: birthdays, events and renewals in 14 days, with days until", () => {
    const list = comingUp(
      [
        entry({ occId: "far", type: "birthday", dueAt: "2026-11-20T14:00:00Z" }),
        entry({ occId: "today", type: "event", dueAt: "2026-10-24T22:00:00Z" }),
        entry({ occId: "soon", type: "renewal", dueAt: "2026-10-30T13:00:00Z" }),
        entry({ occId: "hw", type: "homework", dueAt: "2026-10-26T13:00:00Z" }),
        entry({ occId: "edge", type: "birthday", dueAt: "2026-11-07T14:00:00Z" }),
      ],
      NOW,
      TZ,
    );
    expect(list.map((c) => [c.entry.occId, c.days])).toEqual([["today", 0], ["soon", 6], ["edge", 14]]);
  });

  it("Grades: a ring per class for the newest quarter, and the newest grade with an up arrow", () => {
    const courses = [
      { id: "m", name: "Algebra", color: "#e4edff", school_year: "2026-2027" },
      { id: "i", name: "Italian", color: "#e2f5e8", school_year: "2026-2027" },
      { id: "old", name: "Old class", color: "#e4edff", school_year: "2025-2026" },
    ];
    const g = (id: string, course: string, title: string, at: string, score: number, out: number, extra: Record<string, unknown> = {}) =>
      ({ id, course_id: course, title, score, out_of: out, posted_at: at, letter: null, points: null, term: "q1", school_year: null, ...extra }) as never;
    const card = gradesCard(
      courses,
      [
        g("1", "m", "Quiz 1", "2026-10-01T12:00:00Z", 15, 20),
        g("2", "m", "Test 2", "2026-10-20T12:00:00Z", 19, 20),
        g("3", "i", "Average (B, 2.72)", "2026-10-10T12:00:00Z", 2.72, 4, { letter: "B", points: 2.72 }),
        g("4", "old", "Old", "2025-10-10T12:00:00Z", 1, 1, { school_year: "2025-2026" }),
      ],
      "2026-2027",
    );
    expect(card.rings.map((r) => [r.name, r.text])).toEqual([["Algebra", "85%"], ["Italian", "B"]]);
    expect(card.rings[1].ring).toBeCloseTo(0.68, 2);
    expect(card.newest).toMatchObject({ title: "Test 2", text: "19/20", dir: "up" });
    expect(card.termLabel).toBe("q1");
  });

  it("Grades: down when the newest is lower, no arrow with nothing to compare", () => {
    const g = (id: string, at: string, score: number) => ({ id, course_id: "m", title: id, score, out_of: 100, posted_at: at, letter: null, points: null, term: "q1", school_year: null }) as never;
    const courses = [{ id: "m", name: "Algebra", color: "#e4edff", school_year: "2026-2027" }];
    expect(gradesCard(courses, [g("a", "2026-10-01T00:00:00Z", 90), g("b", "2026-10-02T00:00:00Z", 70)], "2026-2027").newest?.dir).toBe("down");
    expect(gradesCard(courses, [g("a", "2026-10-01T00:00:00Z", 90)], "2026-2027").newest?.dir).toBeNull();
    expect(gradesCard(courses, [], "2026-2027")).toEqual({ rings: [], newest: null, termLabel: null });
  });

  it("Habits: today's circles, done or open, with streaks", () => {
    const occ = (id: string, item: string, due: string, status: "open" | "done" | "skipped") => ({ id, item_id: item, due_at: due, status });
    const c = habitCircles(
      [{ id: "h1", title: "🏃 Run" }, { id: "h2", title: "Read" }, { id: "h3", title: "Not today" }],
      [occ("o1", "h1", "2026-10-24T22:00:00Z", "open"), occ("o2", "h2", "2026-10-24T13:00:00Z", "done"), occ("o3", "h3", "2026-10-25T13:00:00Z", "open"), occ("o0", "h1", "2026-10-23T22:00:00Z", "done")],
      { h1: 4 },
      NOW,
      TZ,
    );
    expect(c).toEqual([
      { itemId: "h1", occId: "o1", title: "Run", emoji: "🏃", done: false, streak: 4 },
      { itemId: "h2", occId: "o2", title: "Read", emoji: "🌱", done: true, streak: 0 },
    ]);
    expect(leadingEmoji("📖 Read 10 pages")).toEqual({ emoji: "📖", rest: "Read 10 pages" });
  });
});

describe("grades helpers", () => {
  it("the quarter follows the school calendar", () => {
    const q = (iso: string) => currentTerm(new Date(iso), TZ);
    expect(q("2026-09-01T16:00:00Z")).toBe("q1");
    expect(q("2026-10-24T16:00:00Z")).toBe("q2");
    expect(q("2027-02-01T16:00:00Z")).toBe("q3");
    expect(q("2027-04-20T16:00:00Z")).toBe("q4");
  });

  it("reads 18/20, 92, 92% and B+ and refuses nonsense", () => {
    expect(parseScoreText("18/20")).toEqual({ score: 18, outOf: 20, letter: null });
    expect(parseScoreText("92")).toEqual({ score: 92, outOf: 100, letter: null });
    expect(parseScoreText("92.5%")).toEqual({ score: 92.5, outOf: 100, letter: null });
    expect(parseScoreText("b+")).toEqual({ score: 3.3, outOf: 4, letter: "B+" });
    expect(parseScoreText("E")).toBeNull();
    expect(parseScoreText("5/0")).toBeNull();
    expect(parseScoreText("")).toBeNull();
  });

  it("gradeValue puts letters and scores on one 0-100 scale", () => {
    expect(gradeValue({ score: 18, out_of: 20 })).toBe(90);
    expect(gradeValue({ score: 0, out_of: 4, letter: "B", points: 2.72 })).toBe(68);
    expect(gradeValue({ score: 0, out_of: 4, letter: "A" })).toBe(100);
  });
});

describe("quiet hours after a quick save", () => {
  const quiet = { start: "22:00:00", end: "07:00:00", urgentOverride: false };
  const ctx = { nudgeStyle: "on_time" as const, spaceId: null, now: NOW, tz: TZ };
  const draft = (kind: AddKind, patch: Partial<Draft>): Draft => ({ ...emptyDraft(kind, NOW, TZ), ...patch });

  it("a quick-typed reminder at 11:30 PM is held until 7:00 AM, so the toast can say so", () => {
    const p = parseQuickAdd("call grandma tomorrow 11:30pm", { now: NOW, tz: TZ, lang: "auto", courses: [] });
    const form = buildQuickInput(p, "call grandma tomorrow 11:30pm", { tz: TZ, nudgeStyle: "on_time", courses: [], isOn: allOn });
    const { warnings: _w, ...rest } = form;
    void _w;
    const release = quietRelease({ ...rest, spaceId: null }, quiet, TZ, NOW);
    expect(release?.toISOString()).toBe("2026-10-26T11:00:00.000Z"); // Monday 7:00 AM EDT
  });

  it("every flow is covered: a habit at 11:30 PM clashes, a daytime one does not", () => {
    const night = buildItem("habit", draft("habit", { title: "Stretch", time: "23:30" }), ctx)!;
    expect(quietRelease(night, quiet, TZ, NOW)).not.toBeNull();
    const day = buildItem("habit", draft("habit", { title: "Stretch", time: "10:00" }), ctx)!;
    expect(quietRelease(day, quiet, TZ, NOW)).toBeNull();
  });

  it("Ring anyway, the urgent exception and no date all mean no toast", () => {
    const night = buildItem("habit", draft("habit", { title: "Stretch", time: "23:30" }), ctx)!;
    expect(quietRelease({ ...night, ringAnyway: true }, quiet, TZ, NOW)).toBeNull();
    expect(quietRelease(night, { ...quiet, urgentOverride: true }, TZ, NOW)).toBeNull();
    expect(quietRelease(buildItem("task", draft("task", { title: "x" }), ctx)!, quiet, TZ, NOW)).toBeNull();
  });
});

import { activityStats, billsMonth, examCountdown, tonightList, weekStrip, winLine } from "@/lib/widgets";

describe("more dashboard widgets", () => {
  it("the new cards join the end of an older saved layout", () => {
    const l = layoutFor({ order: ["coming", "money"], hidden: [] }, [...CARD_IDS]);
    expect(l.order.slice(0, 2)).toEqual(["coming", "money"]);
    expect(l.order).toHaveLength(CARD_IDS.length);
    expect(l.order).toContain("recap");
  });

  it("week strip: 7 days from today, late things count today, the busiest day is flagged", () => {
    const e = (id: string, dueAt: string, extra: Partial<AgendaEntry> = {}) => entry({ occId: id, dueAt, ...extra });
    const days = weekStrip(
      [
        e("late", "2026-10-20T12:00:00Z"),
        e("t1", "2026-10-24T22:00:00Z"),
        e("m1", "2026-10-26T13:00:00Z"),
        e("m2", "2026-10-26T14:00:00Z"),
        e("m3", "2026-10-26T15:00:00Z"),
        e("later", "2026-12-01T15:00:00Z"),
        e("snoozed", "2026-10-24T20:00:00Z", { snoozedUntil: "2026-10-27T13:00:00Z" }),
      ],
      NOW,
      TZ,
    );
    expect(days.map((d) => d.key)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(days.map((d) => d.count)).toEqual([2, 0, 3, 1, 0, 0, 0]);
    expect(days[0].today).toBe(true);
    expect(days.filter((d) => d.heavy).map((d) => d.key)).toEqual(["2026-10-26"]);
  });

  it("exam countdown: the nearest test or quiz ahead, with days and a fuller ring when close", () => {
    const x = examCountdown(
      [
        entry({ type: "homework", title: "Unit 4 Test", dueAt: "2026-10-30T13:00:00Z" }),
        entry({ type: "homework", title: "Quiz 2", dueAt: "2026-10-27T13:00:00Z" }),
        entry({ type: "homework", title: "Worksheet", dueAt: "2026-10-25T13:00:00Z" }),
        entry({ type: "homework", title: "Old test", dueAt: "2026-10-20T13:00:00Z" }),
      ],
      NOW,
      TZ,
    )!;
    expect(x.entry.title).toBe("Quiz 2");
    expect(x.days).toBe(3);
    expect(x.fill).toBeCloseTo(1 - 3 / 14, 3);
    expect(examCountdown([], NOW, TZ)).toBeNull();
  });

  it("bills this month: what is left, what is paid, how full the bar is", () => {
    const b = billsMonth(
      [entry({ type: "payment", amountCents: 6000, dueAt: "2026-10-28T13:00:00Z" }), entry({ type: "payment", amountCents: 9999, dueAt: "2026-11-02T13:00:00Z" }), entry({ type: "task" })],
      [{ amount_cents: 2000, paid_on: "2026-10-03" }, { amount_cents: 500, paid_on: "2026-09-30" }],
      NOW,
      TZ,
    );
    expect(b).toEqual({ dueCents: 6000, paidCents: 2000, dueCount: 1, fill: 0.25 });
    expect(billsMonth([], [], NOW, TZ).fill).toBe(0);
  });

  it("activity: today, yesterday, this week (from Monday) and last week, homework counted apart", () => {
    const d = (item: string, iso: string) => ({ item_id: item, done_at: iso });
    const a = activityStats(
      [d("hw", "2026-10-24T14:00:00Z"), d("t", "2026-10-23T14:00:00Z"), d("hw", "2026-10-21T14:00:00Z"), d("hw", "2026-10-19T14:00:00Z"), d("hw", "2026-10-15T14:00:00Z"), d("t", "2026-10-05T14:00:00Z")],
      { hw: "homework", t: "task" },
      NOW,
      TZ,
    );
    // NOW is Saturday: this week is Mon 19 to Sat 24, last week is 12 to 18.
    expect(a).toEqual({ doneToday: 1, doneYesterday: 1, thisWeek: 4, lastWeek: 1, hwThisWeek: 3, hwLastWeek: 1 });
  });

  it("win of the day: yesterday first, then today, else a quote picked by the day", () => {
    const none = { doneToday: 0, doneYesterday: 0, thisWeek: 0, lastWeek: 0, hwThisWeek: 0, hwLastWeek: 0 };
    expect(winLine({ ...none, doneYesterday: 6, doneToday: 2 }, NOW, TZ)).toEqual({ kind: "yesterday", n: 6 });
    expect(winLine({ ...none, doneToday: 2 }, NOW, TZ)).toEqual({ kind: "today", n: 2 });
    const q = winLine(none, NOW, TZ);
    expect(q.kind).toBe("quote");
    expect(q.n).toBeGreaterThanOrEqual(0);
    expect(q.n).toBeLessThan(8);
  });

  it("tonight mode: late homework and anything due before noon tomorrow, in due order", () => {
    const h = (id: string, dueAt: string, extra: Partial<AgendaEntry> = {}) => entry({ occId: id, type: "homework", dueAt, ...extra });
    const list = tonightList(
      [
        h("tomorrow-3pm", "2026-10-25T19:00:00Z"),
        h("tonight", "2026-10-25T00:00:00Z"),
        h("late", "2026-10-22T12:00:00Z"),
        h("tomorrow-8am", "2026-10-25T12:00:00Z"),
        h("snoozed", "2026-10-24T20:00:00Z", { snoozedUntil: "2026-10-26T12:00:00Z" }),
        entry({ occId: "task", type: "task", dueAt: "2026-10-24T20:00:00Z" }),
      ],
      NOW,
      TZ,
    );
    expect(list.map((e) => e.occId)).toEqual(["late", "tonight", "tomorrow-8am"]);
  });
});
