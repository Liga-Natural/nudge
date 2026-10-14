import { z } from "zod";
import { parseRule } from "./recurrence";
import { reminderToRow, type ReminderSpec } from "./reminders";
import { wallToInstant } from "./time";

export const reminderSpecSchema = z.union([
  z.object({ offsetMinutes: z.number().int().min(0).max(525600) }),
  z.object({ daysBefore: z.number().int().min(0).max(365), atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
]);

export const itemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["task", "homework", "payment", "package", "event", "renewal"]),
  /** Local date and time in the person's own zone: "YYYY-MM-DDTHH:mm", or empty for no date. */
  dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable(),
  allDay: z.boolean(),
  amountCents: z.number().int().min(0).max(100_000_000).nullable(),
  rrule: z
    .string()
    .max(300)
    .nullable()
    .refine((v) => v === null || parseRule(v) !== null, "Bad repeat rule"),
  spaceId: z.string().uuid().nullable(),
  notes: z.string().max(5000).nullable(),
  reminders: z.array(reminderSpecSchema).max(8),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

/** Turns the form's local date/time into a real moment, in the person's time zone. */
export function dueInstant(dueLocal: string | null, allDay: boolean, tz: string): Date | null {
  if (!dueLocal) return null;
  const [date, time] = dueLocal.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = allDay || !time ? [23, 59] : time.split(":").map(Number);
  return wallToInstant({ y, m, d, h, mi }, tz);
}

/** Splits a stored moment back into form fields. */
export function toDueLocal(dueAt: Date, allDay: boolean, parts: { y: number; m: number; d: number; h: number; mi: number }) {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const date = `${p(parts.y, 4)}-${p(parts.m)}-${p(parts.d)}`;
  return allDay ? date : `${date}T${p(parts.h)}:${p(parts.mi)}`;
}

export function dedupeReminders(specs: ReminderSpec[]): ReminderSpec[] {
  const seen = new Set<string>();
  return specs.filter((s) => {
    const key = JSON.stringify(reminderToRow(s));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
