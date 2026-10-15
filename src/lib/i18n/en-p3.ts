// Phase 3 words (English). Spanish lives in es-p3.ts and must have exactly the same keys.
export const enP3 = {
  // freshness
  "update.available": "Update available — tap to reload",
  "snooze.tonight": "Tonight (8 PM)",
  "snooze.tonightPassed": "It's too late for “tonight”. Pick another time.",

  // quick actions (tapping a notification)
  "quick.title": "Quick actions",
  "quick.done": "Marked done ✓",
  "quick.snoozed": "Snoozed ⏰",

  // delivery log
  "delivery.link": "Delivery log",
  "delivery.link.body": "Did a reminder arrive? See the last 20 tries and why.",
  "delivery.title.pre": "Delivery",
  "delivery.title.accent": "log",
  "delivery.body": "Every time Nudge tried to notify you, newest first. If something never arrived, the reason is here.",
  "delivery.health": "Is this phone ready?",
  "delivery.noPhones": "No phone is signed up for notifications yet. Tap Turn on notifications below.",
  "delivery.phones": "{n} phone(s) signed up ({hosts}).",
  "delivery.keysOk": "Notification keys on the server look right.",
  "delivery.quiet": "Quiet hours {from}–{to}. Urgent items {urgent}.",
  "delivery.urgentOn": "can break through",
  "delivery.urgentOff": "wait for morning",
  "delivery.last": "Last 20 tries",
  "delivery.empty": "Nothing yet. Tap “Send test notification now” above to make the first entry.",
  "delivery.missingSql": "The Delivery log needs the new setup file (0007). Run it in Supabase and reload.",
  "delivery.status.sent": "Delivered",
  "delivery.status.failed": "Failed",
  "delivery.status.held": "Held",
  "delivery.status.skipped": "Not sent",
  "delivery.status.no_phone": "No phone",
  "delivery.kind.reminder": "Reminder",
  "delivery.kind.summary": "Morning summary",
  "delivery.kind.test": "Test",
  "delivery.kind.catchup": "Missed catch-up",
  "delivery.kind.grade": "New grade",
  "delivery.kind.habit": "Habits",
} as const;
