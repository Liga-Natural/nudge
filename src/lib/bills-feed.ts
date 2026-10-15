import { z } from "zod";

// What Nudge expects from a Joker "bills feed" address. Documented in docs/JOKER_BILLS_FEED.md.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like "2026-10-20"').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "is not a real date");

const billSchema = z.object({
  id: z.string().trim().min(1, "must not be empty").max(120),
  name: z.string().trim().min(1, "must not be empty").max(200),
  amount_cents: z.number().int("must be a whole number of cents").min(0).max(100_000_000).nullish(),
  currency: z.string().trim().length(3, "must be a 3-letter code like USD").nullish(),
  due_date: date,
  status: z.enum(["unpaid", "paid", "canceled"], { message: 'must be "unpaid", "paid" or "canceled"' }).default("unpaid"),
  paid_on: date.nullish(),
  autopay: z.boolean().nullish(),
  notes: z.string().max(2000).nullish(),
});

const feedSchema = z.object({
  version: z.literal(1).optional(),
  bills: z.array(billSchema).max(500, "has more than 500 bills"),
});

export type Bill = z.infer<typeof billSchema>;

export type BillsParse = { ok: true; bills: Bill[] } | { ok: false; message: string };

export function parseBillsFeed(text: string): BillsParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "The bills link did not return JSON. Check that it is the Joker bills feed address (not a web page)." };
  }
  const wrapped = Array.isArray(raw) ? { bills: raw } : raw;
  const parsed = feedSchema.safeParse(wrapped);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const where = i.path.map((p, n) => (typeof p === "number" ? `[${p + 1}]` : n === 0 ? String(p) : `.${String(p)}`)).join("");
    return { ok: false, message: `The bills feed is not in the expected format: ${where || "top level"} ${i.message}.` };
  }
  const ids = new Set<string>();
  for (const b of parsed.data.bills) {
    if (ids.has(b.id)) return { ok: false, message: `The bills feed lists the id "${b.id}" twice. Every bill needs its own id.` };
    ids.add(b.id);
  }
  return { ok: true, bills: parsed.data.bills };
}

/** The list in the shape the database function wants. */
export function toBillRows(bills: Bill[]) {
  return bills.map((b) => ({
    id: b.id,
    name: b.name,
    amount_cents: b.amount_cents ?? null,
    currency: b.currency?.toUpperCase() ?? "USD",
    due_date: b.due_date,
    status: b.status,
    paid_on: b.paid_on ?? null,
    autopay: b.autopay ?? false,
    notes: b.notes ?? null,
  }));
}
