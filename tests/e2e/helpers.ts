import { expect, type Page, type APIRequestContext } from "@playwright/test";

export const OWNER = "owner@example.test";
const DAY = 86_400_000;

export type SeedItem = {
  id?: string;
  occId?: string;
  title: string;
  type?: string;
  dueAt: string;
  allDay?: boolean;
  amountCents?: number;
  autopay?: boolean;
  rrule?: string;
  location?: string;
  subtype?: string;
  courseId?: string;
  occurrences?: { dueAt: string; status?: string }[];
};
export type Extra = Record<string, Record<string, unknown>[]>;

export async function resetApp(request: APIRequestContext, body: { action?: "reset" | "seed" | "needs_sql"; onboarded?: boolean; language?: "en" | "es"; items?: SeedItem[]; features?: Record<string, boolean>; extra?: Extra; profile?: Record<string, unknown> } = {}) {
  const res = await request.post("/api/test", { data: { action: "reset", ...body } });
  expect(res.ok()).toBeTruthy();
}

/** The usual three-section day: one late item, one for today, one for later this week. */
export function typicalDay(): SeedItem[] {
  const now = Date.now();
  return [
    { title: "Old homework", type: "homework", dueAt: new Date(now - 2 * DAY).toISOString() },
    { title: "Pay phone bill", type: "payment", dueAt: new Date(now).toISOString(), amountCents: 4500 },
    { title: "Dentist visit", type: "event", dueAt: new Date(now + 3 * DAY).toISOString() },
  ];
}

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/your email|tu correo/i).fill(OWNER);
  await page.getByRole("button", { name: /send me a code|envíame un código/i }).click();
  await page.getByLabel(/code from your email|código de tu correo/i).fill("123456");
  await page.getByRole("button", { name: /^(sign in|entrar)$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function startReady(page: Page, request: APIRequestContext, items: SeedItem[] = typicalDay(), language: "en" | "es" = "en", features: Record<string, boolean> = {}, extra: Extra = {}) {
  await resetApp(request, { action: "seed", onboarded: true, items, language, features, extra });
  await signIn(page);
}
