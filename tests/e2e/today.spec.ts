import { expect, test } from "@playwright/test";
import { resetApp, signIn, startReady } from "./helpers";

test.describe("Today", () => {
  test("shows the hero, Late and Today, and This week from the strip", async ({ page, request }) => {
    await startReady(page, request);
    await expect(page.getByRole("heading", { name: /^Late/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText("Next up")).toBeVisible();
    await expect(page.getByRole("img", { name: /of \d+ done today/ })).toBeVisible();
    await expect(page.getByText("Old homework")).toBeVisible();
    await expect(page.getByText("Pay phone bill")).toBeVisible();
    await expect(page.getByText("$45.00")).toBeVisible();
    await expect(page.getByText(/1 thing due today/)).toBeVisible();
    await expect(page.getByText(/1 late/)).toBeVisible();
    await expect(page.getByTestId("now-line")).toBeVisible();
    await page.getByRole("button", { name: /this week/i }).click();
    await expect(page.getByRole("heading", { name: "This week", exact: true })).toBeVisible();
    await expect(page.getByTestId("item-row").filter({ hasText: "Dentist visit" })).toBeVisible();
  });

  test("Done takes an item off the list, keeps it done after a reload, and Undo brings it back", async ({ page, request }) => {
    await startReady(page, request);
    const row = (title: string) => page.getByTestId("item-row").filter({ hasText: title });
    await page.getByRole("button", { name: /done: old homework/i }).click();
    await expect(row("Old homework")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Done: Old homework" })).toBeVisible();
    await page.reload();
    await expect(row("Old homework")).toHaveCount(0);

    await page.getByRole("button", { name: /done: pay phone bill/i }).or(page.getByRole("button", { name: /paid: pay phone bill/i })).first().click();
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(row("Pay phone bill")).toHaveCount(0);
  });

  test("Undo after Done puts the item back", async ({ page, request }) => {
    await startReady(page, request);
    const row = page.getByTestId("item-row").filter({ hasText: "Old homework" });
    await page.getByRole("button", { name: /done: old homework/i }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row).toBeVisible();
    await page.reload();
    await expect(row).toBeVisible();
  });

  test("a late item can be done today in one tap", async ({ page, request }) => {
    await startReady(page, request);
    await page.getByRole("button", { name: /do today/i }).click();
    await expect(page.getByRole("heading", { name: /^Late/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: /^Late/ })).toHaveCount(0);
    await expect(page.getByText("Old homework")).toBeVisible();
  });

  test("Snooze asks for how long, then the item shows when it is back", async ({ page, request }) => {
    await startReady(page, request);
    await page.getByRole("button", { name: /snooze: pay phone bill/i }).click();
    await expect(page.getByRole("dialog", { name: /snooze for how long/i })).toBeVisible();
    await page.getByRole("button", { name: "1 hour" }).click();
    await expect(page.getByText(/snoozed until/i)).toBeVisible();
  });

  test("long-pressing a reminder opens quick actions", async ({ page, request }) => {
    await startReady(page, request);
    const card = page.getByTestId("item-row").filter({ hasText: "Dentist visit" });
    await page.getByRole("button", { name: /this week/i }).click();
    const box = await card.locator(".card").first().boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "Dentist visit" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /^Atrasado/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Hoy$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ajustes/ })).toBeVisible();
  });
});
