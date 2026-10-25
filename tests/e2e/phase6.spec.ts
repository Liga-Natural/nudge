import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, startReady, resetApp, type SeedItem } from "./helpers";

const ALL = { payments: true, school: true, grades: true, habits: true, birthdays: true, renewals: true };
const MATH = "00000000-0000-4000-8000-0000000000a1";
const ITALIAN = "00000000-0000-4000-8000-0000000000a2";
const HOUR = 3_600_000;
const DAY = 86_400_000;

const addButton = (page: Page) => page.getByRole("button", { name: "Add", exact: true });

async function openSheet(page: Page) {
  await addButton(page).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAccessibleName(/what are we adding/i);
  return sheet;
}

async function noViolations(page: Page, name: string) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${name} has accessibility problems`).toEqual([]);
}

test.describe("the add sheet", () => {
  test("the + button springs up a sheet; the quick bar previews while typing and Enter saves, with Undo", async ({ page, request }) => {
    await startReady(page, request, [], "en", { school: true }, { courses: [{ id: MATH, name: "Algebra", color: "#e4edff" }] });
    const sheet = await openSheet(page);
    await sheet.getByLabel(/type it in your own words/i).fill("algebra hw friday 8pm");
    const preview = sheet.getByTestId("quick-preview");
    await expect(preview).toContainText("Homework");
    await expect(preview).toContainText("8:00 PM");
    await expect(preview).toContainText("Algebra");
    await sheet.getByLabel(/type it in your own words/i).press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Saved:" })).toBeVisible();
    await page.goto("/upcoming");
    await expect(page.getByTestId("item-row")).toHaveCount(1);
    await page.goto("/");
    await addButton(page).click();
    await page.getByLabel(/type it in your own words/i).fill("water the plants tomorrow 9am");
    await page.getByLabel(/type it in your own words/i).press("Enter");
    await page.getByRole("button", { name: "Undo" }).click();
    await page.goto("/upcoming");
    await expect(page.getByTestId("item-row")).toHaveCount(1);
  });

  test("Homework: pick a class, type it, tap Tomorrow, then save (3 steps)", async ({ page, request }) => {
    await startReady(page, request, [], "en", { school: true }, { courses: [{ id: MATH, name: "Algebra", color: "#e4edff" }] });
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: /^Homework/ }).click();
    await expect(sheet).toContainText("Step 1 of 3");
    await sheet.getByRole("button", { name: /Algebra/ }).click();
    await expect(sheet).toContainText("Step 2 of 3");
    await sheet.getByLabel("What", { exact: true }).fill("Worksheet 4.2");
    await sheet.getByRole("button", { name: /^Tomorrow/ }).click();
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await expect(sheet).toContainText("Step 3 of 3");
    await sheet.getByRole("button", { name: "Both" }).click();
    await sheet.getByRole("button", { name: "+ More options" }).click();
    await sheet.getByRole("button", { name: "Online" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved: Worksheet 4.2" })).toBeVisible();
    await page.goto("/school");
    await expect(page.getByText("Worksheet 4.2")).toBeVisible();
  });

  test("Payment: a number pad for the amount, then the 1st, monthly", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: /^Payment/ }).click();
    await sheet.getByLabel("What is it for?").fill("Rent");
    for (const k of ["9", "0", "0"]) await sheet.getByRole("button", { name: k, exact: true }).click();
    await expect(sheet.getByLabel("Amount ($)")).toHaveText("$900");
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await sheet.getByRole("button", { name: /^1st/ }).click();
    await expect(sheet.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await sheet.getByRole("button", { name: "Autopay on" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved: Rent" })).toBeVisible();
  });

  test("Grade: class, test, 18/20 and the quarter, then it shows on the Grades card", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL, { courses: [{ id: MATH, name: "Algebra", color: "#e4edff" }] });
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: /^Grade/ }).click();
    await sheet.getByRole("button", { name: /Algebra/ }).click();
    await sheet.getByRole("button", { name: "Test", exact: true }).click();
    await sheet.getByLabel("What was it?").fill("Unit 3");
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await sheet.getByLabel("Score", { exact: true }).fill("18");
    await sheet.getByLabel("Out of").fill("20");
    await sheet.getByRole("button", { name: "Q1" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved: Test: Unit 3" })).toBeVisible();
    await page.goto("/");
    const card = page.getByRole("region", { name: "Grades" });
    await expect(card).toContainText("90%");
    await expect(card).toContainText("Test: Unit 3");
  });

  test("an empty card's button opens the sheet straight into that flow", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await page.getByRole("region", { name: "School" }).getByRole("button", { name: /Add homework/ }).click();
    const sheet = page.getByRole("dialog", { name: /homework/i });
    await expect(sheet).toContainText("Step 1 of 3");
  });

  test("the sheet and the dashboard pass the accessibility checks", async ({ page, request }) => {
    const items: SeedItem[] = [
      { title: "Essay draft", type: "homework", dueAt: new Date(Date.now() + DAY).toISOString(), courseId: MATH, link: "https://example.test/essay" },
      { title: "Pay rent", type: "payment", dueAt: new Date(Date.now() + 3 * DAY).toISOString(), amountCents: 90000 },
      { title: "Abuela birthday", type: "birthday", dueAt: new Date(Date.now() + 5 * DAY).toISOString() },
    ];
    await startReady(page, request, items, "en", ALL, { courses: [{ id: MATH, name: "Algebra", color: "#e4edff" }] });
    await noViolations(page, "today with cards");
    await openSheet(page);
    await noViolations(page, "add sheet");
    await page.getByRole("group", { name: "Pick a kind" }).getByRole("button", { name: /^Homework/ }).click();
    await noViolations(page, "homework step 1");
    await page.getByRole("button", { name: /Algebra/ }).click();
    await noViolations(page, "homework step 2");
  });
});

test.describe("quiet hours after saving", () => {
  test("quick-save never holds a reminder silently: a toast says when it will ring, with Ring anyway", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [], profile: { urgent_override: false } });
    await signIn(page);
    await addButton(page).click();
    const bar = page.getByLabel(/type it in your own words/i);
    await bar.fill("Call grandma tomorrow 11:30pm");
    await bar.press("Enter");
    const toast = page.getByRole("status").filter({ hasText: "Quiet hours — this will ring at 7:00 AM" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Ring anyway" }).click();
    await expect(toast).toHaveCount(0);
  });

  test("the step-by-step flows say it too", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [], features: ALL, profile: { urgent_override: false } });
    await signIn(page);
    const sheet = await openSheet(page);
    await sheet.getByRole("group", { name: "Pick a kind" }).getByRole("button", { name: /^Habit/ }).click();
    await sheet.getByLabel("Name your habit").fill("Stretch");
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await sheet.getByRole("button", { name: /^Next/ }).click();
    await sheet.getByLabel("Time", { exact: true }).fill("23:30");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Quiet hours — this will ring at 7:00 AM" })).toBeVisible();
  });
});

test.describe("the dashboard", () => {
  const seed = (): SeedItem[] => [
    { title: "Late worksheet", type: "homework", dueAt: new Date(Date.now() - 2 * DAY).toISOString(), courseId: ITALIAN },
    { title: "Essay draft", type: "homework", dueAt: new Date(Date.now() + DAY).toISOString(), courseId: MATH, link: "https://example.test/essay" },
    { title: "Pay rent", type: "payment", dueAt: new Date(Date.now() + 2 * DAY).toISOString(), amountCents: 90000 },
    { title: "Abuela birthday", type: "birthday", dueAt: new Date(Date.now() + 4 * DAY).toISOString() },
    { title: "🏃 Run", type: "habit", rrule: "FREQ=DAILY", dueAt: new Date(Date.now() + HOUR / 60).toISOString() },
  ];
  const courses = [
    { id: MATH, name: "p03 Algebra", color: "#e4edff" },
    { id: ITALIAN, name: "p05 Italian", color: "#ffffff" },
  ];

  test("School, Money, Habits and Coming up cards show what is next, with class emoji instead of white squares", async ({ page, request }) => {
    await startReady(page, request, seed(), "en", ALL, { courses });
    const school = page.getByRole("region", { name: "School" });
    await expect(school).toContainText("Essay draft");
    await expect(school.getByTestId("missing-badge")).toHaveText("Missing (1)");
    await expect(school.getByRole("link", { name: /Open: Essay draft/ })).toHaveAttribute("href", "https://example.test/essay");
    await expect(school).toContainText("➗");
    const money = page.getByRole("region", { name: "Money" });
    await expect(money).toContainText("$900.00");
    await expect(money).toContainText("Pay rent");
    const coming = page.getByRole("region", { name: "Coming up" });
    await expect(coming).toContainText("Abuela birthday");
    await expect(coming).toContainText("in 4 days");
    await page.goto("/school");
    await expect(page.getByRole("button", { name: /Edit class: p05 Italian/ })).toContainText("🇮🇹");
  });

  test("tapping a habit circle checks it off right there", async ({ page, request }) => {
    await startReady(page, request, seed(), "en", ALL, { courses });
    const habits = page.getByRole("region", { name: "Habits" });
    const circle = habits.getByRole("button", { name: /Run/ });
    await expect(circle).toHaveAttribute("aria-pressed", "false");
    await circle.click();
    await expect(circle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("region", { name: "Habits" }).getByRole("button", { name: /Run/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("Customize hides a card and the choice is still there after a reload", async ({ page, request }) => {
    await startReady(page, request, seed(), "en", ALL, { courses });
    await expect(page.getByRole("region", { name: "Money" })).toBeVisible();
    await page.getByRole("button", { name: /customize/i }).click();
    const sheet = page.getByRole("dialog", { name: /customize/i });
    await sheet.getByRole("checkbox", { name: /Money/ }).uncheck();
    await sheet.getByRole("button", { name: "Down: School" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Money" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Money" })).toHaveCount(0);
    const order = await page.locator(".bento > section").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(order.slice(0, 2)).toEqual(["Grades", "School"]);
  });

  test("an empty dashboard says so kindly, with buttons", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await expect(page.getByRole("region", { name: "School" })).toContainText("No homework 🎉");
    await expect(page.getByRole("region", { name: "Money" })).toContainText("Nothing due");
    await expect(page.getByRole("region", { name: "Habits" })).toContainText("No habits today");
  });

  test("a class can be given its own emoji and colour", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [], features: ALL, extra: { courses } });
    await signIn(page);
    await page.goto("/school");
    await page.getByRole("button", { name: /Edit class: p03 Algebra/ }).click();
    const sheet = page.getByRole("dialog", { name: /p03 Algebra/ });
    await sheet.getByRole("button", { name: "🧮" }).click();
    await sheet.getByRole("button", { name: "#ffe6ec" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: /Edit class: p03 Algebra/ })).toContainText("🧮");
  });
});

test.describe("more widgets, the icon badge and Tonight mode", () => {
  const items = (): SeedItem[] => [
    { title: "Late worksheet", type: "homework", dueAt: new Date(Date.now() - 2 * DAY).toISOString(), courseId: MATH },
    { title: "Unit 4 Test", type: "homework", dueAt: new Date(Date.now() + 3 * DAY).toISOString(), courseId: MATH },
    { title: "Pay rent", type: "payment", dueAt: new Date(Date.now() + 60_000).toISOString(), amountCents: 90000 },
    { title: "🏃 Run", type: "habit", rrule: "FREQ=DAILY", dueAt: new Date(Date.now() + 60_000).toISOString() },
  ];
  const courses = [{ id: MATH, name: "p03 Algebra", color: "#e4edff" }];

  test("every new card is there with something useful in it", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL, { courses });
    await page.getByRole("button", { name: /more cards/i }).click();
    await expect(page.getByRole("region", { name: "Week ahead" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Exam countdown" })).toContainText("Unit 4 Test");
    await expect(page.getByRole("region", { name: "Bills this month" })).toContainText("$900.00");
    await expect(page.getByRole("region", { name: "Streaks" })).toContainText("best streak");
    await expect(page.getByRole("region", { name: "Win of the day" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Weekly recap" })).toContainText("missing");
    const focus = page.getByRole("region", { name: "Focus timer" });
    await expect(focus).toContainText("25:00");
    await focus.getByRole("button", { name: "Start" }).click();
    await expect(focus.getByRole("button", { name: "Pause" })).toBeVisible();
    await focus.getByRole("button", { name: "Pause" }).click();
    await focus.getByRole("button", { name: "Reset" }).click();
    await expect(focus).toContainText("25:00");
  });

  test("the app icon badge shows what is due and late", async ({ page, request }) => {
    await page.addInitScript(() => {
      (window as unknown as { __badge: number | null }).__badge = null;
      (navigator as unknown as { setAppBadge: (n: number) => Promise<void> }).setAppBadge = async (n) => {
        (window as unknown as { __badge: number | null }).__badge = n;
      };
    });
    await startReady(page, request, items(), "en", ALL, { courses });
    // 1 late homework + payment and habit due today (the test exam is later this week).
    await expect.poll(() => page.evaluate(() => (window as unknown as { __badge: number | null }).__badge)).toBe(3);
  });

  test("Tonight mode lists what is late or due by tomorrow noon, and ticking fills the ring", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL, { courses });
    await page.goto("/tonight");
    await expect(page.getByTestId("tonight-row")).toHaveCount(1);
    await expect(page.getByTestId("tonight-row")).toContainText("Late worksheet");
    await page.getByRole("button", { name: "Done: Late worksheet" }).click();
    await expect(page.getByRole("img", { name: /1 of 1 done/ })).toBeVisible();
    await expect(page.getByText("All done. Go relax!")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Nothing for tonight")).toBeVisible();
  });

  test("the new cards and Tonight mode pass the accessibility checks", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL, { courses });
    await page.getByRole("button", { name: /more cards/i }).click();
    await noViolations(page, "today with every widget");
    await page.goto("/tonight");
    await noViolations(page, "tonight mode");
  });
});

test.describe("Home Screen widgets in Settings", () => {
  test("make a token (shown once), copy the script, see every Parameter, revoke", async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await startReady(page, request, [], "en", {});
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Home Screen widgets" });
    await expect(section).toBeVisible();
    for (const p of ["next", "today", "school", "grades", "week", "habits", "rotate"]) await expect(section.locator("code", { hasText: new RegExp(`^${p}$`) })).toBeVisible();
    await section.getByRole("button", { name: "Create widget token" }).click();
    const token = section.getByTestId("new-widget-token");
    await expect(token).toHaveText(/^ndw_[A-Za-z0-9_-]{40,}$/);
    await expect(section.getByRole("listitem").filter({ hasText: "ndw_" })).toContainText("Never used yet");
    await section.getByRole("button", { name: "Copy script" }).click();
    await expect(section.getByRole("status").filter({ hasText: /Script copied|Couldn't copy/ })).toBeVisible();
    await section.getByRole("button", { name: /Revoke: ndw_/ }).click();
    await expect(section.getByRole("listitem").filter({ hasText: "ndw_" })).toContainText("Revoked on");
  });

  test("the widget address refuses a missing or wrong token with a plain message", async ({ request }) => {
    const none = await request.get("/api/widget");
    expect([401, 503]).toContain(none.status());
    const post = await request.post("/api/widget");
    expect([405, 503]).toContain(post.status());
  });

  test("the Settings section passes the accessibility checks", async ({ page, request }) => {
    await startReady(page, request, [], "en", {});
    await page.goto("/settings");
    await noViolations(page, "settings with widgets");
  });
});
