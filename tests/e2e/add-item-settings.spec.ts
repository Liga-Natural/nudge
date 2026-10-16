import { expect, test } from "@playwright/test";
import { startReady } from "./helpers";

test.describe("Add", () => {
  test("plain words become a confirm card, and nothing is saved until Save", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.getByRole("link", { name: "Add" }).click();
    await page.getByLabel(/what should we remember/i).fill("pay water bill friday 5pm $45");
    await page.getByRole("button", { name: /check it/i }).click();

    await expect(page.getByRole("heading", { name: /does this look right/i })).toBeVisible();
    await expect(page.getByLabel("What")).toHaveValue("Pay water bill");
    await expect(page.getByLabel(/amount/i)).toHaveValue("45.00");
    await expect(page.getByRole("button", { name: /payment/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Time")).toHaveValue("17:00");

    // Not saved yet
    await page.goto("/upcoming");
    await expect(page.getByText("Pay water bill")).toHaveCount(0);

    await page.getByRole("link", { name: "Add" }).click();
    await page.getByLabel(/what should we remember/i).fill("pay water bill friday 5pm $45");
    await page.getByRole("button", { name: /check it/i }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/upcoming");
    await expect(page.getByText("Pay water bill")).toBeVisible();
  });

  test("a sentence with no date warns instead of guessing", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("buy a birthday gift");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.getByRole("note")).toContainText(/didn't find a date/i);
  });

  test("a repeating payment is created with a repeat rule", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/add");
    await page.getByLabel(/what should we remember/i).fill("rent every month on the 1st $900");
    await page.getByRole("button", { name: /check it/i }).click();
    await expect(page.locator("#f-repeat option:checked")).toContainText(/every month/i);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/upcoming");
    await expect(page.getByText("Rent").first()).toBeVisible();
  });
});

test.describe("Item detail", () => {
  test("shows details, can be edited, skipped, and deleted", async ({ page, request }) => {
    await startReady(page, request);
    await page.getByRole("button", { name: /this week/i }).click();
    await page.getByRole("link", { name: /dentist visit/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dentist visit");
    await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();

    await page.getByRole("button", { name: /edit/i }).click();
    await page.getByLabel("What").fill("Dentist cleaning");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dentist cleaning");
    await expect(page.getByText("Changed")).toBeVisible();

    await page.getByRole("button", { name: /skip this one/i }).click();
    await expect(page.getByRole("button", { name: /mark not done/i })).toBeVisible();
    await page.getByRole("button", { name: /mark not done/i }).click();
    await expect(page.getByRole("button", { name: /^✓ done$/i })).toBeVisible();

    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("item-row").filter({ hasText: "Dentist cleaning" })).toHaveCount(0);
    // Deleting is undoable for a few seconds.
    await expect(page.getByRole("status").filter({ hasText: "Deleted: Dentist cleaning" })).toBeVisible();
    await page.getByRole("status").filter({ hasText: "Deleted: Dentist cleaning" }).getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: /this week/i }).click();
    await expect(page.getByTestId("item-row").filter({ hasText: "Dentist cleaning" })).toBeVisible();
  });

  test("a made-up address shows a friendly 'not found'", async ({ page, request }) => {
    await startReady(page, request, []);
    await page.goto("/item/00000000-0000-4000-8000-0000000000aa");
    await expect(page.getByText(/couldn't find that one/i)).toBeVisible();
  });
});

test.describe("Upcoming", () => {
  test("lists by day and has a month view", async ({ page, request }) => {
    await startReady(page, request);
    await page.goto("/upcoming");
    await expect(page.getByText("Dentist visit")).toBeVisible();
    await page.getByRole("link", { name: "Month" }).click();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous month" })).toBeVisible();
  });
});

test.describe("Settings", () => {
  test("switching to Español changes the words, and back", async ({ page, request }) => {
    await startReady(page, request);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Español" }).click();
    await expect(page.getByRole("link", { name: /^Hoy$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /tus ajustes/i })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("link", { name: /^Today$/ })).toBeVisible();
  });

  test("can add a space, which then shows as a filter chip", async ({ page, request }) => {
    await startReady(page, request);
    await page.goto("/settings");
    await page.getByLabel("Space name").fill("Liga Natural");
    await page.getByRole("button", { name: "Add space" }).click();
    await expect(page.getByText("Liga Natural").first()).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Liga Natural/ })).toBeVisible();
  });

  test("changing the morning time is remembered", async ({ page, request }) => {
    await startReady(page, request);
    await page.goto("/settings");
    await page.getByLabel("Time", { exact: true }).fill("07:30");
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Time", { exact: true })).toHaveValue("07:30");
  });

  test("delete account asks you to type the word first", async ({ page, request }) => {
    await startReady(page, request);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("button", { name: "Delete everything" })).toBeDisabled();
    await page.locator("#del-word").fill("DELETE");
    await expect(page.getByRole("button", { name: "Delete everything" })).toBeEnabled();
  });
});
