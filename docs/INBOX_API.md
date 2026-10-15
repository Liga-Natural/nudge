# Nudge inbox: bringing school work in

One JSON format, two ways to send it:

1. **The Import page** (`/import`) – for you, signed in. Paste the JSON, look at the preview (New / Updated / Unchanged), tap **Confirm import**. A browser agent running in your own Chrome can use this page and needs **no token**.
2. **`POST /api/inbox`** – for a script or agent with a **personal access token** (Settings → Agent import).

Both need the **Agent import** switch turned on in Settings → Features (it is off by default).

Sending the same data twice never makes duplicates: everything is matched on **(source, external_id)** and updated in place.

---

## The format

```json
{
  "version": 1,
  "source": "classroom",
  "classes": [
    { "external_id": "math-101", "name": "Math 101", "teacher": "Ms. Cruz" }
  ],
  "assignments": [
    {
      "external_id": "hw-3",
      "class": "math-101",
      "title": "Chapter 3 problems",
      "due": "2026-10-22T23:59:00-04:00",
      "notes": "Odd numbers only",
      "url": "https://classroom.google.com/c/abc/a/def",
      "done": false
    }
  ],
  "grades": [
    {
      "external_id": "quiz-2",
      "class": "math-101",
      "assignment": "hw-3",
      "title": "Quiz 2",
      "score": 18,
      "out_of": 20,
      "posted": "2026-10-14",
      "comment": "Nice work"
    }
  ]
}
```

### Top level

| Field | Required | Notes |
|---|---|---|
| `source` | yes | `"classroom"`, `"colegia"` or `"manual"`. Each source has its own id space, so a Classroom id and a Colegia id never collide. |
| `version` | no | Only `1` exists. |
| `classes`, `assignments`, `grades` | at least one item in total | Max 100 classes, 1000 assignments, 2000 grades per request, 1 MB total. Send bigger sets in batches. |

Unknown fields are rejected on purpose (so a typo such as `"duedate"` is caught instead of silently ignored).

### `classes[]`

| Field | Required | Notes |
|---|---|---|
| `external_id` | yes | Your stable id for the class (max 120 characters). Unique within the request. |
| `name` | yes | Max 60 characters. If you already have a class with this name that was typed by hand, it is **adopted** (given this external id), not duplicated. |
| `teacher` | no | |

### `assignments[]`  → Homework in Nudge

| Field | Required | Notes |
|---|---|---|
| `external_id` | yes | Stable id. |
| `title` | yes | Max 200 characters. |
| `class` | no | The `external_id` of a class (in this request or imported before), or the class **name**. If it is not known, the assignment is still added, without a class, and a warning is returned. |
| `due` | no | `"2026-10-22"` (a bare date means **11:59 PM that day in your time zone**), `"2026-10-22T20:00"` (your time zone), or with an offset/`Z` (`"2026-10-22T20:00:00-04:00"`). |
| `notes`, `url` | no | The url is added to the notes. |
| `done` | no | `true` marks it done. |

Each new assignment becomes a **Homework** item with the class and due time, and two reminders: **the night before** (default 6:00 PM) and **2 hours before** (both adjustable, or off, in Settings → Homework reminders). An assignment you edited by hand in Nudge is left alone on later imports; one you finished stays finished.

### `grades[]`

| Field | Required | Notes |
|---|---|---|
| `external_id` | yes | Stable id. |
| `class` | **yes** | Same rules as above. A grade whose class is unknown is skipped, with a warning. |
| `title` | yes | |
| `score`, `out_of` | yes | Numbers. `score >= 0`, `out_of > 0`. Percent is worked out for you. |
| `assignment` | no | The `external_id` of an assignment, to link them. |
| `posted` | no | Date or date-time, as for `due`. Default: now. |
| `comment` | no | Max 500 characters. |

A class average in Nudge is **points earned ÷ points possible** (a 5/5 quiz and a 45/100 test average to 50/105 = 47.6%).

**"New grade posted in <class>" push:** sent once for a grade that is **new**, from `classroom` or `colegia`, and was posted in the last 7 days. Grades with `source: "manual"`, older grades (a whole report card on the first import), and corrections to an existing grade do not send a push.

---

## 1. The Import page

`/import` (signed in). Stable hooks for a browser agent:

* textarea: `#import-json` (label **Import JSON**)
* button **Preview →** shows what would happen and saves nothing
* button **Confirm import (N)** saves (appears after a preview; N = number of new/updated things)
* result heading **Imported ✓**
* errors appear in an element with `role="alert"` that starts with *Please fix this first:*

Typical agent steps: open `/import` → fill `#import-json` → click Preview → read the counts → click Confirm.

---

## 2. `POST /api/inbox`

```bash
curl -X POST https://YOUR-APP/api/inbox \
  -H "Authorization: Bearer ndg_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  --data @import.json
```

* Add `?dry_run=1` to only preview (nothing is saved).
* `GET /api/inbox` with the same header is the **token test** (Settings has a *Test token* button that does exactly this).

### Success

```json
{
  "ok": true,
  "dry_run": false,
  "committed": true,
  "counts": {
    "classes":     { "new": 1, "updated": 0, "unchanged": 0 },
    "assignments": { "new": 1, "updated": 0, "unchanged": 0 },
    "grades":      { "new": 1, "updated": 0, "unchanged": 0 }
  },
  "results": [ { "kind": "assignment", "external_id": "hw-3", "title": "Chapter 3 problems", "status": "new" } ],
  "warnings": []
}
```

### Tokens

Make one in **Settings → Agent import → Create token**. It is shown **once**; only a SHA-256 fingerprint is stored. You can revoke or delete it any time, and see when it was last used. At most 10 active tokens.

### Errors (always JSON: `{ "ok": false, "code": "...", "error": "plain words" }`)

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `no_token` | No `Authorization` header. |
| 401 | `bad_header` | The header does not start with `Bearer `. |
| 401 | `empty_token` | `Bearer` with nothing after it. |
| 401 | `wrong_token_type` | Not a Nudge token (they start with `ndg_`). |
| 401 | `unknown_token` | Right shape, but not one we issued (copied wrongly, or deleted). |
| 401 | `revoked` | The token was revoked. |
| 401 | `expired` | The token expired. |
| 400 | `invalid_payload` | The JSON is broken or does not match the format. `problems` lists each issue, e.g. `grades[2].score: cannot be negative`. |
| 405 | `method_not_allowed` | Use `POST` (or `GET` to test). |
| 409 | `import_failed` | The account has never been opened in Nudge yet. |
| 413 | `too_big` | More than 1 MB. |
| 429 | `rate_limited` | Slow down. See the `Retry-After` header (seconds). |
| 503 | `not_configured` | The server has no `SUPABASE_SECRET_KEY` yet. |

### Rate limits

30 requests per minute per token, and 120 per minute per IP address (counted before the token is looked at, to slow down guessing). The counters live in the database, so they are shared by every server copy.

### Safety

* The token only allows **this one thing**: sending school data into **your own** account. It cannot read anything back except its own name and last-used time.
* Imports never delete anything.
* Time zone: dates without an offset use the time zone in your Nudge profile (America/New_York for Miami).
