# NIGHT_LOG — Nudge

## Handoff (top)
- **Phase 0 finished Oct 14, 2026.** Live at https://nudge-ivory.vercel.app (Vercel Production tracks the `phase-0-setup` branch). `main` has only HANDOFF.md; nothing merged.
- Verified by Adrian on his iPhone: installed to Home Screen, email-code login, test notification arrives.
- Next: Phase 1 (core reminders). Start by deciding whether to merge `phase-0-setup` into `main` and switch Vercel's Production branch back to `main`.

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
- No unit tests, PGlite migration tests, RLS check file, Playwright, axe or Lighthouse yet (Definition of Done items; due with Phase 1).
- No rate limiting on API routes; no CSP with nonce yet.
- No Dependabot yet.
- Whether the every-minute clock counts as "activity" for Supabase's free-plan pause is not stated in the docs (see HANDOFF section 12 item 1); the daily email check is the safety net (Phase 1).
- Only one iPhone tested; no Android/desktop push test on the live site.
