import { parseRule, ruleToString } from "./recurrence";
import { defaultReminders, reminderToRow, type ReminderSpec } from "./reminders";
import { instantToWall, wallToInstant } from "./time";
import type { ItemType } from "./parser";

// Reads a calendar feed (.ics) into plain events. Only what Nudge needs: title, due time, notes,
// repeat rule, cancelled. Everything else in the file is ignored.

export type FeedEvent = {
  uid: string;
  title: string;
  due_at: string; // ISO moment
  all_day: boolean;
  notes: string | null;
  rrule: string | null;
  cancelled: boolean;
  amount_cents: number | null;
  type: ItemType | null;
  reminders: ReturnType<typeof reminderToRow>[];
};

type Line = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseLine(line: string): Line | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  // Colons can appear inside quoted parameter values; find the first one outside quotes.
  let inQuote = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) {
      split = i;
      break;
    }
  }
  if (split < 1) return null;
  const head = line.slice(0, split).split(";");
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(split + 1) };
}

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

function validZone(tz: string | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** DTSTART in any of its forms -> a moment plus whether it was a whole day. */
export function parseIcsDate(line: Line, userTz: string): { at: Date; allDay: boolean } | null {
  const v = line.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || line.params.VALUE === "DATE") {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    // A whole-day event is due at the end of that day for the person.
    return { at: wallToInstant({ y: +m[1], m: +m[2], d: +m[3], h: 23, mi: 59 }, userTz), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  if (m[7]) return { at: new Date(Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, +(m[6] ?? 0))), allDay: false };
  const zone = validZone(line.params.TZID) ?? userTz;
  return { at: wallToInstant(wall, zone), allDay: false };
}

function amountFrom(...texts: (string | null)[]): number | null {
  for (const t of texts) {
    const m = t ? /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(t) : null;
    if (m) return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
  }
  return null;
}

export function parseIcs(
  text: string,
  opts: { userTz: string; defaultType: ItemType; now: Date; backDays?: number; maxForwardDays?: number; reminders?: ReminderSpec[] },
): FeedEvent[] {
  const lines = unfold(text);
  const events: FeedEvent[] = [];
  const from = opts.now.getTime() - (opts.backDays ?? 2) * 86400000;
  const to = opts.now.getTime() + (opts.maxForwardDays ?? 400) * 86400000;

  let current: Line[] | null = null;
  for (const raw of lines) {
    const upper = raw.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT" && current) {
      const get = (n: string) => current!.find((l) => l.name === n);
      const uid = get("UID")?.value.trim();
      const start = get("DTSTART");
      const summary = get("SUMMARY");
      // Individual changed copies of a repeating event: skip, the main event covers the series.
      const isOverride = !!get("RECURRENCE-ID");
      if (uid && start && summary && !isOverride) {
        const when = parseIcsDate(start, opts.userTz);
        if (when) {
          const rule = get("RRULE") ? parseRule(get("RRULE")!.value) : null;
          const cancelled = get("STATUS")?.value.trim().toUpperCase() === "CANCELLED";
          const inWindow = rule || (when.at.getTime() >= from && when.at.getTime() <= to);
          if (inWindow || cancelled) {
            const title = unescapeText(summary.value);
            const notes = get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!.value) : null;
            const amount = amountFrom(title, notes);
            const type = amount !== null && opts.defaultType === "task" ? "payment" : opts.defaultType;
            events.push({
              uid,
              title,
              due_at: when.at.toISOString(),
              all_day: when.allDay,
              notes: notes ? notes.slice(0, 2000) : null,
              rrule: rule ? ruleToString(rule) : null,
              cancelled,
              amount_cents: amount,
              type,
              reminders: (opts.reminders ?? defaultReminders(type, when.allDay)).map(reminderToRow),
            });
          }
        }
      }
      current = null;
      continue;
    }
    if (current) {
      const parsed = parseLine(raw);
      if (parsed) current.push(parsed);
    }
  }
  return events;
}

/** Used by tests and the preview: how a feed event reads for a person. */
export const describeFeedEvent = (e: FeedEvent, tz: string) => {
  const w = instantToWall(new Date(e.due_at), tz);
  return `${e.title} (${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")})`;
};
