import type { TFn } from "./i18n";
import type { ReminderSpec } from "./reminders";
import type { Lang } from "./time";

/** "18:00" -> "6:00 PM" / "6:00 p. m." — formatted in UTC so it never shifts with the device zone. */
export function formatClock(hhmm: string, lang: Lang): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  );
}

export function describeReminder(spec: ReminderSpec, t: TFn, lang: Lang): string {
  if ("offsetMinutes" in spec) {
    switch (spec.offsetMinutes) {
      case 0:
        return t("reminder.at_time");
      case 10:
        return t("reminder.10_min");
      case 60:
        return t("reminder.1_hour");
      case 1440:
        return t("reminder.1_day");
      default:
        return t("reminder.minutesBefore", { n: spec.offsetMinutes });
    }
  }
  const time = formatClock(spec.atTime, lang);
  if (spec.daysBefore === 0) return t("reminder.sameDayAt", { time });
  if (spec.daysBefore === 1) return t("reminder.oneDayBeforeAt", { time });
  return t("reminder.dayBeforeAt", { days: spec.daysBefore, time });
}
