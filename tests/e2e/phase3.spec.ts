import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetApp, signIn, startReady, type SeedItem } from "./helpers";

const DAY = 86_400_000;
const ALL = { payments: true, school: true, grades: true, feeds: true, updates: true, work: true, habits: true, birthdays: true, renewals: true, inbox: true, bills: true };
const ITEM_ID = "00000000-0000-4000-8000-0000000000b1";
const OCC_ID = "00000000-0000-4000-8000-0000000000c1";

const HYDRATION = /hydrat|did not match|#418|#423|#425|server rendered html/i;

/** Collects anything that looks like a hydration problem or an uncaught error while a page loads. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && HYDRATION.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function noViolations(page: Page, name: string) {
  await expect(page).toHaveTitle(/.+/); // the title is streamed in; give a slow machine a moment
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), name).toEqual([]);
}

function habitItems(): SeedItem[] {
  const now = Date.now();
  const days = (done: number, todayStatus: "open" | "done" | "skipped") => [
    ...Array.from({ length: done }, (_, i) => ({ dueAt: new Date(now - (done - i) * DAY).toISOString(), status: "done" })),
    { dueAt: new Date(now).toISOString(), status: todayStatus },
  ];
  return [
    { title: "Gym", type: "habit", dueAt: new Date(now).toISOString(), rrule: "FREQ=DAILY", occurrences: days(3, "open") },
    { title: "Read", type: "habit", dueAt: new Date(now).toISOString(), rrule: "FREQ=DAILY", occurrences: days(2, "open") },
  ];
}

test.describe("Delivery log", () => {
  test("shows the last tries with Miami time, the status and the real reason", async ({ page, request }) => {
    await startReady(page, request, [], "en", {}, {
      delivery_attempts: [
        { kind: "reminder", title: "Test nudge", status: "sent", error: null, created_at: "2026-10-15T03:03:20Z" },
        { kind: "test", title: "Test notification", status: "failed", error: "The push service refused our notification key (HTTP 403). Turn notifications off and on again in Settings.", http_status: 403, created_at: "2026-10-15T02:10:00Z" },
        { kind: "reminder", title: "Late call", status: "held", error: "Held — quiet hours, will send at 7:00 AM", created_at: "2026-10-15T01:00:00Z" },
      ],
    });
    await page.goto("/settings");
    await page.getByRole("link", { name: /delivery log/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/delivery log/i);
    await expect(page.getByRole("button", { name: /send test notification now/i })).toBeVisible();
    const first = page.getByRole("listitem").filter({ hasText: "Test nudge" });
    await expect(first).toContainText("Delivered");
    await expect(first).toContainText("Wed, Oct 14 · 11:03 PM");
    await expect(page.getByRole("listitem").filter({ hasText: "Test notification" })).toContainText("HTTP 403");
    await expect(page.getByRole("listitem").filter({ hasText: "Late call" })).toContainText("Held — quiet hours, will send at 7:00 AM");
    await noViolations(page, "delivery log");
  });

  test("an empty log explains how to make the first entry", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/settings/delivery");
    await expect(page.getByText(/send test notification now/i).first()).toBeVisible();
    await expect(page.getByText(/nothing yet/i)).toBeVisible();
  });
});

test.describe("times are the same on every device (no hydration errors)", () => {
  test.use({ timezoneId: "Pacific/Auckland" });

  test("every screen draws without a mismatch, even on a phone set to a different time zone", async ({ page, request }) => {
    const now = Date.now();
    await startReady(
      page,
      request,
      [
        ...habitItems(),
        { title: "Phone bill", type: "payment", dueAt: new Date(now + DAY).toISOString(), amountCents: 4500 },
        { title: "Math midterm", type: "homework", dueAt: new Date(now + 3 * DAY).toISOString() },
        { title: "Game day", type: "work", subtype: "game_day", dueAt: new Date(now + 2 * DAY).toISOString(), location: "Doral Central Park" },
        { title: "Mom's birthday", type: "birthday", dueAt: new Date(now + 5 * DAY).toISOString(), rrule: "FREQ=YEARLY" },
        { title: "Car registration", type: "renewal", dueAt: new Date(now + 40 * DAY).toISOString() },
      ],
      "en",
      ALL,
      { delivery_attempts: [{ kind: "reminder", title: "Phone bill", status: "sent", error: null, created_at: "2026-10-15T03:03:20Z" }] },
    );
    const problems = watch(page);
    for (const path of ["/", "/upcoming", "/add", "/settings", "/settings/delivery", "/payments", "/school", "/grades", "/habits", "/lists/work", "/lists/birthdays", "/lists/renewals", "/import", "/updates"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main").first()).toBeVisible();
    }
    expect(problems).toEqual([]);
    // and the delivery log still says 11:03 PM Miami time, not Auckland time
    await page.goto("/settings/delivery");
    await expect(page.getByText("Wed, Oct 14 · 11:03 PM")).toBeVisible();
  });
});

test.describe("everything new is off until switched on", () => {
  test("the new screens ask you to switch them on, and Add shows only the core kinds", async ({ page, request }) => {
    await startReady(page, request, []);
    for (const path of ["/habits", "/grades", "/import", "/lists/work", "/lists/birthdays", "/lists/renewals"]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name: /Settings → Features/ })).toBeVisible();
    }
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("mom's birthday oct 20");
    await page.getByRole("button", { name: /check it/i }).click();
    // The birthday kind is off, so the card offers a plain appointment instead.
    const kinds = page.getByRole("group").or(page.locator("fieldset")).filter({ hasText: "Kind" }).first();
    await expect(kinds.getByRole("button", { name: /appointment/i })).toHaveAttribute("aria-pressed", "true");
    await expect(kinds.getByRole("button", { name: /birthday/i })).toHaveCount(0);
    await expect(kinds.getByRole("button", { name: /habit/i })).toHaveCount(0);
    await expect(kinds.getByRole("button", { name: "Work", exact: true })).toHaveCount(0);
  });

  test("Settings has a switch for each, and turning one on shows its link on Today", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/settings");
    for (const name of [/^Work/, /^Habits/, /^Birthdays/, /^Renewals/, /^Grades/, /^Agent import/, /^Joker bills/]) {
      await expect(page.getByRole("switch", { name })).not.toBeChecked();
    }
    await page.getByRole("switch", { name: /^Habits/ }).check();
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "More" }).getByRole("link", { name: /Habits/ })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Habits", exact: true })).toBeVisible();
  });

  test("onboarding can switch the new kinds on from the first question", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: false, items: [] });
    await signIn(page);
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByRole("button", { name: /get started/i }).click();
    await page.getByRole("checkbox", { name: /habits/i }).click();
    await page.getByRole("checkbox", { name: /birthdays/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();
    await page.getByRole("radio", { name: /morning summary/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();
    await page.getByRole("button", { name: /skip for now/i }).click();
    await page.getByRole("button", { name: /finish/i }).click();
    await page.getByRole("button", { name: /^skip$/i }).click();
    await page.getByRole("button", { name: /go to today/i }).click();
    await page.goto("/settings");
    await expect(page.getByRole("switch", { name: /^Habits/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /^Birthdays/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /^Work/ })).not.toBeChecked();
  });
});

test.describe("smart quick-add", () => {
  test("math hw friday 8pm becomes homework in the right class, due Friday 8 PM", async ({ page, request }) => {
    await startReady(page, request, [], "en", { school: true }, { courses: [{ name: "Math 101", color: "#e4edff" }, { name: "English", color: "#ffe6ec" }] });
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("math hw friday 8pm");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByRole("button", { name: /homework/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Time")).toHaveValue("20:00");
    await expect(page.locator("#f-course option:checked")).toHaveText("Math 101");
  });

  test("pay phone bill every 15th is a payment that repeats on the 15th", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("pay phone bill every 15th");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByRole("button", { name: /payment/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#f-repeat option:checked")).toContainText(/every month.*15/i);
    await expect(page.getByLabel("Date")).toHaveValue(/-15$/);
  });

  test("a birthday repeats every year with a 3-day heads-up and the day itself (when Birthdays is on)", async ({ page, request }) => {
    await startReady(page, request, [], "en", { birthdays: true });
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("mom's birthday oct 20");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByRole("button", { name: /birthday/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#f-repeat option:checked")).toContainText(/every year/i);
    await expect(page.getByRole("button", { name: "3 days before at 9:00 AM" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "That day at 9:00 AM" })).toHaveAttribute("aria-pressed", "true");
  });

  test("an appointment keeps the place after @", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("dentist friday 3pm @ Dr Lopez office");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByLabel("Where")).toHaveValue("Dr Lopez office");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: /this week/i }).click(); // Friday is usually not today
    await page.getByRole("link", { name: /dentist/i }).first().click();
    await expect(page.getByText("Dr Lopez office")).toBeVisible();
  });
});

test.describe("work reminders with a checklist", () => {
  test("a game day with steps you can tick off", async ({ page, request }) => {
    await startReady(page, request, [], "en", { work: true });
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("game day saturday 9am");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Game day" })).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Add a step…").fill("Bring cones");
    await page.getByLabel("Add a step…").press("Enter");
    await page.getByLabel("Add a step…").fill("Print roster");
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/lists/work");
    await page.getByRole("link", { name: /game day/i }).first().click();
    await expect(page.getByRole("heading", { name: /checklist/i })).toContainText("0/2");
    await page.getByRole("checkbox", { name: "Bring cones" }).check();
    await expect(page.getByRole("heading", { name: /checklist/i })).toContainText("1/2");
  });
});

test.describe("habits", () => {
  test("streaks, Done, and Skip today that keeps the streak", async ({ page, request }) => {
    await startReady(page, request, habitItems(), "en", { habits: true });
    await page.goto("/habits");
    const gym = page.getByRole("listitem").filter({ hasText: "Gym" });
    const read = page.getByRole("listitem").filter({ hasText: "Read" });
    await expect(gym).toContainText("🔥 3");
    await expect(read).toContainText("🔥 2");

    await page.getByRole("button", { name: "Done: Gym" }).click();
    await expect(gym).toContainText("Done for today");
    await expect(gym).toContainText("🔥 4");

    await page.getByRole("button", { name: "Skip today: Read" }).click();
    await expect(read).toContainText("Skipped today — your streak is safe");
    await expect(read).toContainText("🔥 2");

    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: "Gym" })).toContainText("🔥 4");
    await expect(page.getByRole("listitem").filter({ hasText: "Read" })).toContainText("🔥 2");
    await noViolations(page, "habits");
  });
});

test.describe("importing school work", () => {
  test("preview, confirm, then the same data again changes nothing", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await page.goto("/import");
    await page.getByRole("button", { name: "Insert an example" }).click();
    await page.getByRole("button", { name: /^preview/i }).click();
    await expect(page.getByRole("heading", { name: "This is what would happen" })).toBeVisible();
    for (const title of ["Math 101", "Chapter 3 problems", "Quiz 2"]) {
      await expect(page.getByRole("listitem").filter({ hasText: title }).filter({ hasText: "New" })).toBeVisible();
    }
    // nothing saved yet
    await page.goto("/grades");
    await expect(page.getByText("No classes yet")).toBeVisible();

    await page.goto("/import");
    await page.getByRole("button", { name: "Insert an example" }).click();
    await page.getByRole("button", { name: /^preview/i }).click();
    await page.getByRole("button", { name: /confirm import \(3\)/i }).click();
    await expect(page.getByRole("heading", { name: "Imported ✓" })).toBeVisible();

    await page.goto("/grades");
    await expect(page.getByRole("link", { name: /Math 101/ })).toContainText("90%");
    await page.getByRole("link", { name: /Math 101/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Math 101");
    await expect(page.getByText("Quiz 2")).toBeVisible();
    await expect(page.getByText("18/20")).toBeVisible();

    await page.goto("/import");
    await page.getByRole("button", { name: "Insert an example" }).click();
    await page.getByRole("button", { name: /^preview/i }).click();
    await expect(page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
    await expect(page.getByRole("listitem").filter({ hasText: "Quiz 2" })).toContainText("Unchanged");
    await noViolations(page, "import");
  });

  test("mistakes are explained, not generic", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await page.goto("/import");
    await page.getByLabel("Import JSON").fill("{ nope");
    await page.getByRole("button", { name: /^preview/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /fix this first/i })).toContainText(/not valid JSON/);

    await page.getByLabel("Import JSON").fill(JSON.stringify({ source: "canvas", grades: [{ external_id: "g", class: "c", title: "T", score: -1, out_of: 0 }] }));
    await page.getByRole("button", { name: /^preview/i }).click();
    const alert = page.getByRole("alert").filter({ hasText: /fix this first/i });
    await expect(alert).toContainText('source: must be "classroom", "colegia" or "manual"');
    await expect(alert).toContainText("grades[1].score: cannot be negative");
    await expect(alert).toContainText("grades[1].out_of: must be more than 0");
  });

  test("grades can be typed by hand, and the average is points over points", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL, { courses: [{ id: "00000000-0000-4000-8000-0000000000d1", name: "English", color: "#ffe6ec" }] });
    await page.goto("/grades/00000000-0000-4000-8000-0000000000d1");
    await page.getByLabel("What was it?").fill("Essay");
    await page.getByLabel("Score").fill("45");
    await page.getByLabel("Out of").fill("50");
    await page.getByRole("button", { name: "Add grade" }).click();
    await expect(page.getByText("Essay", { exact: true })).toBeVisible(); // let the first one land before typing the next
    await page.getByLabel("What was it?").fill("Quiz");
    await page.getByLabel("Score").fill("5");
    await page.getByLabel("Out of").fill("10");
    await page.getByRole("button", { name: "Add grade" }).click();
    await expect(page.getByText("Quiz", { exact: true })).toBeVisible();
    // 50 of 60 points = 83.3%
    await expect(page.getByRole("banner").or(page.locator("header")).first()).toContainText("83.3%");
  });
});

test.describe("access tokens", () => {
  test("make one (shown once), test it with a clear message, revoke it", async ({ page, request }) => {
    await startReady(page, request, [], "en", { inbox: true });
    await page.goto("/settings");
    await page.getByLabel("Name (for example: Chrome agent)").fill("Chrome agent");
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page.getByText("Copy this token now. It is shown only once.")).toBeVisible();
    const token = (await page.getByTestId("new-token").textContent()) ?? "";
    expect(token.startsWith("ndg_")).toBe(true);
    await expect(page.getByRole("listitem").filter({ hasText: "Chrome agent" })).toContainText("Never used yet");

    await page.getByLabel("Test a token (paste it here)").fill(token);
    await page.getByRole("button", { name: "Test token" }).last().click();
    // The browser-test server has no real database key, so it says exactly that.
    await expect(page.getByText(/server key is not set up/i)).toBeVisible();

    await page.getByRole("button", { name: "Revoke: Chrome agent" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Chrome agent" })).toContainText("Revoked on");
  });
});

test.describe("tapping a notification", () => {
  test("opens the item with Done and Snooze on top", async ({ page, request }) => {
    const items: SeedItem[] = [{ id: ITEM_ID, occId: OCC_ID, title: "Call coach", dueAt: new Date(Date.now() + 3600_000).toISOString() }];
    await startReady(page, request, items);
    await page.goto(`/item/${ITEM_ID}`);
    await expect(page.getByRole("region", { name: "Quick actions" })).toHaveCount(0);
    await page.goto(`/item/${ITEM_ID}?occ=${OCC_ID}&quick=1`);
    const quick = page.getByRole("region", { name: "Quick actions" });
    await expect(quick).toBeVisible();
    for (const label of ["10 minutes", "1 hour", "Tonight (8 PM)", "Tomorrow morning"]) {
      await expect(quick.getByRole("button", { name: new RegExp(label.replace(/[()]/g, "\\$&")) })).toBeVisible();
    }
    await quick.getByRole("button", { name: /tomorrow morning/i }).click();
    await expect(quick.getByText("Snoozed ⏰")).toBeVisible();
    await page.goto("/");
    await expect(page.getByText(/snoozed until/i)).toBeVisible();
  });

  test("a made-up occurrence number shows no buttons", async ({ page, request }) => {
    const items: SeedItem[] = [{ id: ITEM_ID, occId: OCC_ID, title: "Call coach", dueAt: new Date(Date.now() + 3600_000).toISOString() }];
    await startReady(page, request, items);
    await page.goto(`/item/${ITEM_ID}?occ=00000000-0000-4000-8000-0000000000ff&quick=1`);
    await expect(page.getByRole("region", { name: "Quick actions" })).toHaveCount(0);
  });
});

test.describe("a new deploy", () => {
  test("shows 'Update available — tap to reload' when a newer version is live", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.route("**/api/version", (route) => route.fulfill({ json: { build: "a-newer-deploy" } }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Update available — tap to reload" })).toBeVisible();
  });

  test("no banner when the version is the same", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /update available/i })).toHaveCount(0);
  });

  test("the service worker is served fresh and can act on notification buttons", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBe(true);
    expect(res.headers()["cache-control"]).toMatch(/no-store|no-cache/);
    const body = await res.text();
    expect(body).toContain("skipWaiting");
    expect(body).toContain("/api/notify/action");
    expect(body).toMatch(/build: \w+/);
  });
});

test.describe("accessibility of the new screens", () => {
  test("Settings with everything switched on, grades and lists", async ({ page, request }) => {
    const now = Date.now();
    await startReady(page, request, [{ title: "Game day", type: "work", subtype: "game_day", dueAt: new Date(now + DAY).toISOString() }], "en", ALL, {
      courses: [{ id: "00000000-0000-4000-8000-0000000000d1", name: "English", color: "#ffe6ec" }],
      grades: [{ course_id: "00000000-0000-4000-8000-0000000000d1", title: "Essay", score: 45, out_of: 50, percent: 90, posted_at: new Date(now).toISOString(), source: "manual" }],
    });
    for (const path of ["/settings", "/grades", "/grades/00000000-0000-4000-8000-0000000000d1", "/lists/work", "/lists/birthdays", "/lists/renewals", "/add"]) {
      await page.goto(path);
      await noViolations(page, path);
    }
  });
});
