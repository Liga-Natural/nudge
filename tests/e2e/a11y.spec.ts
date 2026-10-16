import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetApp, signIn, startReady } from "./helpers";

async function checkA11y(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `${name} has accessibility problems`).toEqual([]);
}

test.describe("accessibility (axe)", () => {
  test("login", async ({ page, request }) => {
    await resetApp(request);
    await page.goto("/login");
    await checkA11y(page, "login");
  });

  test("onboarding steps", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: false, items: [] });
    await signIn(page);
    await checkA11y(page, "onboarding welcome");
    await page.getByRole("button", { name: /get started/i }).click();
    await checkA11y(page, "onboarding track");
    await page.getByRole("button", { name: /^next/i }).click();
    await checkA11y(page, "onboarding nudge");
    await page.getByRole("button", { name: /^next/i }).click();
    await checkA11y(page, "onboarding times");
    await page.getByRole("button", { name: /^next/i }).click();
    await checkA11y(page, "onboarding quiet hours");
    await page.getByRole("button", { name: /^next/i }).click();
    await checkA11y(page, "onboarding notifications");
    await page.getByRole("button", { name: /skip for now/i }).click();
    await checkA11y(page, "onboarding mode");
  });

  test("Today, Upcoming (list and month), Add, Item and Settings", async ({ page, request }) => {
    await startReady(page, request);
    await checkA11y(page, "today");
    await page.goto("/upcoming");
    await checkA11y(page, "upcoming list");
    await page.getByRole("link", { name: "Month" }).click();
    await checkA11y(page, "upcoming month");
    await page.goto("/add");
    await checkA11y(page, "add");
    await page.getByLabel(/what should we remember/i).fill("pay phone bill friday 5pm $45");
    await page.getByRole("button", { name: /check it/i }).click();
    await checkA11y(page, "add confirm");
    await page.goto("/");
    await page.getByRole("link", { name: /dentist visit/i }).click();
    await checkA11y(page, "item");
    await page.goto("/settings");
    await checkA11y(page, "settings");
    await page.goto("/privacy");
    await checkA11y(page, "privacy");
  });

  test("Today in Spanish and the setup message", async ({ page, request }) => {
    await startReady(page, request, undefined, "es");
    await checkA11y(page, "hoy");
    await resetApp(request, { action: "needs_sql" });
    await page.reload();
    await checkA11y(page, "setup message");
  });
});

test.describe("phone width", () => {
  test("no sideways scrolling and big enough tap targets on Today", async ({ page, request }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await startReady(page, request);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("a, button")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ el }) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40)),
    );
    expect(small).toEqual([]);
  });
});
