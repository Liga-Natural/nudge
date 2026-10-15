import type { ItemType } from "./parser";
import { addLocalDays, instantToWall, wallToInstant } from "./time";

export type ReminderSpec =
  | { offsetMinutes: number }
  | { daysBefore: number; atTime: string }; // atTime "HH:MM"

export type NudgeStyle = "morning" | "on_time" | "before" | "important";

export const REMINDER_CHOICES: { key: string; spec: ReminderSpec }[] = [
  { key: "at_time", spec: { offsetMinutes: 0 } },
  { key: "10_min", spec: { offsetMinutes: 10 } },
  { key: "1_hour", spec: { offsetMinutes: 60 } },
  { key: "1_day", spec: { offsetMinutes: 1440 } },
];

/**
 * The reminders a new item starts with. Payments: 3 days before and on the day at 9 AM.
 * Homework: the evening before at 6 PM and at the due time. Everything else: at the time.
 * Items with no clock time ("all day") remind at 9 AM that day instead.
 */
export function defaultReminders(type: ItemType, allDay: boolean, style: NudgeStyle = "on_time", subtype: string | null = null): ReminderSpec[] {
  if (type === "birthday") {
    // A heads-up three days before, then the day itself.
    return [
      { daysBefore: 3, atTime: "09:00" },
      { daysBefore: 0, atTime: "09:00" },
    ];
  }
  if (type === "work") {
    if (subtype === "game_day") {
      return allDay
        ? [{ daysBefore: 1, atTime: "18:00" }, { daysBefore: 0, atTime: "08:00" }]
        : [{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 120 }];
    }
    if (subtype === "registration") return [{ daysBefore: 3, atTime: "09:00" }, { daysBefore: 0, atTime: "09:00" }];
    if (subtype === "sponsor") return [{ daysBefore: 0, atTime: "09:00" }];
    return allDay ? [{ daysBefore: 0, atTime: "09:00" }] : [{ offsetMinutes: 30 }];
  }
  if (type === "habit") return allDay ? [{ daysBefore: 0, atTime: "09:00" }] : [{ offsetMinutes: 0 }];
  if (type === "payment") {
    return [
      { daysBefore: 3, atTime: "09:00" },
      { daysBefore: 0, atTime: "09:00" },
    ];
  }
  if (type === "homework") {
    return allDay
      ? [
          { daysBefore: 1, atTime: "18:00" },
          { daysBefore: 0, atTime: "09:00" },
        ]
      : [{ daysBefore: 1, atTime: "18:00" }, { offsetMinutes: 0 }];
  }
  if (type === "renewal") {
    return [
      { daysBefore: 7, atTime: "09:00" },
      { daysBefore: 0, atTime: "09:00" },
    ];
  }
  if (allDay) return [{ daysBefore: 0, atTime: "09:00" }];
  return style === "before" ? [{ offsetMinutes: 30 }, { offsetMinutes: 0 }] : [{ offsetMinutes: 0 }];
}

export function reminderToRow(spec: ReminderSpec) {
  return "offsetMinutes" in spec
    ? { offset_minutes: spec.offsetMinutes, days_before: null, at_time: null }
    : { offset_minutes: null, days_before: spec.daysBefore, at_time: spec.atTime };
}

export function rowToReminder(row: { offset_minutes: number | null; days_before: number | null; at_time: string | null }): ReminderSpec {
  return row.offset_minutes !== null
    ? { offsetMinutes: row.offset_minutes }
    : { daysBefore: row.days_before ?? 0, atTime: (row.at_time ?? "09:00").slice(0, 5) };
}

/** When a reminder fires. Mirrors the SQL in 0004_reminder_clock.sql, and is tested against it. */
export function fireTime(spec: ReminderSpec, dueAt: Date, tz: string): Date {
  if ("offsetMinutes" in spec) return new Date(dueAt.getTime() - spec.offsetMinutes * 60_000);
  const day = addLocalDays(dueAt, tz, -spec.daysBefore);
  const w = instantToWall(day, tz);
  const [h, mi] = spec.atTime.split(":").map(Number);
  return wallToInstant({ ...w, h, mi }, tz);
}
