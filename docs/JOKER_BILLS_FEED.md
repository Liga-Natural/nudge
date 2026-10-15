# Joker bills feed: what Nudge expects

Joker and Nudge are separate apps with separate databases. They are **not connected** to each other. Joker only needs to publish one **read-only web address** that returns a list of bills as JSON. Nudge fetches it **every hour**.

In Nudge: Settings → Features → switch on **Joker bills**, then Settings → *Joker bills* → paste the feed link. The link is stored **encrypted** (needs `ENCRYPTION_KEY`) and is never shown back.

## The address

* `https://` only (no `http`, no private/local addresses, no redirects to private addresses), the standard port, no username/password in the link.
* `GET` request, no cookies, no headers from Nudge except `Accept` and a normal `User-Agent`. So put the secret **in the link** (for example `?key=<long random string>`) and make it unguessable (32+ random characters). Anyone with the link can read the list; Nudge never sends it anywhere else.
* Answer within **6 seconds**, with a body of at most **2 MB**.
* Send an `ETag` if you can: Nudge sends it back as `If-None-Match` and a `304` means "nothing changed".
* Content type does not matter, but the body must be JSON.

## The format

```json
{
  "version": 1,
  "bills": [
    {
      "id": "bill_2026_10_phone",
      "name": "Phone bill",
      "amount_cents": 4500,
      "currency": "USD",
      "due_date": "2026-10-20",
      "status": "unpaid",
      "autopay": false,
      "notes": "T-Mobile"
    },
    {
      "id": "bill_2026_10_rent",
      "name": "Rent",
      "amount_cents": 90000,
      "due_date": "2026-11-01",
      "status": "paid",
      "paid_on": "2026-10-28",
      "autopay": true
    }
  ]
}
```

A bare list (`[ {...}, {...} ]`) is accepted too.

| Field | Required | Meaning |
|---|---|---|
| `id` | **yes** | A **stable** id for this one bill (this month's phone bill), unique in the list and **never reused or changed**. Nudge de-duplicates on it. One entry per bill *instance* (each month's bill has its own id); do not send recurrence rules. |
| `name` | yes | Shown as the title, max 200 characters. |
| `due_date` | yes | `YYYY-MM-DD`. The bill is due by **11:59 PM that day** in the person's time zone (America/New_York for Miami). |
| `amount_cents` | no | **Whole number of cents** (`4500` = $45.00). Never a decimal. |
| `currency` | no | 3-letter code, default `USD`. |
| `status` | no | `"unpaid"` (default), `"paid"` or `"canceled"`. |
| `paid_on` | no | `YYYY-MM-DD`. Used when `status` is `"paid"`; default is the day Nudge saw it. |
| `autopay` | no | `true` makes Nudge say "Heads up: autopay is on", never "Due now". |
| `notes` | no | Max 2000 characters. |

Max 500 bills. Include the unpaid bills due soon **and** bills paid recently (for a few weeks) so Nudge can see them turn to `paid`.

## What Nudge does with it

* **New bill** → a **Payment** item (due end of `due_date`, amount, autopay flag) with the usual payment reminders (3 days before and on the day, at 9:00 AM), plus a line in *Updates*.
* **Same `id`, changed name / date / amount** → the item is updated (and a moved date is reported in *Updates*).
* **`status: "paid"`** → the payment is marked **done** and recorded under *Payments → recently paid*, once. If you already marked it paid in Nudge, nothing is doubled.
* **`status: "canceled"`**, or the bill **disappears** from the list while it was still open → the item is archived. Bills you paid, and bills you edited yourself in Nudge, are never archived or overwritten.
* **Every problem is shown in Settings**, in plain words, next to the feed (for example *"The bills feed is not in the expected format: bills[2].due_date must be a date like "2026-10-20""* or *"The bills link did not return JSON"*). The previous bills stay as they were.

## Quick check from a terminal

```bash
curl -s "https://YOUR-JOKER/api/nudge-bills?key=..." | head -c 600
```

You should see `{"version":1,"bills":[...` with `due_date` as `YYYY-MM-DD` and `amount_cents` as integers.
