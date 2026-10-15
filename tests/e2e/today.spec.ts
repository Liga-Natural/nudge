import { expect, test } from "@playwright/test";
import { resetApp, signIn, startReady } from "./helpers";

test.describe("Today", () => {
  test("shows Late, Today and Next 7 days, with the summary line", async ({ page, request }) => {
    await startReady(page, request);
    await expect(page.getByRole("heading", { name: "Late" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next 7 days" })).toBeVisible();
    await expect(page.getByText("Old homework")).toBeVisible();
    await expect(page.getByText("Pay phone bill")).toBeVisible();
    await expect(page.getByText("$45.00")).toBeVisible();
    await expect(page.getByText(/1 thing today/)).toBeVisible();
    await expect(page.getByText(/1 late/)).toBeVisible();
  });

  test("Done takes an item off the list and keeps it done after a reload", async ({ page, request }) => {
    await startReady(page, request);
    await page.getByRole("button", { name: /done: pay phone bill/i }).click();
    await expect(page.getByText("Pay phone bill")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Pay phone bill")).toHaveCount(0);
    await expect(page.getByText("Old homework")).toBeVisible();
  });

  test("Snooze asks for how long, then the item shows when it is back", async ({ page, request }) => {
    await startReady(page, request);
    await page.getByRole("button", { name: /snooze: pay phone bill/i }).click();
    await expect(page.getByRole("dialog", { name: /snooze for how long/i })).toBeVisible();
    await page.getByRole("button", { name: "1 hour" }).click();
    await expect(page.getByText(/snoozed until/i)).toBeVisible();
  });

  test("an empty day says so kindly", async ({ page, request }) => {
    await startReady(page, request, []);
    await expect(page.getByRole("heading", { name: /all clear/i })).toBeVisible();
    await expect(page.getByText(/nothing due today/i)).toBeVisible();
  });

  test("the setup message appears (instead of a crash) before the SQL is run", async ({ page, request }) => {
    await resetApp(request, { action: "seed", items: [] });
    await signIn(page);
    await resetApp(request, { action: "needs_sql" });
    await page.reload();
    await expect(page.getByRole("heading", { name: /one more setup step/i })).toBeVisible();
    await expect(page.getByText("0003_core_tables.sql")).toBeVisible();
  });

  test("the whole page speaks Spanish for a Spanish profile", async ({ page, request }) => {
    await startReady(page, request, undefined, "es");
    await expect(page.getByRole("heading", { name: "Atrasado" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Hoy$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ajustes/ })).toBeVisible();
  });
});
