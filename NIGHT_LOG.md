# NIGHT_LOG — Nudge, Phase 4 (branch `phase-4`)

Nothing was merged. Nothing in your real Supabase or Vercel was touched, and no secret value was printed or written anywhere. Branch `phase-4` was cut from `origin/main` (which already has Phase 3 merged; your local `main` was one step behind).

---

## START HERE

### 1. One SQL file to run

Supabase → SQL Editor → New query → paste → Run → "Success". Safe to run twice.

* `supabase/migrations/0011_ring_anyway.sql`
  * adds the "ring anyway" switch to reminders (bug 1),
  * makes the Delivery log say **"Held — quiet hours, will send at 7:00 AM"**,
  * makes the nightly cleanup remove items you deleted more than 30 days ago.

**Order matters a little:** the new app works without this file (nothing crashes), but "Ring anyway" will not stop a held reminder until the file is run. Run it before you merge.

No new environment variables.

### 2. What to test on your phone (10 minutes, from the Home Screen icon)

**Bugs from production**
1. Add → `call mom tomorrow 11:30pm` → Check it → Save. A sheet asks **"This is during quiet hours — ring anyway?"**. Try both buttons (do it twice). (If "Let urgent things through" is on, a reminder exactly at 11:30 PM is allowed through by design and nothing is asked; the sheet appears for early reminders, e.g. "1 day before at 11 PM", or when that switch is off.)
2. Settings → Delivery log: a held reminder reads "Held — quiet hours, will send at 7:00 AM". It really is sent at 7:00 AM (tested against a real Postgres engine).
3. School: a past exam is only under **Late**, never under "Upcoming exams" or "Assignments".
4. Add → `test nudge today 4:46pm` → the kind is **Task**, not Homework. `math test friday` is still Homework.

**The new feel**
5. Close the app completely, open it: the mark pops in, shimmers, and slides into the top-right of Today. Open it again within 30 minutes: only a quick fade. Settings → **Opening animation** switch turns it off. iPhone: Settings → Accessibility → Motion → Reduce Motion turns every animation here into a plain fade.
6. Today: the ring (done / total), **Next up** with a live countdown, and the strip **Today · Tomorrow · This week** (swipe it sideways, tap one to switch the list below).
7. A row: swipe right = Done (the last one of the day makes confetti), swipe left = Snooze sheet, long-press = quick actions, drag the ⠿ handle to reorder inside Morning/Afternoon/Evening. Everything also has a button.
8. Done, snooze, skip and delete each show an **Undo** toast for 6 seconds.
9. Late section pulses once; **Do today** and **Reschedule** are one tap.
10. Homework rows show the class chip, a countdown and **Mark turned in**; payments show the amount and **Paid**; habits show the 🔥 streak and the week's dots.
11. Turn the phone to dark mode: same orange on a warm dark background.

---

## Decisions I made (and why)

**Part 0 — bugs**
* *Quiet hours.* The sheet only appears when the clock would really hold a reminder (it fires inside quiet hours and the "urgent" exception does not apply). Asking when nothing would be held would be noise. "Ring anyway" is stored on the item (`items.ring_anyway`), so every reminder of that item rings; "Keep quiet" leaves it held until quiet hours end. Editing an item only asks again if you changed the date or its reminders.
* The database side already held and released reminders correctly (new test: 11:05 PM held at 11:05, nothing at 6:59 AM, sent at 7:00 AM). The real problem was that nothing said so; now the form asks, and the Delivery log states the time.
* *School.* Every homework item has exactly one home: **Late** (already past), **Upcoming exams** (an exam still ahead) or **Assignments** (everything else, by class). Tests cover the exact double-listing you saw.
* *Quick add.* `exam / quiz / test / midterm / final` (and the Spanish ones) count as school only with a class name you created, or school words (class, school, teacher, chapter, subject names like math/history/…), or the always-school words (hw, homework, worksheet, assignment, essay, project). Otherwise the default is **Task**. `quiz on <subject>` works because the subject is a school word.
* *Onboarding.* Quiet hours are now their own step (after "morning summary") with tiles: Overnight 10 PM–7 AM, Late night 11 PM–8 AM, Pick my own, No quiet hours, plus the "urgent can break through" switch. The morning-summary step is now only about the summary.

**Part 1 — opening**
* *Launch images:* 24 PNGs in `public/splash/` (12 iPhone sizes × light/dark), drawn by `node scripts/make-splash.mjs` with the app's real background colours (#FAF8F5 / #15120F) and the mark at exactly the size the animation starts from. Linked through the page metadata (`apple-touch-startup-image` with `prefers-color-scheme`).
* *Cold start* = the first screen after the app is launched (sessionStorage is empty). A 1-line script in the page head marks it before anything paints, so there is no flash. It never waits longer than ~1.2 s after the page started loading; if the data is not ready by then you are let in with skeletons; after 4 s a "Still syncing…" note appears. Opened within the last 30 minutes, or Reduce Motion on: just a 300 ms fade.
* *The progress line* moves with real states (scripts loaded → page drawn → data ready); it does not fake a percentage.
* *"Data ready"* = no skeleton (`aria-busy`) is on screen. This works for every screen without each one reporting in.
* A 6-second failsafe in CSS hides the cover if scripts never run.
* *Name:* Today greets with the first name from Settings → "What should we call you?" (also asked, optionally, on the welcome screen). I did not guess a name from your email.
* *Offline:* a small "Offline · updated 4:10 PM" pill; "updated" is the last time the app was open and online on this phone.
* *Dark mode did not exist before.* "Respect dark mode" needed it, so I added it with the same orange gradient and cream-to-dark tokens (all colours are now CSS variables; light mode is pixel-identical, a test checks the cream value).

**Part 2 — Today**
* *Ring* = done today ÷ (done today + still open today). One extra, parallel database call counts today's done items; the page is still two rounds (profile, then everything else in parallel) plus one more only when habits are on the list.
* *Strip counts:* Today = due today; Tomorrow = due tomorrow; This week = everything up to 7 days ahead (the same reach Today always had).
* *Now line* sits before the first reminder still ahead, inside the current part of the day, and moves every 15 seconds. Items with no clock time are under **Anytime**.
* *Do today* on an item whose time already passed today turns it into an all-day item for today (so it is not late again straight away). *Reschedule* keeps the time of day. For repeating items only that one time moves.

**Part 3 — interactions**
* *Delete* now hides the item first so Undo works; items hidden for 30 days are removed by the nightly cleanup (calendar-feed items excluded). Other destructive things (delete course, feed, space, account) keep their existing confirmation instead of Undo.
* *Reorder* is remembered per day in your profile for 3 days, then forgotten. Keyboard: focus the ⠿ handle and press ↑/↓; also "Move up/down" in the long-press sheet.
* *Haptics* use `navigator.vibrate`, which iPhone Safari does not support, so on iPhone it is animation only.
* *Page transitions* use the View Transitions API (cross-fade) from the bottom bar and from rows; other browsers just navigate.
* The ⠿ handle is 28 px wide (the row is already crowded at 375 px); it has the keyboard and long-press equivalents. Everything else is ≥ 44 px (a test enforces that on Today).

**Part 4 — cards**
* The Joker "Paid → log in Joker" link has no button yet (you said "later"); the Paid button sits where it will go.

---

## Not verified (needs your phone)
* iOS honouring the light/dark launch images (it does for other apps, but I cannot see an iPhone here), and exact timing of the hand-over from launch image to animation.
* Safari's View Transitions (iOS 18+) and swipe feel with a real thumb; I tested with a mouse drag.
* Everything against your real Supabase (run file 0011 first).
* Only Chromium was available for browser tests.

## Tests
Typecheck clean, lint 0 errors, 301 unit and database tests pass (new: quiet hours, held-then-sent against a real Postgres engine, school sections, quick-add rules, Today timeline and countdown logic), normal production build and the secrets check pass, Playwright 149 of 149 on phone (375 px) and desktop including axe in light and dark (one earlier run of the grades test was flaky and passed on rerun; unrelated to this phase).

---

# Earlier: Phase 3
# NIGHT_LOG — Nudge, Phase 3 (branch `phase-3`)

Nothing was merged. Nothing in your real Supabase or Vercel was touched, no secret value was printed or written anywhere. The pull request into `main` is open for you; **do not merge until the SQL below is run** (see the warning in step 1).

---

## START HERE (the three things you asked for)

### 1. SQL files to run, in this order

Supabase → SQL Editor → New query → paste one file → Run → you should see "Success". One file at a time, in this order. You already ran 0001–0006 earlier.

1. `supabase/migrations/0007_delivery_fixes.sql` — **the reminder fix** + the Delivery log
2. `supabase/migrations/0008_reminder_types.sql` — work, habits, birthdays, checklists
3. `supabase/migrations/0009_school_grades_import.sql` — classes, assignments, grades, the importer
4. `supabase/migrations/0010_inbox_tokens_bills.sql` — access tokens, rate limiter, hourly feeds, Joker bills

Then (optional but good): run `supabase/tests/rls_check.sql`. It must return **no rows**.

> ⚠️ **Run all four BEFORE you merge the pull request.** Vercel now deploys `main` by itself. If the new app goes live before the SQL is run, every screen shows the friendly "One more setup step" page that lists these files (it will not crash and the reminder clock keeps working, but you cannot use the app until the files are run). Every file is safe to run twice.

I edited one old file, `0006`, by adding a single `drop function if exists` line so later files may change that function. You do **not** need to run 0006 again.

### 2. New environment variable names

**None are new.** These existing ones must be set in Vercel (Production):

* `SUPABASE_SECRET_KEY` — the Delivery log, the inbox address, the hourly feeds and the clock all use it (already set for the clock).
* `ENCRYPTION_KEY` — needed to save a Classroom calendar link or the Joker bills link (they are stored encrypted). Already set from Phase 2.
* `VAPID_SUBJECT` — must start with `mailto:` or `https://` (for example `mailto:you@gmail.com`). Apple's push service refuses notifications otherwise, and the Delivery log now says so in words if it is wrong.
* `NUDGE_BUILD` is made automatically from Vercel's commit id at build time. **Do not set it.**

### 3. Exactly what to test on your phone

Do these in order, from the Home Screen icon (not Safari).

**A. The new version arrived**
1. Open Nudge. If a button "**Update available — tap to reload**" shows at the top, tap it. (This is the new "old app stuck on the phone" fix; after this you should rarely see it.)
2. Settings → you should see a new card **Delivery log**. If you do, the new version is running.

**B. The notification path itself**
3. Settings → **Delivery log** → tap **Send test notification now**. Lock the phone. It should arrive within seconds.
   * On the page, the top entry should say **Delivered**.
   * If it says **Failed**, the line under it is the exact reason in plain words (for example "key mismatch: turn notifications off and on again"). Do what it says, then try again.
4. Same page, "Is this phone ready?": it should say 1 phone signed up and "Notification keys on the server look right".

**C. The bug you found (a reminder that never came)**
5. Add → type `test nudge` → Check it → set today and a time **3 minutes from now** → make sure "At the time" is selected → Save.
6. Lock the phone. At that minute it should ring **once**. Tap the notification: the item opens with a **Quick actions** box on top (Done, 10 minutes, 1 hour, Tonight, Tomorrow). Tap **10 minutes** → it rings again 10 minutes later.
7. Do it once more at a time **inside your quiet hours** (after 10 PM). It should still ring, because "urgent items can break through" is on. If you switch that off (Settings → Quiet hours), the Delivery log will show it as **Held — Quiet hours: held until 07:00 AM** (that is the log working, not a bug).
8. Run `supabase/tests/last_reminders.sql` (the query in the section further down). Every reminder shows its due time in Miami time and what happened.

**D. The new reminder kinds** — all are OFF until you switch them on in Settings → Features (or on the first onboarding question).
9. Switch on **Habits**. Add `gym every monday wednesday friday 7am` → Check it → it should say Habit. Open **Habits** (link on Today): tap **Done** (streak goes up) and on another habit tap **Skip today** (streak stays). Settings → Habits → try "One daily summary".
10. Switch on **Birthdays**. Add `mom's birthday oct 20` → Birthday, repeats every year, "3 days before" and "That day" reminders. Add `dentist friday 3pm @ Dr Lopez office` → the place shows on the item.
11. Switch on **Renewals**. Add → pick Renewal → set the expiry date and tap "14 days before". Check **Renewals** list.
12. Switch on **Work / Liga Natural**. Add `game day saturday 9am` → Work → Game day → add two checklist steps → Save → open it → tick the steps.
13. Add `math hw friday 8pm` and `pay phone bill every 15th` and check the card (homework / payment that repeats on the 15th).

**E. School** (Settings → Features → School, Grades, Agent import)
14. Settings → **Agent import** → create a token, copy it, tap **Test token** → "This token works". Revoke it.
15. Open **Import** (link on Today) → **Insert an example** → **Preview** → **Confirm import**. Then **Grades** → Math 101 shows 90%. Import the same example again: it says "Nothing new to import".
16. Settings → **Google Classroom calendars**: choose a class (or "A new class…"), paste that class's *Secret address in iCal format*. Within a minute or two (the clock does it) the assignments show up as Homework with the class. Change the night-before time in "Homework reminders" and see it apply to new ones.

**F. Joker bills** (needs Joker to publish the feed, see the format below)
17. Settings → Features → Joker bills → paste the feed link → within a minute the bills appear under Payments; when Joker marks one paid, it turns to done within the hour.

**G. Android / desktop only** (iPhone cannot show buttons on a notification): the notification itself shows "Done / 10 min / 1 hour" buttons.

---

## The finding: why your 11:03 PM "Test nudge" never came

**What I could prove (I cannot look at your real database, so this is from the code and tests):**

* The clock was working: every minute it asked the database for reminders that are due. "claimed: 0" only counted reminders the clock *decided to send*.
* In the code, three situations made a reminder **disappear silently**, none of which showed in "claimed":
  1. **Your onboarding choice "Morning summary" or "Only important stuff".** The old code *discarded every reminder you set yourself* unless it had a priority flag, and there is no screen to set that flag. (My Phase 1 notes even said "those two styles mostly mute".) A test reproduces it: `tests/db/delivery.test.ts` ("Morning-summary style no longer swallows…" and the "Only-important" one) failed before the fix and passes now.
  2. **Quiet hours** (default 10 PM–7 AM) *hold* a reminder, and "held" was never counted or shown anywhere. Your reminder was set at 11:03 PM, inside quiet hours. With "let urgent things through" on, an at-the-time reminder is still sent; with it off, or for a reminder due more than an hour later, it is held until 7 AM.
  3. **A muted kind or a muted space** was skipped, also silently.
* Also: the saved time and time zone are NOT the cause. Times are saved as America/New_York → exact moments, and tests cover 11:03 PM, DST, and a phone set to another time zone. The push call itself reports errors (expired phone, wrong key) only into a log line nobody could see.

**Which one hit you?** Probably #1 or #2. To know for sure, before running 0007 paste this in the Supabase SQL editor (read-only). Look at `nudge_style` and `delivery_status`:

```sql
-- Same as supabase/tests/last_reminders_before_0007.sql
select
  i.title,
  to_char(o.due_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as due_miami,
  o.status                                                                   as item_state,
  (select count(*) from public.reminders r where r.item_id = i.id)           as reminders_set,
  coalesce(rs.status, 'NO SEND RECORD')                                       as delivery_status,
  to_char(rs.fire_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as should_fire_miami,
  p.nudge_style,
  p.quiet_start::text || '-' || p.quiet_end::text                            as quiet_hours,
  p.urgent_override
from public.occurrences o
join public.items i on i.id = o.item_id
join public.profiles p on p.user_id = o.user_id
left join public.reminder_sends rs on rs.occurrence_id = o.id
order by o.due_at desc, rs.fire_at desc
limit 15;
```

* `delivery_status = skipped` and `nudge_style` is `morning` or `important` → cause #1.
* `delivery_status = held` → cause #2 (quiet hours).
* `reminders_set = 0` → the reminder never had a "when" (the item was saved without a reminder).
* `NO SEND RECORD` with `reminders_set > 0` and the due time already past → tell me; that would be a different cause and the new Delivery log will show it.

**What I changed (Part 0):**

* A reminder you set **always fires**. "Morning summary" / "Only important" no longer throw anything away; the nudge style now only decides what *new* items start with ("A little before" adds a 30-minute warning). There is a one-line explanation under the setting.
* Every held or not-sent reminder is written to the **Delivery log** with the reason, and the clock's answer now includes `held` and `skipped` counts, so "claimed: 0" can never hide it again.
* Every push attempt records the push service's own answer in plain words (expired phone → "removed, turn notifications on again"; wrong key → "VAPID mismatch"; Apple outage, timeout…). Dead phone subscriptions (404/410) are removed automatically (that part already existed and is tested).
* **Settings → Delivery log**: last 20 attempts (time in Miami time, what, status, reason), whether a phone is signed up, whether the server's notification keys look right, your quiet-hours state, and the **Send test notification now** button.
* **Service worker / old cached app**: `/sw.js` is now generated per deploy so its bytes change every time; the new one installs and takes over at once; the page checks `/api/version` whenever you come back to the app and shows **"Update available — tap to reload"** if the live version is newer. The app also re-reads its data when you return to it and once a minute, so changes from another device show up.
* **iOS requirements** (checked in the code; I cannot test an iPhone): iOS 16.4+, Nudge added to the Home Screen and opened from that icon, notification permission granted *after* installing, Settings → Notifications → Nudge allowed, and a Focus mode can silence banners (they still appear in Notification Center). The push `VAPID_SUBJECT` must be `mailto:` or `https://`. iOS ignores notification buttons, so tapping opens the item with the same buttons on top (built).

**The read-only SQL for "my last reminders, Miami time, with delivery status" (run after 0007)** — also in `supabase/tests/last_reminders.sql`:

```sql
select
  i.title,
  i.type,
  to_char(o.due_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as due_miami,
  o.status                                                                   as item_state,
  (select count(*) from public.reminders r where r.item_id = i.id)           as reminders_set,
  coalesce(rs.status, 'NOTHING HAPPENED YET')                                 as delivery_status,
  to_char(rs.fire_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as should_fire_miami,
  to_char(rs.sent_at at time zone 'America/New_York', 'HH12:MI:SS AM')         as sent_miami,
  rs.attempts,
  rs.detail                                                                  as why,
  (select a.error from public.delivery_attempts a
     where a.send_id = rs.id order by a.created_at desc limit 1)              as last_error
from public.occurrences o
join public.items i on i.id = o.item_id
left join public.reminder_sends rs on rs.occurrence_id = o.id
order by o.due_at desc, rs.fire_at desc
limit 15;
```

---

## Part 1 — more reminder types (all off by default)

| Switch (Settings → Features, or onboarding step 1) | What you get |
|---|---|
| **Work / Liga Natural** | Kind "Work" with Game day · Registrations · Sponsor follow-up · Posting; repeat rules; a **checklist** inside the reminder (tick items off; a repeating item's checklist resets after each time). `Work` list page. |
| **Habits & routines** | Daily / weekly / **custom days** (Mon–Sun chips); **streak counter** and best streak; **Skip today** keeps the streak (it neither adds nor breaks it); a missed day breaks it; optional **one daily summary instead of many pings** (Settings → Habits, default 8:00 PM, only when something is still open). Habits page. |
| **Birthdays & events** | Yearly repeat; early heads-up **3 days before + the day** at 9 AM; appointments get a **Where** field. Birthdays list. |
| **Renewals** | Expiry date + "remind me 3/7/14/30/60 days before" (and on the day). Renewals list shows "N days left". |

* **Smart quick-add** (rule-based, no AI, `src/lib/parser.ts`, 40+ tests): `math hw friday 8pm` → Homework, Friday 8 PM, and the class if the words match exactly one of your classes; `pay phone bill every 15th` → Payment repeating monthly on the 15th; `mom's birthday oct 20` → Birthday, yearly; `gym every mon wed fri` → Habit; `game day saturday 9am`, `sponsor follow-up…`, `player registrations…`, `post on instagram…` → Work (with the right kind); `dentist friday 3pm @ Dr Lopez office` → place. A kind you have not switched on is offered as the plain kind instead (a birthday becomes an Appointment). "Buy a birthday gift" stays a task.
* **Notification actions:** snooze **10 min / 1 hour / tonight (8 PM) / tomorrow morning** and **Done**. Android/desktop show buttons on the notification (they call `/api/notify/action`). iPhone cannot, so the notification opens the item with a **Quick actions** box on top. "Tonight" disappears after 7 PM (it would be meaningless) and says so if you try.

## Part 2 — School

* **Google Classroom:** Settings → School on → *Google Classroom calendars*: per class, paste the *Secret address in iCal format*. Stored **encrypted** (AES-256-GCM with `ENCRYPTION_KEY`), never shown back (only the website name). Imported **every hour** by the existing minute clock (Vercel's daily cron is not used for this). De-duplicated by the event's UID (a unique database key), creating **Homework with the class + due date**, reminders **the night before (default 6 PM)** and **2 hours before**, both adjustable or off under *Homework reminders*. Your edits/Done are kept; removed events are archived.
* **Grades:** tables for classes (`courses`, extended), `assignments`, `grades` (score, out_of, percent, posted date, source). **Grades** screen per class: current average (points earned ÷ points possible) and newest grades; you can also type a grade by hand. A push "**New grade posted in <class>**" (one per class per minute, claimed atomically so it can never double-send; re-queued if the push fails; skipped for manual grades, for grades older than 7 days, and for corrections).
* **Agent import, same JSON two ways** — full reference with examples in `docs/INBOX_API.md`:
  1. **Import page** (`/import`): paste → **Preview** (new / updated / unchanged, and warnings) → **Confirm import**. No token needed, so your Chrome agent can drive it (stable `#import-json`, buttons *Preview* / *Confirm import*).
  2. `POST /api/inbox` with `Authorization: Bearer ndg_…`: tokens are made/revoked in Settings and **only their SHA-256 fingerprint is stored**; **Test token** button (`GET /api/inbox`); specific errors for no header / not "Bearer " / empty / not a Nudge token / unknown / revoked / expired / bad JSON (with a list like `grades[2].score: cannot be negative`) / too big / too many; **rate limits** 30 per minute per token and 120 per minute per address, counted in the database (shared by all servers); `?dry_run=1` previews.
* **Upsert by (source, external_id)** (sources `classroom`, `colegia`, `manual`): a unique database key plus the importer function; importing twice never duplicates (tested: items, reminders, grades counts stay identical). Sources never collide with each other.

## Part 3 — Bills sync with Joker (databases NOT connected)

Settings → Features → *Joker bills*, paste a feed link (stored encrypted, hourly). It imports each bill as a **Payment** (de-duplicated by the bill's id), applies the usual reminders (3 days before + day of at 9 AM, autopay-aware), follows changed dates/amounts, **marks done when the feed says paid** (once, recorded under Payments), archives bills that vanish unless you paid or edited them. A bad feed shows a plain-words problem next to it and keeps the old data.

### The exact feed format Nudge expects (give this to Joker) — also in `docs/JOKER_BILLS_FEED.md`

`GET https://<joker>/<path>?key=<long secret>` → `200` with JSON (at most 2 MB, within 6 seconds, `https` only; an `ETag` is optional and honoured):

```json
{
  "version": 1,
  "bills": [
    { "id": "bill_2026_10_phone", "name": "Phone bill", "amount_cents": 4500, "currency": "USD",
      "due_date": "2026-10-20", "status": "unpaid", "autopay": false, "notes": "T-Mobile" },
    { "id": "bill_2026_10_rent", "name": "Rent", "amount_cents": 90000,
      "due_date": "2026-11-01", "status": "paid", "paid_on": "2026-10-28", "autopay": true }
  ]
}
```

* `id` (required): stable, unique, never reused — one per bill *instance* (each month's phone bill has its own id).
* `name`, `due_date` (`YYYY-MM-DD`, due by 11:59 PM New York time) required.
* `amount_cents`: whole cents (never decimals). `currency`: 3 letters (default USD).
* `status`: `unpaid` (default) | `paid` | `canceled`. `paid_on`: `YYYY-MM-DD`.
* `autopay`: true → Nudge only says "Heads up: autopay is on".
* Keep recently paid bills in the list for a few weeks so Nudge can see them turn paid. Max 500 bills. A bare list `[ … ]` also works.

## Part 4 — lessons from Joker (all applied)

* **Time zones:** every date is formatted with an explicit zone (America/New_York by default; your profile zone). A unit test scans the whole source for any unzoned date formatting; a browser test runs every screen on a phone set to *Pacific/Auckland* and fails on any hydration warning. I found and fixed one real mismatch: Settings printed the phone's own zone during render (now it appears after load).
* **Migrations:** numbered 0007–0010, idempotent, named `$tag$` blocks only; a test checks numbering/dollar quotes/`if not exists`/RLS-in-same-file; the PGlite test runs **all** migrations in order, then **again**, and runs `rls_check.sql` (**returns 0 rows**). `rls_check.sql` gained 3 checks (RLS without a rule, user table with no signed-in access, token fingerprints readable) and the new server-only tables.
* **RLS + grants** on every new table (`item_checklist`, `assignments`, `grades`, `api_tokens` (the app can never read the fingerprint column), `delivery_attempts` (read-only for you), and server-only `api_rate_limits`, `habit_summary_sends`). Tests prove one person cannot see another's classes, grades, assignments or checklists.
* **Switches off by default; nothing appears until you turn it on:** pages explain how to switch them on (tested), Add shows only core kinds, Today's link row shows only what is on.
* **Synced across devices:** the app re-reads when you return to it and once a minute while open. **Optimistic updates with rollback:** Done, Snooze, checklist ticks, habit Done/Skip, setting toggles roll back with a message if the server says no. **No double notifications:** unique key per reminder send; grade pushes and habit summaries are claimed atomically (tested with two clocks running at once).
* **Clear errors:** saving an item now fails loudly with the reason ("its reminder times could not be set up, nothing was changed") — before, a failed reminder-time step was ignored and the item would simply never ring.
* **Loading skeletons** for every screen; no new heavy libraries.
* **Secrets check** now decodes the public Supabase key and any Supabase key found in the browser files and fails unless the role is `anon` (or a `sb_publishable_` key); tested.
* **CI:** browser tests run only on pull requests into `main` (never for Dependabot), one browser at a time; pushes that only change `.md`/`docs` skip CI entirely.
* **Design:** MonAi-style choice tiles, gradient button, "Step n of 5" pill kept; onboarding's first question now has 8 tiles (4 new).

## What I decided on my own (so you can overrule me)

* **"Morning summary" and "Only important" no longer mute anything** (explained above). The morning summary has its own on/off switch already.
* **Tonight = 8 PM**, offered only before 7 PM. Habit summary default 8 PM. Homework: night before 6 PM, and 2 hours before.
* **Agent-imported assignments become Homework**; importing never deletes. An assignment you edited in Nudge is left alone; one you finished stays finished. A class name that already exists (typed by hand) is *adopted* by the import, not duplicated.
* **A grade counts as "fresh" (gets a push) only if posted in the last 7 days**, so the first import of a whole report card does not buzz 40 times.
* **Hourly** (not 30 minutes) for Classroom and Joker feeds, to keep the clock light; plain calendar feeds stay at 30 minutes.
* **The Import page needs the "Agent import" switch** (off by default) — it is the same switch as the tokens.
* **Not building:** a priority picker; Supabase Realtime (the app re-reads on focus/every minute instead, which is simpler and cannot silently disconnect); an editor for class colors. Tell me if you want any of them.
* A Classroom calendar import and an agent import of the same assignment would show as two items (the ids differ). Use one method per class.

## Tests (all green on my computer)

* **Types, lint:** clean.
* **Unit + database tests (real Postgres engine, PGlite):** 281 pass (new: delivery fix, delivery log, tokens, rate limit, importer, Joker bills, Classroom timing, inbox API incl. every error, grade/habit pushes, notification tap, migrations hygiene, parser, streaks, grades, time formatting, secrets rules).
* **Browser tests against a production build** (made with the test-mode build, one run at a time, in four groups so your laptop's memory is not strained): **phone 55 pass, desktop 54 pass + 1 skipped** (that one is a phone-only check). Old and new screens, accessibility (axe) on every new screen, and the hydration check on a phone set to another time zone.
* **Production build + secrets check:** pass (nothing private in the browser files, no test-mode code).

## Not verified (needs your real accounts / phone)

* A real iPhone push (I cannot send to Apple), the real Supabase, real Classroom/Colegia/Joker feeds, Vercel's behaviour. I tested everything below that line against a real Postgres engine and fake push services.
* Safari/WebKit (browser tests are Chromium only).
* Spanish wording was written by me, not a native speaker.
* The agent that fills the Import page does not exist yet; the page and API are ready for it.

## Where things are

`docs/INBOX_API.md`, `docs/JOKER_BILLS_FEED.md`, `supabase/migrations/0007…0010`, `supabase/tests/last_reminders*.sql`, `src/lib/{streak,grades,inbox-*,import-run,bills-feed,push-errors}.ts`, tests in `tests/db/*` and `tests/e2e/phase3.spec.ts`.

---

# Earlier notes — Phases 0 to 2 (kept for reference)

## HANDOFF — read this first (overnight run, Oct 14, 2026)

**Status when I last updated this:** Phase 1 is built, tested and pushed on branch `phase-1`. Nothing but PR #1 (Phase 0) was merged, as you allowed. Nothing in your real Supabase or Vercel was touched.

### Branches
| Branch | What it has | Green? |
|---|---|---|
| `main` | Phase 0 (login, install, test notification). Merged from PR #1. | yes |
| `phase-1` | Core reminders (everything under "What Phase 1 contains"). Pushed. | Types, lint, 120 unit and database tests, 51 browser test runs (26 phone, 25 desktop, accessibility checks included), real build with secrets check. GitHub CI passed on every push. |
| `phase-2` | Phase 1 plus Payments, School, calendar feeds, Updates (see "Phase 2" below). Pushed. | Types, lint, 163 unit and database tests, 65 browser test runs (33 phone, 32 desktop, accessibility checks included) pass on my computer; real build + secrets check pass. |

### What Phase 1 contains
- Today (Late / Today / Next 7 days, summary line, swipe or tap to Done, Snooze sheet), Upcoming (list with 7-day strip, month view with dots), Add (plain words → confirm card → Save), Item detail (edit, reminders, history, Done / Skip / Snooze / Mark not done / Delete), Settings (language, Simple/Full, notifications, morning summary, quiet hours, nudge style, per-type switches, spaces, time zone, export JSON/CSV, delete account), onboarding (7 steps, setup ring), English + Español for everything.
- The reminder clock: database functions (file 0004) + `/api/dispatch` + a pg_cron job every minute (file 0005). One push per person per minute, never twice (database unique key), retried on failure, quiet hours hold non-urgent ones until morning, daily catch-up labelled "Missed while you were away", morning summary once a day.
- Daily health check (`/api/cron/daily`, 12:00 UTC): emails you if the database does not answer ("Nudge's database is paused, restore it in the Supabase dashboard") or the minute clock has been silent for 15 minutes; then runs the catch-up.
- Safety: row level security on every table, `supabase/tests/rls_check.sql` returns 0 rows, rate limits, CSP with a fresh nonce on every page, security headers, build-time check that nothing private (and no test-mode code) reaches the browser.
- Until you run the new SQL the app shows a friendly "one more setup step" page instead of crashing.

### Phase 2 (branch `phase-2`, built on phase-1) — everything is OFF until you switch it on
- **Settings → Features** has four switches: Payments, School, Calendar feeds, Updates. With any on, Today shows a "More" row of links.
- **Payments**: due in 7 days / rest of month / late, with totals in exact cents; **Paid** button records the amount you paid and the date (and marks it done); **Autopay** flag on a payment (notifications then say only "Heads up: autopay is on (Fri, Oct 16)", never "Due now"); recently paid list.
- **School**: courses (colours), assignments grouped by course, upcoming exams (titles with exam / quiz / test / midterm / final / examen / prueba), "Start early (3 days before)" reminder chip on homework.
- **Calendar feeds** (Settings, when switched on): paste a school link or your Joker bills calendar link (https or webcal). Stored **encrypted** (needs ENCRYPTION_KEY); never shown back; refreshed about every 30 minutes by the minute clock (after the reminders go out); "Check now" button; per-feed problem message in plain words. Duplicates are impossible (one item per calendar event), your edits / Done / snoozes are kept, events that disappear from the feed are archived, dates that move are updated and reported in Updates. Imported events inside 2 days back to 400 days ahead only. Dollar amounts in an event title or notes become the payment amount.
- **Updates**: newest first — new assignments / events from feeds, changed dates, removed ones, payments marked paid.
- Safety for feeds: only https, only public addresses (private, local and cloud-metadata addresses refused before and after redirects), 2 MB and 6 second limits, 3 redirects.

**To use Phase 2** (after phase-1 setup works): run `supabase/migrations/0006_payments_school_feeds.sql` (one file; "Success"), then add this variable in Vercel and redeploy: `ENCRYPTION_KEY` (Sensitive) — make it without showing it: in PowerShell run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | clip` and paste it. **Keep a copy in your password manager**: if it is lost, saved feed addresses cannot be read and must be added again. Until 0006 is run, the phase-2 build shows the "one more setup step" page instead of the app.
Phase 2 phone checklist: Settings → Features → switch on Payments, School, Calendar feeds, Updates. Add "pay water bill friday $45" (it becomes a payment) → Payments → Paid → check Updates. Add a course and a homework item with that course. Paste a real school or Joker calendar link under Calendar feeds, tap Check now, wait a minute or two (the clock does the fetch), and see its items on Today/Upcoming.

### Run these SQL files, in this order (Supabase → SQL Editor → New query, one file at a time)
1. `supabase/migrations/0003_core_tables.sql`  — tables for profile, spaces, items, reminders, history.
2. `supabase/migrations/0004_reminder_clock.sql` — the clock's functions and send records.
3. (do the "switch on the clock" steps below)
4. `supabase/migrations/0005_clock_schedule.sql` — starts the every-minute job. It refuses to run until the two Vault secrets exist.
(Phase 2 only: then `0006_payments_school_feeds.sql`, see the Phase 2 note above.) (0001 and 0002 you already ran. After each file, you should see "Success". Then optionally run `supabase/tests/rls_check.sql`: it must return **no rows**.)

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
- **Nudge styles** (SUPERSEDED in Phase 3: the two muting styles no longer mute anything, see the finding at the top): "Right on time" and "A little before" only change the default reminders for new items; "Morning summary" mutes everything except priority-2 items; "Only important" only sends priority ≥ 1 items. (There is no priority picker in Phase 1, so those two styles mostly mute; tell me if you want a priority control.)
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

- **Phase 2 features follow your rule** (optional, off by default, switch in Settings → Features), including Payments and School even though they are part of the plan.
- **Feeds only keep recent events**: from 2 days ago to 400 days ahead (repeating events always). This stops a school calendar from burying you in last year's late assignments; ones that fall out of the window are archived, not deleted.
- **Items you edit in Nudge stop following the feed** (so a refresh never undoes your edit); items you finished stay finished.
- **Feed fetching runs after the reminders are sent** in the same minute call, one or two feeds per minute, so a slow school website can never delay a reminder.
- **Calendar addresses are shown only as the website name** (host), never the full link (they often contain a private token).

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
