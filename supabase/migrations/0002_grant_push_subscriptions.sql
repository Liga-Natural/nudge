-- Nudge, Phase 0, file 2: lets signed-in users use their own push_subscriptions rows.
-- Newer Supabase projects don't hand out table permissions automatically.
-- The security rules (RLS) from file 1 still limit each person to their own rows.
-- Safe to run more than once.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Signed-out visitors get nothing.
revoke all on public.push_subscriptions from anon;
