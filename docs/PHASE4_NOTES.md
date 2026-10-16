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
* *Strip counts:* Today = due today; Tomorrow = due tomorrow; This week = the next 7 days counting today.
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
See the end of this file for the final numbers.

---

# Earlier: Phase 3
