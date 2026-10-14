# NIGHT_LOG — Nudge

## HANDOFF — read this first (overnight run, Oct 14, 2026)

**Status when I last updated this:** Phase 1 is built, tested and pushed on branch `phase-1`. Nothing but PR #1 (Phase 0) was merged, as you allowed. Nothing in your real Supabase or Vercel was touched.

### Branches
| Branch | What it has | Green? |
|---|---|---|
| `main` | Phase 0 (login, install, test notification). Merged from PR #1. | yes |
| `phase-1` | Everything below: core reminders. Pushed. | typecheck, lint, 125 unit and database tests, 36 browser tests (phone + desktop, accessibility), real build with secrets check. GitHub CI passed on the first push. |
| `phase-2` | (see the Phase 2 section further down, if started) | see below |

### What Phase 1 contains
- Today (Late / Today / Next 7 days, summary line, swipe or tap to Done, Snooze sheet), Upcoming (list with 7-day strip, month view with dots), Add (plain words → confirm card → Save), Item detail (edit, reminders, history, Done / Skip / Snooze / Mark not done / Delete), Settings (language, Simple/Full, notifications, morning summary, quiet hours, nudge style, per-type switches, spaces, time zone, export JSON/CSV, delete account), onboarding (7 steps, setup ring), English + Español for everything.
- The reminder clock: database functions (file 0004) + `/api/dispatch` + a pg_cron job every minute (file 0005). One push per person per minute, never twice (database unique key), retried on failure, quiet hours hold non-urgent ones until morning, daily catch-up labelled "Missed while you were away", morning summary once a day.
- Daily health check (`/api/cron/daily`, 12:00 UTC): emails you if the database does not answer ("Nudge's database is paused, restore it in the Supabase dashboard") or the minute clock has been silent for 15 minutes; then runs the catch-up.
- Safety: row level security on every table, `supabase/tests/rls_check.sql` returns 0 rows, rate limits, CSP with a fresh nonce on every page, security headers, build-time check that nothing private (and no test-mode code) reaches the browser.
- Until you run the new SQL the app shows a friendly "one more setup step" page instead of crashing.

### Run these SQL files, in this order (Supabase → SQL Editor → New query, one file at a time)
1. `supabase/migrations/0003_core_tables.sql`  — tables for profile, spaces, items, reminders, history.
2. `supabase/migrations/0004_reminder_clock.sql` — the clock's functions and send records.
3. (do the "switch on the clock" steps below)
4. `supabase/migrations/0005_clock_schedule.sql` — starts the every-minute job. It refuses to run until the two Vault secrets exist.
(0001 and 0002 you already ran. After each file, you should see "Success". Then optionally run `supabase/tests/rls_check.sql`: it must return **no rows**.)

### Switch on the clock (once, after 0003 and 0004)
New environment variables in Vercel (Settings → Environment Variables; mark the secret ones Sensitive; Production + Preview). Never paste values in chat.
- `SUPABASE_SECRET_KEY` — Supabase → Project Settings → API Keys → the **secret** key (starts `sb_secret_`). Server only.
- `CRON_SECRET` — make one on your computer without showing it: in PowerShell run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | clip` and paste it into Vercel. Keep it on the clipboard for the next step.
- For the health-check emails (same Gmail you use for login): `SMTP_HOST` = smtp.gmail.com, `SMTP_PORT` = the port that worked for login, `SMTP_USER` = your Gmail address, `SMTP_PASS` = the Gmail app password. Optional: `ALERT_EMAIL` (defaults to OWNER_EMAIL).
Then redeploy in Vercel. In Supabase → Project Settings → Vault (or Integrations → Vault) → **Add new secret**, two of them:
- name `nudge_app_url`, value = your site address with no slash at the end (for example https://nudge-ivory.vercel.app)
- name `nudge_cron_secret`, value = the same value as CRON_SECRET (paste from the clipboard)
If pg_cron / pg_net are not on yet: Supabase → Database → Extensions → switch on **pg_cron** and **pg_net**. Now run `0005_clock_schedule.sql`.
Check it works: a minute later Supabase → SQL Editor: `select * from public.dispatch_log order by id desc limit 5;` should show a new row each minute (the clock is ticking).

### Which address to test on
Vercel Production is still set to whatever you chose (main = Phase 0 app). To try Phase 1 on your phone: either change Vercel's Production branch to `phase-1` (Settings → Environments → Production → Branch Tracking), or merge phase-1 into main yourself when happy (I did not). Preview addresses for phase-1 also exist but ask you to log into Vercel.

### 5-minute phone checklist
1. Open Nudge from the Home Screen icon; sign in with the emailed code. First time: walk through the 7 onboarding steps (try Español on the first screen).
2. Add: "pay phone bill friday 5pm $45" → check the card shows Payment, $45.00, Friday 5:00 PM → Save. It appears in Today/Upcoming.
3. Add: "math homework due tomorrow" → Save. Add "dentist 10 minutes from now" style item for a real timing test: pick today, a time 3 minutes ahead, reminder "At the time" → lock the phone → a notification should arrive at that minute, once.
4. Swipe an item right (or tap ✓) → it disappears; reopen it from Upcoming → "Mark not done".
5. Tap ⏰ → "10 minutes" → the row shows "Snoozed until …" and pings again then.
6. Settings: switch to Español and back; set quiet hours to include now and add a reminder 2 hours ahead → it should wait until quiet hours end; "Send me a test notification" still works.
7. Next morning: the morning summary arrives at your chosen time (once).

IGHT_LOG — Nudge

## Decisions I made (overnight run)
- **Merged PR #1** (phase-0-setup → main) because you allowed that one merge. Branch protection was not touched.
- **Reminder times are stored two ways**: "N minutes before" or "N days before at a clock time". That is how "payments: 3 days before at 9 AM" and "homework: evening before at 6 PM" can be exact across clock changes.
- **Items with no clock time are "all day"** and are stored as 11:59 PM in your time zone, so they are "late" only after midnight; their reminders default to 9 AM that day.
- **A reminder due within 1 hour counts as urgent**, so with "let urgent things through" on, an at-the-time reminder always rings even in quiet hours; earlier ones (e.g. "1 day before at 11 PM") wait until quiet hours end.
- **Nudge styles**: "Right on time" and "A little before" only change the default reminders for new items; "Morning summary" mutes everything except priority-2 items; "Only important" only sends priority ≥ 1 items. (There is no priority picker in Phase 1, so those two styles mostly mute; tell me if you want a priority control.)
- **Crash safety**: if the clock claims a reminder and then crashes before sending, the next minutes retry it after 3 minutes (up to 2 times). In the very rare case the push actually left before the crash, you could get one duplicate; I chose that over losing a reminder.
- **Morning summary**: skipped when nothing is due, late, or a payment is coming; may be up to 90 minutes late if the clock was down; ignores quiet hours (you chose that time yourself).
- **Quick add parser**: a date that is already past is flagged "past" instead of silently moving to next year (unless it is more than 60 days back). Tracking numbers are recognised but saved as a plain task with the number in the notes until Phase 3.
- **Day 31 repeats** use the last day of short months. A repeating item that starts in the past only creates occurrences from today on (no pile of old "late" copies).
- **Rate limits** count per server instance (in memory). Good enough for one person; not a defence against a determined attacker. Login: 6 code requests / 10 min / address.
- **Test mode**: browser tests use a pretend database built only when NUDGE_E2E=1 is set at build time. A normal build physically contains none of it, and `npm run check:secrets` fails the build if it does.
- **No shadcn/ui**: I wrote small components (tiles, buttons, sheet) instead; same look, far less code in the phone bundle.
- **Swipe gestures** work with touch and mouse; every swipe action also has a visible button (✓ and ⏰) for accessibility.
- **Vercel cron** runs the daily check at 12:00 UTC (8 AM New York in summer). Hobby allows ±59 minutes.
- **pg_cron cleanup** at 07:15 UTC (3:15 AM in summer, 2:15 AM in winter): clock logs older than 7 days, dispatch_log older than 30 days, send records older than 90 days.

## Blocked
- Nothing blocked so far. Things I could not do without your accounts: run the new SQL, set Vercel variables, create Vault secrets, test real notifications (all listed above for you).

## Not verified (needs your real Supabase / phone)
- The app against real Supabase (I tested the SQL on a real Postgres engine, PGlite, and the screens against a pretend database). Possible small surprises: a PostgREST permission or cache hiccup the first time; tell me the exact message.
- Real push delivery from the every-minute clock, and the Gmail alert email.
- Lighthouse mobile score; Today's database calls are 3 (profile, then occurrences + spaces together, then items) plus one login check, within the limit of 5, but not measured on the real database.
- Whether the free plan counts the minute clock as "activity" (Supabase's docs do not say); the daily email check is the safety net.
- Only English/Spanish wording was reviewed by me, not a native speaker.
- Chromium only for browser tests (no Safari/WebKit available here).

---

# Earlier notes

## Phase 0 — what was built
- Next.js 16 + Tailwind app, single config constant for the name (`src/lib/config.ts`).
- Email one-time-code login (owner email only, `OWNER_EMAIL`), via Supabase Auth + Gmail SMTP.
- PWA: manifest, icons, `public/sw.js` (push + notification click).
- Web Push: subscribe route, test route, "Send me a test notification" button.
- SQL (run in order in the Supabase SQL editor): `supabase/migrations/0001_push_subscriptions.sql`, then `0002_grant_push_subscriptions.sql`.
- Security headers, `scripts/check-secrets.mjs` (checks the browser bundle for secrets).

## Decisions
- Vercel Production branch set to `phase-0-setup` so the phone gets a public address without merging.
- Login uses a typed code, not a link (links open in Safari, not the installed iPhone app).
- Wrong emails get the same screen as the owner (strangers can't learn who the owner is).
- Four duplicate Vercel projects were created while the repo was empty; only `nudge` is kept.

## Problems met and fixes
- Vercel could not import an empty repo → pushed the branch first.
- Supabase URL had `/rest/v1/` pasted on the end → removed.
- Code email timed out (504) → Gmail SMTP port was wrong; changed port, worked.
- New Supabase projects do not give signed-in users table permissions → SQL file 0002.
- Vercel framework preset was "Other" (project made when repo had no app) → set to Next.js.

## Not done / unverified
