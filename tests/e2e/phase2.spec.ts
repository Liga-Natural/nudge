import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startReady, type SeedItem } from "./helpers";

const DAY = 86_400_000;
const ALL = { payments: true, school: true, feeds: true, updates: true };

function items(): SeedItem[] {
  const now = Date.now();
  return [
    { title: "Phone bill", type: "payment", dueAt: new Date(now + DAY).toISOString(), amountCents: 4500 },
    { title: "Netflix", type: "payment", dueAt: new Date(now + 2 * DAY).toISOString(), amountCents: 1599, autopay: true },
    { title: "Late rent", type: "payment", dueAt: new Date(now - 2 * DAY).toISOString(), amountCents: 90000 },
    { title: "Math midterm", type: "homework", dueAt: new Date(now + 3 * DAY).toISOString() },
    { title: "Essay draft", type: "homework", dueAt: new Date(now + 4 * DAY).toISOString() },
  ];
}

async function noViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), name).toEqual([]);
}

test.describe("features are off until switched on", () => {
  test("pages explain how to turn them on, and Settings has the switches", async ({ page, request }) => {
    await startReady(page, request, items());
    await expect(page.getByRole("link", { name: /Payments/ })).toHaveCount(0);
    await page.goto("/payments");
    await expect(page.getByRole("link", { name: /Settings → Features/ })).toBeVisible();
    await page.goto("/settings");
    const payments = page.getByRole("switch", { name: /^Payments/ });
    await expect(payments).not.toBeChecked();
    await payments.check();
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "More" }).getByRole("link", { name: /Payments/ })).toBeVisible();
  });
});

test.describe("payments", () => {
  test("totals, autopay chip, and the Paid button", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL);
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /your payments/i })).toBeVisible();
    await expect(page.getByText("Late rent")).toBeVisible();
    await expect(page.getByText("Autopay", { exact: true })).toBeVisible();
    // Next 7 days: 45.00 + 15.99 = 60.99
    await expect(page.getByText("$60.99").first()).toBeVisible();

    await page.getByRole("button", { name: /paid: phone bill/i }).click();
    await expect(page.getByRole("dialog", { name: /mark as paid/i })).toBeVisible();
    await expect(page.getByLabel("Amount paid ($)")).toHaveValue("45.00");
    await page.getByLabel("Amount paid ($)").fill("44.50");
    await page.getByRole("button", { name: /save payment/i }).click();

    await expect(page.getByRole("button", { name: /paid: phone bill/i })).toHaveCount(0);
    await expect(page.getByText(/\$44\.50 on/)).toBeVisible();

    await page.goto("/updates");
    await expect(page.getByText("Phone bill")).toBeVisible();
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  });
});

test.describe("school", () => {
  test("courses, exams and assignments", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL);
    await page.goto("/school");
    await expect(page.getByRole("heading", { name: /your school/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming exams" })).toBeVisible();
    await expect(page.getByText("Math midterm").first()).toBeVisible();
    await expect(page.getByText("Essay draft")).toBeVisible();
    await page.getByLabel("Course name").fill("Math 101");
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByText("Math 101")).toBeVisible();

    // Give the essay a course from its own page
    await page.getByRole("link", { name: /essay draft/i }).click();
    await page.getByRole("button", { name: /edit/i }).click();
    await page.getByLabel("Course", { exact: true }).selectOption({ label: "Math 101" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.goto("/school");
    await expect(page.getByRole("heading", { level: 3, name: "Math 101" })).toBeVisible();
  });

  test("a homework item offers 'start early'", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("science project due friday");
    await page.getByRole("button", { name: /check it/i }).click();
    const early = page.getByRole("button", { name: /start early/i });
    await early.click();
    await expect(early).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("calendar feeds", () => {
  test("add one, see it, check now, remove it; unsafe links are refused", async ({ page, request }) => {
    await startReady(page, request, [], "en", ALL);
    await page.goto("/settings");
    await page.getByLabel("Name", { exact: true }).fill("Canvas");
    await page.getByLabel("Calendar link").fill("http://school.example/cal.ics");
    await page.getByRole("button", { name: "Add feed" }).click();
    await expect(page.getByText(/must start with https/i)).toBeVisible();

    await page.getByLabel("Calendar link").fill("https://localhost/cal.ics");
    await page.getByRole("button", { name: "Add feed" }).click();
    await expect(page.getByText(/isn't allowed/i)).toBeVisible();

    await page.getByLabel("Calendar link").fill("webcal://school.example/cal.ics?token=secret123");
    await page.getByRole("button", { name: "Add feed" }).click();
    await expect(page.getByText("school.example")).toBeVisible();
    await expect(page.getByText("secret123")).toHaveCount(0); // the address itself is never shown back
    await expect(page.getByText(/not checked yet/i)).toBeVisible();
    await page.getByRole("button", { name: "Check now" }).click();
    await page.getByRole("button", { name: /remove: canvas/i }).click();
    await expect(page.getByText("No feeds yet.")).toBeVisible();
  });
});

test.describe("accessibility of the new pages", () => {
  test("payments, school, updates, settings with everything on", async ({ page, request }) => {
    await startReady(page, request, items(), "en", ALL);
    for (const path of ["/payments", "/school", "/updates", "/settings"]) {
      await page.goto(path);
      await noViolations(page, path);
    }
    await page.goto("/payments");
    await page.getByRole("button", { name: /paid: phone bill/i }).click();
    await noViolations(page, "paid sheet");
    await page.goto("/");
    await noViolations(page, "today with More links");
  });

  test("Spanish payments page", async ({ page, request }) => {
    await startReady(page, request, items(), "es", ALL);
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /tus pagos/i })).toBeVisible();
    await noViolations(page, "pagos");
  });
});
