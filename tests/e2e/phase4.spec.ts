import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetApp, signIn, startReady, type SeedItem } from "./helpers";

const DAY = 86_400_000;
const COURSE = "00000000-0000-4000-8000-0000000000d1";
const ALL = { payments: true, school: true, grades: true, habits: true };
const soon = (minutes = 3) => new Date(Date.now() + minutes * 60_000).toISOString();
const row = (page: Page, title: string) => page.getByTestId("item-row").filter({ hasText: title });

async function noViolations(page: Page, name: string) {
  await expect(page).toHaveTitle(/.+/); // the title is streamed in; give a slow machine a moment
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), name).toEqual([]);
}

/** A mouse drag across a card, the way a thumb swipes. */
async function swipe(page: Page, title: string, dx: number) {
  const box = await row(page, title).locator(".card").first().boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  // start on the card's own padding (not on a button), at the side the swipe moves away from
  const x = dx > 0 ? box!.x + 6 : box!.x + box!.width - 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test.describe("quiet hours: ask before a reminder would be held", () => {
  test("a reminder inside quiet hours asks first, and both answers save it", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [], profile: { urgent_override: false } });
    await signIn(page);
    for (const answer of [/ring anyway/i, /keep quiet/i]) {
      await page.goto("/add");
      await page.getByLabel(/what should we remember/i).fill("Call grandma tomorrow 11:30pm");
      await page.getByRole("button", { name: /check it/i }).click();
      await page.getByRole("button", { name: "Save" }).click();
      const sheet = page.getByRole("dialog", { name: /during quiet hours/i });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("22:00–07:00");
      await sheet.getByRole("button", { name: answer }).click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("a daytime reminder saves without asking", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [], profile: { urgent_override: false } });
    await signIn(page);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("Call grandma tomorrow 2pm");
    await page.getByRole("button", { name: /check it/i }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("onboarding has a quiet hours step with a clear choice", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: false, items: [] });
    await signIn(page);
    await page.getByRole("button", { name: /get started/i }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^next/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/quiet/i);
    await page.getByRole("radio", { name: /pick my own/i }).click();
    await expect(page.getByLabel(/quiet from/i)).toBeVisible();
    await page.getByRole("radio", { name: /no quiet hours/i }).click();
    await expect(page.getByLabel(/quiet from/i)).toHaveCount(0);
  });
});

test.describe("school page sections", () => {
  test("a past exam is under Late only; upcoming exams and assignments have their own items", async ({ page, request }) => {
    const items: SeedItem[] = [
      { title: "Math exam", type: "homework", dueAt: new Date(Date.now() - DAY).toISOString(), courseId: COURSE },
      { title: "Final exam", type: "homework", dueAt: new Date(Date.now() + 3 * DAY).toISOString(), courseId: COURSE },
      { title: "Worksheet 4", type: "homework", dueAt: new Date(Date.now() + DAY).toISOString(), courseId: COURSE },
    ];
    await startReady(page, request, items, "en", ALL, { courses: [{ id: COURSE, name: "Math", color: "#e4edff" }] });
    await page.goto("/school");
    await expect(page.getByRole("heading", { name: "Late", exact: true })).toBeVisible();
    await expect(row(page, "Math exam")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Late" }).or(page.locator("section[aria-labelledby=sc-late]")).getByText("Math exam")).toBeVisible();
    await expect(page.locator("section[aria-labelledby=sc-exams]").getByText("Final exam")).toBeVisible();
    await expect(page.locator("section[aria-labelledby=sc-exams]").getByText("Math exam")).toHaveCount(0);
    await expect(page.locator("section[aria-labelledby=sc-all]").getByText("Worksheet 4")).toBeVisible();
    await expect(page.locator("section[aria-labelledby=sc-all]").getByText("Math exam")).toHaveCount(0);
  });
});

test.describe("type cards", () => {
  test("homework shows its class chip and Mark turned in; payments show the amount and Paid", async ({ page, request }) => {
    const items: SeedItem[] = [
      { title: "Essay draft", type: "homework", dueAt: soon(3), courseId: COURSE },
      { title: "Phone bill", type: "payment", dueAt: soon(2), amountCents: 4500 },
    ];
    await startReady(page, request, items, "en", ALL, { courses: [{ id: COURSE, name: "English", color: "#ffe6ec" }] });
    const hw = row(page, "Essay draft");
    await expect(hw).toContainText("English");
    await expect(hw).toContainText(/in \d+m|in now/);
    const pay = row(page, "Phone bill");
    await expect(pay).toContainText("$45.00");
    await expect(pay.getByRole("button", { name: "Paid", exact: false }).first()).toBeVisible();

    await hw.getByRole("button", { name: /mark turned in/i }).click();
    await expect(row(page, "Essay draft")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Turned in: Essay draft" })).toBeVisible();

    await pay.getByRole("button", { name: /^✓ paid/i }).click();
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(row(page, "Phone bill")).toHaveCount(0);
  });

  test("a habit shows its flame streak and the week's dots", async ({ page, request }) => {
    const now = Date.now();
    const items: SeedItem[] = [
      {
        title: "Gym",
        type: "habit",
        dueAt: new Date(now).toISOString(),
        allDay: true,
        rrule: "FREQ=DAILY",
        occurrences: [
          { dueAt: new Date(now - 2 * DAY).toISOString(), status: "done" },
          { dueAt: new Date(now - DAY).toISOString(), status: "done" },
          { dueAt: new Date(now).toISOString(), status: "open" },
        ],
      },
    ];
    await startReady(page, request, items, "en", { habits: true });
    const gym = row(page, "Gym");
    await expect(gym).toContainText("🔥 2");
    await expect(gym.getByLabel("This week")).toBeVisible();
  });
});

test.describe("gestures", () => {
  test("swipe right is Done (with Undo), swipe left opens snooze", async ({ page, request }) => {
    await startReady(page, request, [
      { title: "Alpha", type: "task", dueAt: soon(3) },
      { title: "Bravo", type: "task", dueAt: soon(4) },
    ]);
    await swipe(page, "Alpha", 150);
    await expect(row(page, "Alpha")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Done: Alpha" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row(page, "Alpha")).toBeVisible();

    await swipe(page, "Bravo", -150);
    await expect(page.getByRole("dialog", { name: /snooze for how long/i })).toBeVisible();
    for (const label of ["10 minutes", "1 hour", "Tonight", "Tomorrow"]) {
      await expect(page.getByRole("dialog").getByRole("button", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });

  test("a snooze can be undone", async ({ page, request }) => {
    await startReady(page, request, [{ title: "Alpha", type: "task", dueAt: soon(3) }]);
    await page.getByRole("button", { name: /snooze: alpha/i }).click();
    await page.getByRole("button", { name: "1 hour" }).click();
    await expect(row(page, "Alpha")).toContainText(/snoozed/i);
    await page.getByRole("status").filter({ hasText: "Snoozed: Alpha" }).getByRole("button", { name: "Undo" }).click();
    await page.reload();
    await expect(row(page, "Alpha")).not.toContainText(/snoozed/i);
  });

  test("reordering within a day sticks after a reload", async ({ page, request }) => {
    const base = Date.now() - 60_000;
    await startReady(page, request, [
      { title: "Alpha", type: "task", dueAt: new Date(base).toISOString(), allDay: true },
      { title: "Bravo", type: "task", dueAt: new Date(base + 1000).toISOString(), allDay: true },
    ]);
    const titles = () => page.getByTestId("item-row").locator(".line-clamp-2").allTextContents();
    await expect.poll(titles).toEqual(["Alpha", "Bravo"]);
    await page.getByRole("button", { name: /drag to reorder: alpha/i }).focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(titles).toEqual(["Bravo", "Alpha"]);
    await page.waitForTimeout(500);
    await page.reload();
    await expect.poll(titles).toEqual(["Bravo", "Alpha"]);
  });

  test("late items have Do today and Reschedule in one tap", async ({ page, request }) => {
    await startReady(page, request, [{ title: "Old thing", type: "task", dueAt: new Date(Date.now() - 2 * DAY).toISOString() }]);
    await page.getByRole("button", { name: /reschedule/i }).click();
    await expect(page.getByRole("dialog", { name: /move to/i })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: /tomorrow/i }).click();
    await expect(page.getByRole("heading", { name: /^Late/ })).toHaveCount(0);
    await page.getByRole("button", { name: /tomorrow/i }).first().click();
    await expect(row(page, "Old thing")).toBeVisible();
  });
});

test.describe("confetti", () => {
  test.use({ reducedMotion: "no-preference" });
  test("finishing the last item of the day bursts confetti", async ({ page, request }) => {
    await startReady(page, request, [{ title: "Only one", type: "task", dueAt: soon(3) }]);
    // the full opening animation runs here (Reduce Motion is off); wait for it to hand over
    await expect(page.locator(".splash")).toHaveCount(0);
    await swipe(page, "Only one", 150);
    await expect(page.locator(".confetti-piece").first()).toBeAttached();
  });
});

test.describe("opening", () => {
  test("a cold start covers the screen, then hands over; the next page in the same session does not", async ({ page, request }) => {
    await startReady(page, request, []);
    await expect(page.locator("html")).toHaveAttribute("data-splash", "done");
    await expect(page.locator(".splash")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-cold", "0");
  });

  test("the switch in Settings turns it off for the next start", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/settings");
    const sw = page.getByRole("switch", { name: /opening animation/i });
    await expect(sw).toBeChecked();
    await sw.uncheck();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nudge-opening"))).toBe("off");
    // a brand-new session (a cold start) now skips the animation
    const ctx = page.context();
    const fresh = await ctx.newPage();
    await fresh.goto("/");
    await expect(fresh.locator("html")).toHaveAttribute("data-cold", "0");
  });

  test("the launch images for iPhones are linked, light and dark", async ({ page, request }) => {
    await resetApp(request);
    await page.goto("/login");
    const links = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => ({ href: (e as HTMLLinkElement).getAttribute("href"), media: (e as HTMLLinkElement).getAttribute("media") })));
    expect(links.length).toBeGreaterThanOrEqual(24);
    expect(links.some((l) => l.media?.includes("prefers-color-scheme: dark"))).toBe(true);
    for (const l of links.slice(0, 3)) {
      const res = await request.get(l.href!);
      expect(res.ok()).toBe(true);
    }
  });

  test("a greeting with a first name, and the count of what is due", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: true, items: [{ title: "Alpha", dueAt: soon(3) }], profile: { prefs: { first_name: "Adrian" } } });
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/good (morning|afternoon|evening), Adrian/i);
    await expect(page.getByText(/1 thing due today/)).toBeVisible();
  });
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("Today, Add and Settings pass the contrast checks in the dark", async ({ page, request }) => {
    await startReady(page, request, [
      { title: "Essay draft", type: "homework", dueAt: soon(3), courseId: COURSE },
      { title: "Phone bill", type: "payment", dueAt: soon(2), amountCents: 4500 },
      { title: "Old thing", type: "task", dueAt: new Date(Date.now() - 2 * DAY).toISOString() },
    ], "en", ALL, { courses: [{ id: COURSE, name: "English", color: "#ffe6ec" }] });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 18, 15)");
    await noViolations(page, "today dark");
    await page.goto("/add");
    await noViolations(page, "add dark");
    await page.goto("/settings");
    await noViolations(page, "settings dark");
    for (const path of ["/school", "/payments", "/habits", "/upcoming", "/settings/delivery"]) {
      await page.goto(path);
      await noViolations(page, `${path} dark`);
    }
  });
});

test.describe("light mode keeps the cream background", () => {
  test.use({ colorScheme: "light" });
  test("same colours as before", async ({ page, request }) => {
    await startReady(page, request, []);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(250, 248, 245)");
  });
});

test.describe("school polish", () => {
  test("homework with a link shows Where and an Open button that goes to the link", async ({ page, request }) => {
    const items: SeedItem[] = [
      { title: "IXL lesson", type: "homework", dueAt: soon(3), link: "https://www.ixl.com/math/grade-7", hwWhere: "online" },
      { title: "Plain homework", type: "homework", dueAt: soon(4) },
    ];
    await startReady(page, request, items, "en", ALL);
    const hw = row(page, "IXL lesson");
    await expect(hw).toContainText("Online");
    const open = hw.getByRole("link", { name: /open/i });
    await expect(open).toHaveAttribute("href", "https://www.ixl.com/math/grade-7");
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(row(page, "Plain homework").getByRole("link", { name: /open/i })).toHaveCount(0);
  });

  test("a letter average shows the letter and the points, not a percent", async ({ page, request }) => {
    const extra = {
      courses: [{ id: COURSE, name: "Biology", color: "#e6f4ea" }],
      grades: [{ id: "00000000-0000-4000-8000-0000000000e1", course_id: COURSE, title: "Quarter 1 average (B, 2.72)", score: 2.72, out_of: 4, percent: 68, letter: "B", points: 2.72, posted_at: new Date().toISOString(), source: "classroom", comment: null }],
    };
    await startReady(page, request, [], "en", ALL, extra);
    await page.goto("/grades");
    const card = page.getByRole("link", { name: /Biology/ });
    await expect(card).toContainText("B 2.72");
    await expect(card).not.toContainText("68%");
    await expect(card).not.toContainText("D");
  });
});
