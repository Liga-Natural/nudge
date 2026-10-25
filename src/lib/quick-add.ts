import type { FeatureKey } from "./features";
import type { ItemInput } from "./item-input";
import { dedupeReminders, toDueLocal } from "./item-input";
import { parseQuickAdd, type ItemType, type ParsedItem } from "./parser";
import { defaultReminders, type NudgeStyle, type ReminderSpec } from "./reminders";
import { instantToWall } from "./time";
import { TYPE_FEATURE } from "./types";

export type QuickForm = Omit<ItemInput, "spaceId"> & { warnings: ParsedItem["warnings"] };

/** A kind of reminder that is not switched on is offered as the plain kind instead. */
export function gateType(parsed: ItemType, isOn: (f: FeatureKey) => boolean): ItemType {
  const wanted: ItemType = parsed === "package" ? "task" : parsed;
  const gate = TYPE_FEATURE[wanted];
  return gate && !isOn(gate) ? (wanted === "birthday" ? "event" : "task") : wanted;
}

type QuickOpts = { tz: string; nudgeStyle: NudgeStyle; courses: { id: string; name: string }[]; isOn: (f: FeatureKey) => boolean };

/** Turns what the parser read into a complete item, the same way for the full form and the quick bar. */
export function buildQuickInput(p: ParsedItem, raw: string, o: QuickOpts): QuickForm {
  const type = gateType(p.type, o.isOn);
  const subtype = type === "work" ? p.subtype : null;
  const reminders: ReminderSpec[] = p.dueAt ? defaultReminders(type, p.allDay, o.nudgeStyle, subtype) : [];
  if (p.dueAt && p.reminderOffsetMinutes) reminders.push({ offsetMinutes: p.reminderOffsetMinutes });
  const w = p.dueAt ? instantToWall(p.dueAt, o.tz) : null;
  return {
    title: p.title || raw,
    type,
    subtype,
    location: p.location,
    link: type === "homework" ? p.link : null,
    where: null,
    checklist: [],
    dueLocal: p.dueAt && w ? toDueLocal(p.dueAt, p.allDay, w) : null,
    allDay: p.allDay,
    amountCents: p.amountCents,
    rrule: type === "birthday" ? (p.rrule ?? "FREQ=YEARLY") : p.rrule,
    notes: p.trackingNumber ? `Tracking number: ${p.trackingNumber}` : null,
    autopay: false,
    courseId: type === "homework" ? (o.courses.find((c) => c.name === p.courseName)?.id ?? null) : null,
    reminders: dedupeReminders(reminders),
    warnings: p.warnings,
  };
}

export type QuickPreview = {
  type: ItemType;
  title: string;
  dueAt: Date | null;
  allDay: boolean;
  courseId: string | null;
  amountCents: number | null;
  link: string | null;
  past: boolean;
};

/** What the chip under the quick bar shows while typing: the kind, when, and which class. Null for an empty bar. */
export function quickPreview(text: string, o: { now: Date; tz: string; courses: { id: string; name: string }[]; isOn: (f: FeatureKey) => boolean }): QuickPreview | null {
  const clean = text.trim();
  if (!clean) return null;
  const p = parseQuickAdd(clean.slice(0, 500), { now: o.now, tz: o.tz, lang: "auto", courses: o.courses.map((c) => c.name) });
  const type = gateType(p.type, o.isOn);
  return {
    type,
    title: p.title || clean,
    dueAt: p.dueAt,
    allDay: p.allDay,
    courseId: type === "homework" ? (o.courses.find((c) => c.name === p.courseName)?.id ?? null) : null,
    amountCents: p.amountCents,
    link: type === "homework" ? p.link : null,
    past: p.warnings.includes("past"),
  };
}
