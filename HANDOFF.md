# HANDOFF — "Nudge" (working name): a personal reminders & updates web app

You are Claude Code, building a new app from an empty folder for Adrian (Doral/Miami). Read this whole file before writing code. Build it in phases, stop at the end of each phase, and report back in plain, simple English (Adrian is not a developer). Never ask him to paste secrets into a chat.

The working name is **Nudge**. Keep the name in one config constant so it can be renamed later.

---

## 1. What the app is

One calm place on Adrian's iPhone that reminds him about everything that matters and shows what changed:

- **Homework and school**: assignments, due dates, exams.
- **Payments**: bills, subscriptions, rent, anything with a due date and an amount.
- **Packages**: tracking numbers, where the package is, "out for delivery", "delivered".
- **Everything else**: tasks, appointments, renewals (car registration, ID, insurance), Liga Natural and Style Jerseys to-dos.

He opens it, sees **Today** (what's due, what's late, what's arriving), and gets a push notification at the right moment, with no clutter.

**Main rule: being on time is the product.** A reminder that fires late, twice or never is a bug of the highest severity.

---

## 2. Stack (same as his other app, Joker, so everything is familiar)

- **Next.js** (App Router, TypeScript, server actions), **Tailwind** + **shadcn/ui**, **Zod**, **chrono-node** (natural-language dates, English + Spanish), **date-fns-tz**.
- **Supabase** (a NEW, separate project, not Joker's): Postgres, Auth (email one-time code, same as Joker), Row Level Security on every table, Storage (private bucket for photos/attachments), **Supabase Cron (pg_cron + pg_net)** for the reminder clock.
- **Vercel** (Hobby plan) for hosting. Installed on the iPhone as a **PWA** (Add to Home Screen) with **Web Push** (works on iPhone iOS 16.4+ when installed to the Home Screen).
- **Vitest**, **PGlite** (runs every migration on a real Postgres engine in tests), **Playwright**, **axe**.

### Important limit: the reminder clock
Vercel Hobby cron jobs can only run **once per day** with ±59 min precision, so they are useless for reminders. Use **Supabase Cron** instead:
- A pg_cron job runs **every minute** and calls (via pg_net) `POST https://<app>/api/dispatch` with a secret header (`CRON_SECRET`, stored in Supabase Vault, never in code).
- `/api/dispatch` finds every reminder due in the last 2 minutes that hasn't been sent, sends the push, and marks it sent **in the same transaction** (idempotent: a unique "sent" record per reminder occurrence, so retries never double-send).
- Keep one daily Vercel cron as a backup "catch-up" job that sends anything missed (labelled "Missed while you were away").
- If dispatch fails, it retries on the next minute. Log every run in a `dispatch_log` table so we can prove timing.

---

## 3. Design: inspired by the MonAi app (light, warm, playful but clean)

Adrian loves MonAi's look. Recreate the **style**, not their brand: original logo, original name, our own colour values.

- **Light theme by default**: warm off-white background (~#FAF8F5), white cards, soft shadows, rounded corners (cards 20–24px). Optional dark mode later.
- **Accent**: a warm gradient (tangerine → coral, our own hex values), used for the main button, highlighted words in titles, and progress rings. Category colours are soft pastels.
- **Typography**: big, bold, friendly titles with ONE word in the accent colour ("What should we **track**?"), short grey subtitles, generous spacing.
- **Emoji as icons** throughout (📚 homework, 💳 payments, 📦 packages, ⚽ league, 👕 jerseys, ✅ tasks), always with a text label (accessibility).
- **Choice tiles** (shared component): 2-column grid of rounded square cards, each with a big emoji on top and a 1–2 line label. Press = quick scale-down. Selected = tinted background, accent border and a check in the corner.
- **Main button** (shared component): full width, ~54px tall, fully rounded, accent gradient, white text, optional "→". Disabled = faded until a choice is made. One primary button per screen.
- **Step pill** ("Step 1 • • •") on multi-step flows.
- **Motion**: things gently count up and slide in, under 400ms, and respect reduced-motion. A short "Setting things up…" ring animation at the end of onboarding (2–3 s, skippable).
- Must look great at **375px** wide, with tap targets of at least 44px and contrast that passes axe.
- **Bilingual**: English and Español from day one (all strings in a catalog, switch in Settings).

### Onboarding (MonAi-style, one question per screen)
1. Welcome: name + tagline ("Never miss the things that matter"), **Get started**.
2. "What do you want to keep **track** of?" Multi-select tiles: 📚 Homework · 💳 Payments · 📦 Packages · ✅ Everything else.
3. "When should we **nudge** you?" Tiles: 🌅 Morning summary · ⏰ Right on time · 🔔 A little before · 🤫 Only important stuff.
4. Morning summary time (picker, default 8:00 AM) and quiet hours (default 10 PM–7 AM; urgent items can override).
5. Turn on notifications: a friendly explainer screen first, THEN the iOS permission prompt (if he isn't installed to the Home Screen yet, show the "Share → Add to Home Screen" steps with pictures, because iPhone only allows push for installed web apps).
6. "Simple or Full?" (Simple = Today, Add, Upcoming; Full = everything).
7. Setup ring animation → "You're all set 🎉" → Today.

---

## 4. Screens

- **Today** (home): greeting; a summary line ("3 things today · 1 package arriving · 1 payment due Friday"); sections **Late** (red tint), **Today**, **Arriving** (packages), then **Next 7 days**. Each row: emoji, title, time, space chip, and swipe right = Done, swipe left = Snooze.
- **Upcoming**: calendar strip + list grouped by day; a month view with dots.
- **Add** (big + button, always visible): one text box that understands plain language: "pay phone bill friday 5pm $45", "math homework due tuesday", "rent every month on the 1st $900", "dentist oct 28 3pm remind me 1 day before". Show the parsed result as a card to **confirm before saving** (never guess silently). A tracking number pasted in is recognised as a package automatically.
- **Item detail**: title, type, due date/time, repeat, reminders (several: at time / 10 min / 1 hr / 1 day / custom before), amount (payments), course (homework), notes, checklist, links, photo attachments, space, history ("Snoozed twice", "Reminder sent 8:00 AM").
- **Packages**: list with carrier logo/initials, last status, an estimated delivery date and a timeline. States: Label created → In transit → Out for delivery → Delivered (or Exception). Delivered packages auto-archive after 3 days.
- **Payments**: due this week / this month, total due, "Paid" button (records amount and date), autopay flag (autopay items remind only "heads up", never "pay now").
- **School**: courses with colours, assignments by course, upcoming exams, "start early" reminders for big assignments (e.g. 3 days before).
- **Updates** (feed): everything that changed, newest first ("📦 Your Amazon package is out for delivery", "📚 New assignment posted", "💳 Phone bill due tomorrow").
- **Settings**: language, notifications (morning summary time, quiet hours, per-type on/off), spaces, connections (calendar feeds, package tracking, Joker), Simple/Full mode, export data, delete account, privacy, terms.

### Spaces
Personal (default), plus Adrian can add: School, Liga Natural, Style Jerseys (and any others). Each item belongs to one space, with a filter chip row at the top.

---

## 5. How things get in (each optional, phase by phase)

1. **Typed or spoken in the app** (keyboard mic): natural-language parser (chrono-node + our own rules for amounts, "every…", "remind me…"). No AI in v1.
2. **Calendar feeds (ICS) subscribe**: paste any calendar link and Nudge imports the events as items and refreshes it every 30 min (driven by the minute clock). This covers:
   - **School**: most school systems (Canvas, Schoology, Blackboard, Google Classroom via Google Calendar) offer a calendar feed link for assignments.
   - **Joker payments**: Joker already has a Calendar export link for bills, so subscribing to it puts every Joker bill into Nudge automatically.
   - Dedupe by event UID and keep his edits (snoozes, done) when the feed refreshes.
3. **Packages**:
   - Detect the carrier from the tracking number pattern (USPS, UPS, FedEx, Amazon TBA, DHL), with a "Track on carrier site" deep link always available. This works with zero cost and no account.
   - Live status through a tracking service behind a provider interface (so it can be swapped). Start with **Ship24's free plan** (≈10 shipments a month, with webhooks for status changes) and, if Adrian adds the key, the **official USPS API** (free with a USPS developer account) for USPS packages. Verify current limits at build time. When the free quota is used up, fall back to deep links and say so plainly. Never silently stop.
   - Webhooks are verified (signature or secret) and update status, which triggers pushes for "Out for delivery", "Delivered" and "Exception".
4. **iPhone Shortcut quick add** (later phase): `POST /api/quick-add` with a hashed personal token (lessons from Joker: build a **"Test this token" button** and **specific error messages**: no token / header must start with "Bearer " / token not recognised / expired / revoked / wrong token type / too many requests).
5. **Email forwarding for packages and bills** (optional, last phase): a private forwarding address (via a free inbound email service) that reads shipping and bill emails and creates draft items for him to confirm. Never auto-create without review, and store only the extracted fields, not full emails.

### Link to Joker (optional, later)
- Subscribe to Joker's bills calendar (above).
- When a payment in Nudge is marked **Paid**, it can optionally log it in Joker through Joker's quick-add API (Adrian pastes his Joker quick-add token into Nudge's Settings; stored encrypted). Off by default.

---

## 6. Notifications

- **Web Push** (VAPID keys in env vars). Each item can have several reminders. Payments default to 3 days before + on the due date at 9 AM; homework defaults to 1 day before at 6 PM + at the due time; packages notify on status changes.
- **Morning summary** at his chosen time: "Today: 3 things · 📦 1 arriving · 💳 $45 due Friday". Tapping it opens Today.
- **Quiet hours**: hold non-urgent pushes until quiet hours end. "Urgent" (due within 1 hour, or a package exception) can break through, and this is configurable.
- **Actions**: open the item; Done and Snooze from the item screen (iOS web push has limited action buttons, so don't rely on them).
- **No spam**: at most one push per item per reminder time, group several reminders due in the same minute into one push, and never re-notify something already marked done.
- Every push respects the space/type switches in Settings.

---

## 7. Data model (Supabase, RLS on every table, owner-only)

`profiles`, `spaces`, `items` (type: task | homework | payment | package | event | renewal; title, notes, due_at timestamptz, all_day, timezone, status: open | done | skipped | archived, amount_cents integer, currency, course_id, space_id, priority, source: manual | ics | package | shortcut | email, external_uid), `recurrences` (RRULE string + exceptions), `reminders` (item_id, offset or absolute time), `reminder_sends` (unique per reminder occurrence, for idempotency), `occurrences` (materialised next N occurrences for repeating items), `courses`, `packages` (tracking_number, carrier, status, eta, last_event_at, provider_id), `package_events`, `calendar_feeds` (url encrypted, last_synced_at, etag), `attachments` (Storage path, private bucket), `updates` (feed entries), `push_subscriptions`, `api_tokens` (hashed, kind, expires_at, last_used_at), `dispatch_log`, `settings`.

- Money is stored as **integer cents**, never floats.
- All times are stored as `timestamptz`, with the user's zone (`America/New_York`) stored in his profile. Every date shown is formatted **with an explicit timeZone** so the server and the phone always show the same text (a lesson from Joker: a server/browser zone mismatch caused hydration errors).
- Recurring items: store the RRULE; the dispatcher computes the next occurrence; "Done" on one occurrence never deletes the series; "Skip this one" is supported. DST-safe (9 AM stays 9 AM).

---

## 8. Security & privacy (same standard as Joker)

- One owner for now (his email in `OWNER_EMAIL`), but every table is designed per user so it can be shared or launched later.
- RLS on every table, `revoke all` from `anon`, plus a SQL check file (`supabase/tests/rls_check.sql`) that must return 0 rows. Tests prove that a stranger sees nothing.
- Secrets live only in Vercel env vars or Supabase Vault. A build-time check fails if any secret ends up in the browser bundle (allow `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only if it is a publishable/anon key, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `NEXT_PUBLIC_VERCEL_*`).
- Calendar feed URLs, provider keys and the Joker token are encrypted at rest (an `ENCRYPTION_KEY` env var).
- Webhooks are verified. Every API route validates with Zod, is rate limited, and returns friendly errors (no stack traces).
- Security headers: CSP with nonce, Referrer-Policy, Permissions-Policy, X-Frame-Options, HSTS.
- Privacy page, terms page, export all data (JSON/CSV), delete account.

---

## 9. Engineering rules (lessons learned on Joker, follow all of them)

- Migrations follow a template, are **safe to run twice**, and are tested by running every migration in order on **PGlite**. Watch for `$$` being mangled into `$` by scripts. Adrian runs the SQL himself in the Supabase SQL editor; you never run it against his real database.
- Work on branches, never push to main without his OK, and report the exact SQL files to run, in order.
- Playwright runs against a **production build** (not the dev server), in small groups, and **never two Playwright runs at once** (the dev server runs out of memory on his laptop).
- Every new feature beyond the core is **optional, off by default**, with a switch in Settings → Features.
- Plain, friendly words in the app, never jargon.
- Keep `NIGHT_LOG.md` (progress, decisions, blocked items, a handoff at the top) and update this HANDOFF.md with a section per phase.
- Dependabot on, ignoring major versions of `typescript` and `@types/node`.
- Performance target: Today loads with ≤5 database round trips, and Lighthouse mobile 90+ is a goal (keep the client JavaScript small: server components by default, lazy-load sheets and charts).

---

## 10. Phases (stop after each one and report)

**Phase 0: Setup (with Adrian, step by step)**
New GitHub repo, new Supabase project (the free plan allows 2 projects; Joker uses one), new Vercel project, env vars, email one-time-code login (reuse his Gmail SMTP setup from Joker), PWA install, Web Push working with a "Send me a test notification" button. Show him exactly which keys go where, and remind him never to paste keys into chats.

**Phase 1: Core reminders (the heart)**
Items, spaces, Today / Upcoming / Add / Item detail, natural-language add with confirm, repeating items, multiple reminders, snooze/done/skip, the **Supabase Cron minute clock + idempotent dispatcher**, morning summary, quiet hours, onboarding (MonAi-style), English/Español, Simple/Full. Tests for timing: due at 11:59 PM, DST days, repeat rules, no double-sends, missed-while-offline catch-up.

**Phase 2: Payments + School**
Payment fields, Paid button, autopay, totals; courses and assignments; **ICS calendar feed subscriptions** (school, Joker bills) with dedupe and refresh; Updates feed.

**Phase 3: Packages**
Tracking-number detection + deep links, provider interface, Ship24 free plan + optional USPS API, webhooks, status pushes, auto-archive, a clear message when the free quota runs out.

**Phase 4: Extras (all optional, off by default)**
iPhone Shortcut quick add (with the Test token button), a Home Screen widget via Scriptable (read-only token), calendar export (.ics) of everything in Nudge, the Joker "Paid → log in Joker" link, email forwarding for packages and bills (drafts only), and attachments (photo of the assignment or bill).

---

## 11. Definition of done (every phase)

Typecheck clean, lint 0 errors, all unit tests pass (including PGlite migrations run twice and the RLS tests), production build passes the secrets check, Playwright passes on phone (375px) and desktop, axe passes, and the Vercel preview is **Ready**. Then report: what was built, the SQL to run in order, a 5-minute phone checklist, decisions made, and anything unverified.

## 12. Facts checked on Oct 13, 2026 (read before Phase 0)

1. Supabase free projects pause after 7 days of inactivity, and the free plan has no backups. Confirm what counts as activity (done: you checked the docs). The daily Vercel backup cron also checks that Supabase answers; if not, it emails Adrian (Gmail SMTP): "Nudge's database is paused, restore it in the Supabase dashboard". It can't use push, because push subscriptions live in Supabase. Settings → "Export all data" is the backup; remind Adrian to export monthly. Both free project slots are now used (Joker + Nudge).
2. A job that runs every minute grows cron.job_run_details by ~1,440 rows/day. Add a daily pg_cron job (3:15 AM ET) deleting cron.job_run_details rows older than 7 days and dispatch_log rows older than 30 days. The free database is 500 MB.
3. pg_net: set an explicit timeout_milliseconds on the dispatch call (e.g. 10000) and keep /api/dispatch fast. A timeout must never cause a double send (reminder_sends unique key; test it).
4. USPS: the old Web Tools API was retired Jan 25, 2026. The new USPS APIs use OAuth 2.0 (client ID + secret), and Tracking access needs a separate access request. USPS is optional/unlikely; carrier deep links + Ship24 are the plan.
5. Ship24 free: 10 shipments/month, API + webhooks, blocked (not billed) after 10. Only spend a shipment when Adrian taps "Get live updates" on a package, never automatically.
6. Vercel Hobby: ~43,000 dispatch calls/month is well within limits. Hobby is personal/non-commercial use, which fits Nudge.

## Phase 0 report (done Oct 14, 2026)

Live: https://nudge-ivory.vercel.app (Vercel Production tracks `phase-0-setup`). Built: app skeleton, email-code login (owner only), installable PWA, Web Push with a test button. SQL, in order: `supabase/migrations/0001_push_subscriptions.sql`, `0002_grant_push_subscriptions.sql`. Tested by Adrian on iPhone: install, login, test notification all worked. Not yet done: automated tests, RLS check file, Playwright/axe/Lighthouse, rate limiting, CSP nonce, Dependabot. See NIGHT_LOG.md.

## Phase 1 report (overnight run, Oct 14, 2026)

Branch `phase-1`: Today / Upcoming / Add (plain words, confirm before saving) / Item detail / Settings / MonAi-style onboarding, English + Español, Simple / Full; repeating items (DST-safe), several reminders per item, snooze / done / skip, quiet hours, morning summary; the reminder clock (pg_cron every minute → `/api/dispatch`, idempotent through a unique send record), a daily catch-up and a daily health-check email. SQL, in order: `0003_core_tables.sql`, `0004_reminder_clock.sql`, then the Vault + Vercel steps in NIGHT_LOG.md, then `0005_clock_schedule.sql`. Tests: PGlite runs every migration twice, `supabase/tests/rls_check.sql` returns 0 rows, timing tests (11:59 PM, DST days, no double sends, catch-up), parser and repeat-rule tests, Playwright (phone 375px + desktop) with axe. See NIGHT_LOG.md for decisions, what is unverified, and the 5-minute phone checklist.
