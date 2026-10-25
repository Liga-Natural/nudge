# Nudge widgets on your iPhone

Nudge is a web app on your Home Screen, and iPhone only allows real widgets for App Store apps. So Nudge uses the free **Scriptable** app to draw widgets, the same way Joker does. You do this once; after that the widgets update by themselves.

The widget token can only **read** a small summary (what is next, your list, school, grades, the week, habits). It cannot add, change or delete anything, and it cannot be used for the import address. You can revoke it any time.

## 1. One-time setup (about 3 minutes)

1. Install **Scriptable** (free) from the App Store.
2. In Nudge open **Settings → Home Screen widgets** and tap **Create widget token**. Tap **Copy** under the token (it is shown only once).
3. Tap **Copy script** (same screen). It already has Nudge's address filled in.
4. Open **Scriptable**, tap **+** (new script), paste, and tap the name at the top to call it **Nudge**.
5. Find the line `const TOKEN = "";` and paste your token between the quotes: `const TOKEN = "ndw_...";`. Tap **Done**.
6. Tap the **▶ Play** button once. You should see a widget preview with your data.

## 2. Add a widget to the Home Screen

1. Long-press an empty spot on the Home Screen, tap **+**, search **Scriptable**.
2. Pick a size (Small, Medium or Large) and tap **Add Widget**.
3. Long-press the new widget → **Edit Widget** and set:
   * **Script** = Nudge
   * **When Interacting** = **Open URL**
   * **Parameter** = one of the words below
4. Tap outside to finish. Tapping the widget opens the right page in Nudge.

### Parameters

| Parameter | What it shows | Best size |
| --- | --- | --- |
| `next` | Next up with a countdown and the class emoji | Small, Medium |
| `today` | Today's list (next 4) with ✓ done and ! late marks | Small, Medium |
| `school` | Next 3 homework and a red **Missing (n)** badge | Small, Medium |
| `grades` | Each class's current-quarter letter in a small grid | Small, Medium, Large |
| `week` | 7-day strip with a count per day | Large (works on Medium) |
| `habits` | Today's habits with streaks | Small, Medium |
| `rotate` | A different card at each refresh: next → school → grades → habits (skips a card that has nothing to show) | Small, Medium |

Light and dark follow your iPhone. Class emojis and colours are the ones you set in Nudge.

## 3. Smart Stack (like Joker)

1. Add several **Small** Scriptable widgets, each with a different Parameter: `next`, `today`, `school`, `grades`.
2. Drag one on top of another to make a stack.
3. Long-press the stack → **Edit Stack** → turn on **Smart Rotate**.

Or use one `rotate` widget on its own, which changes card each time it refreshes.

## 4. Lock Screen

1. Long-press the Lock Screen → **Customize** → **Lock Screen** → tap the widget area.
2. Add **Scriptable**:
   * **Inline** (above the clock): `Next: Algebra HW 8:00 PM`
   * **Circular**: today's progress ring (done / total)
   * **Rectangular**: your next 2 items
3. Lock Screen widgets ignore the Parameter.

## If something looks wrong

* **"updated 4:10 PM"** under a widget is when its data was fetched. If you are offline, or Nudge can't be reached, the widget shows the **last saved data** with "offline" in front, never a blank widget.
* **"This token was revoked or is wrong."** Make a new token in Settings → Home Screen widgets and paste it into the script.
* **"Can't reach Nudge" and no saved data yet.** Open the widget's script once with internet on (tap ▶ Play).
* iPhone decides how often a widget refreshes (roughly every 15 minutes or more). Nudge asks for a refresh every 15 minutes and keeps answers for 30 seconds on its side, so a change you just made in Nudge can take a little while to show.
* To stop a widget for good, **Revoke** its token in Settings → Home Screen widgets.

## For the curious

* Address: `GET /api/widget` with `Authorization: Bearer ndw_...`. One call returns everything the widgets draw (next, today, school, grades, week, habits, progress).
* Limits: 60 requests a minute per token and 120 per address; answers are cached for 30 seconds per person.
* Tokens are random, stored only as a SHA-256 fingerprint, and widget tokens (`ndw_`) and import tokens (`ndg_`) cannot be used in each other's place.
* The script is `scripts/nudge-widget.js`.
