import type { ItemType } from "./parser";
import type { Lang } from "./i18n";
import type { NudgeStyle } from "./reminders";
import type { FeatureKey } from "./features";

export type Prefs = {
  hw_night_time?: string;
  hw_hours_before?: number;
  habit_summary?: boolean;
  habit_summary_time?: string;
};

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
  features: Record<string, boolean>;
  /** Small settings: hw_night_time ("18:00" or "off"), hw_hours_before (0 = off), habit_summary, habit_summary_time. */
  prefs: Prefs;
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
  autopay: boolean;
  course_id: string | null;
  source?: string;
  feed_id?: string | null;
  location?: string | null;
  subtype?: string | null;
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
  courseId: string | null;
  autopay: boolean;
};

export type Course = { id: string; name: string; color: string };
export type UpdateRow = { id: string; kind: "new_item" | "changed" | "removed" | "paid" | "info"; title: string; body: string | null; item_id: string | null; created_at: string; read_at: string | null };
export type FeedRow = { id: string; name: string; host: string; default_type: string; enabled: boolean; last_synced_at: string | null; last_error: string | null; item_count: number };

export const ITEM_TYPES: ItemType[] = ["task", "homework", "payment", "event", "renewal", "work", "habit", "birthday"];

/** Types that appear in the "add" form only once their feature is switched on. */
export const TYPE_FEATURE: Partial<Record<ItemType, FeatureKey>> = {
  work: "work",
  habit: "habits",
  birthday: "birthdays",
  renewal: "renewals",
};
export const TYPE_EMOJI: Record<string, string> = {
  task: "✅",
  homework: "📚",
  payment: "💳",
  package: "📦",
  event: "📅",
  renewal: "🔁",
  work: "💼",
  habit: "🌱",
  birthday: "🎂",
};
export const TYPE_BG: Record<string, string> = {
  task: "bg-task",
  homework: "bg-hw",
  payment: "bg-pay",
  package: "bg-pkg",
  event: "bg-event",
  renewal: "bg-renewal",
  work: "bg-work",
  habit: "bg-habit",
  birthday: "bg-birthday",
};

/** The kinds of reminder shown in the Add form: the core ones, plus any whose feature is switched on. */
export function enabledItemTypes(features: Record<string, boolean> | undefined): ItemType[] {
  return ITEM_TYPES.filter((ty) => {
    const feature = TYPE_FEATURE[ty];
    return !feature || features?.[feature] === true;
  });
}

export type ChecklistRow = { id: string; item_id: string; text: string; done: boolean; sort_order: number };
export type GradeRowDb = {
  id: string;
  course_id: string | null;
  title: string;
  score: number | string;
  out_of: number | string;
  percent: number | string;
  posted_at: string;
  source: string;
  comment: string | null;
};
export type TokenRow = { id: string; name: string; token_prefix: string; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null };
