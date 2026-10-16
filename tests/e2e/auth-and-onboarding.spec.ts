import { expect, test } from "@playwright/test";
import { resetApp, signIn } from "./helpers";

test.describe("sign in", () => {
  test("signed-out visitors land on the login page", async ({ page, request }) => {
    await resetApp(request);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nudge");
  });

  test("a wrong code gives a friendly message", async ({ page, request }) => {
    await resetApp(request);
    await page.goto("/login");
    await page.getByLabel(/your email/i).fill("owner@example.test");
    await page.getByRole("button", { name: /send me a code/i }).click();
    await page.getByLabel(/code from your email/i).fill("000000");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/didn't work/i)).toBeVisible();
  });

  test("a stranger's email looks the same as the owner's (no clues)", async ({ page, request }) => {
    await resetApp(request);
    await page.goto("/login");
    await page.getByLabel(/your email/i).fill("someone-else@example.test");
    await page.getByRole("button", { name: /send me a code/i }).click();
    await expect(page.getByLabel(/code from your email/i)).toBeVisible();
  });
});

test.describe("onboarding", () => {
  test("a new person goes through every step and ends on Today", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: false, items: [] });
    await signIn(page);
    await expect(page).toHaveURL(/\/onboarding/);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nudge");
    await page.getByRole("button", { name: /get started/i }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/track/i);
    await expect(page.getByText(/step 1 of 6/i)).toBeVisible();
    await page.getByRole("checkbox", { name: /homework/i }).click();
    await page.getByRole("checkbox", { name: /payments/i }).click();
    await expect(page.getByRole("checkbox", { name: /homework/i })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: /^next/i }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/nudge/i);
    await page.getByRole("radio", { name: /morning summary/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();

    await expect(page.getByLabel(/morning summary at/i)).toHaveValue("08:00");
    await page.getByRole("button", { name: /^next/i }).click();

    // Quiet hours are a choice of their own.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/quiet/i);
    await expect(page.getByRole("radio", { name: /overnight/i })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /late night/i }).click();
    await page.getByRole("button", { name: /^next/i }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/notifications/i);
    await page.getByRole("button", { name: /skip for now/i }).click();

    await page.getByRole("radio", { name: /simple/i }).click();
    await page.getByRole("button", { name: /finish/i }).click();

    await expect(page.getByText(/setting things up/i)).toBeVisible();
    await page.getByRole("button", { name: /^skip$/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/all set/i);
    await page.getByRole("button", { name: /go to today/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/good (morning|afternoon|evening)/i);
    // Simple mode: Today, Add, Upcoming only (no Settings tab)
    await expect(page.getByRole("navigation").getByRole("link", { name: /settings/i })).toHaveCount(0);
  });

  test("it can be done in Spanish", async ({ page, request }) => {
    await resetApp(request, { action: "seed", onboarded: false, items: [] });
    await signIn(page);
    await page.getByRole("button", { name: "Español" }).click();
    await expect(page.getByRole("button", { name: /empezar/i })).toBeVisible();
    await page.getByRole("button", { name: /empezar/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/seguir/i);
  });
});
