import type { ItemType } from "./parser";
import type { Lang } from "./i18n";
import type { NudgeStyle } from "./reminders";

export type Profile = {
  user_id: string;
  timezone: string;
  language: Lang;
  mode: "simple" | "full";
  track_types: string[];
  nudge_style: NudgeStyle;
  morning_enabled: boolean;
  morning_time: string; // "08:00:00"
  quiet_start: string;
  quiet_end: string;
  urgent_override: boolean;
  type_switches: Record<string, boolean>;
  onboarded: boolean;
};

export type Space = {
  id: string;
  name: string;
  emoji: string;
  is_default: boolean;
  notifications_enabled: boolean;
  sort_order: number;
};

export type ItemRow = {
  id: string;
  space_id: string | null;
  type: ItemType;
  title: string;
  notes: string | null;
  due_at: string | null;
  all_day: boolean;
  timezone: string;
  status: "open" | "done" | "skipped" | "archived";
  priority: number;
  amount_cents: number | null;
  currency: string;
  rrule: string | null;
};

export type OccurrenceRow = {
  id: string;
  item_id: string;
  due_at: string;
  status: "open" | "done" | "skipped";
  snoozed_until: string | null;
  snooze_count: number;
  done_at: string | null;
};

export type ReminderDbRow = {
  id: string;
  item_id: string;
  offset_minutes: number | null;
  days_before: number | null;
  at_time: string | null;
};

export type EventRow = {
  id: string;
  item_id: string;
  kind: "created" | "done" | "skipped" | "snoozed" | "reopened" | "edited";
  detail: string | null;
  created_at: string;
};

/** One line on Today / Upcoming: a single time something is due. */
export type AgendaEntry = {
  occId: string;
  itemId: string;
  title: string;
  type: ItemType;
  dueAt: string;
  allDay: boolean;
  amountCents: number | null;
  currency: string;
  spaceId: string | null;
  snoozedUntil: string | null;
  recurring: boolean;
  priority: number;
};

export const ITEM_TYPES: ItemType[] = ["task", "homework", "payment", "event", "renewal"];
export const TYPE_EMOJI: Record<string, string> = {
  task: "✅",
  homework: "📚",
  payment: "💳",
  package: "📦",
  event: "📅",
  renewal: "🔁",
};
export const TYPE_BG: Record<string, string> = {
  task: "bg-task",
  homework: "bg-hw",
  payment: "bg-pay",
  package: "bg-pkg",
  event: "bg-event",
  renewal: "bg-renewal",
};
