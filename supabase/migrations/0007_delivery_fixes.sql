-- Nudge, Phase 3, file 7: fixes why a reminder could silently never arrive, plus the Delivery log.
-- Safe to run more than once. Run it after 0004 (and 0006).
--
-- What was wrong: choosing "Morning summary" or "Only important stuff" while setting Nudge up made the
-- reminder clock quietly throw away every reminder you set yourself (the clock counted them as
-- "skipped", which never showed in its answer). Now a reminder you set always fires; the only things
-- that stop one are the switches you can see in Settings, and every such case is written down with
-- its reason in the Delivery log.

-- ---------------------------------------------------------------- why a reminder was held or skipped
alter table public.reminder_sends add column if not exists detail text;

-- ---------------------------------------------------------------- delivery log (what you see in Settings)
create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  send_id uuid references public.reminder_sends (id) on delete set null,
  kind text not null default 'reminder'
    check (kind in ('reminder', 'summary', 'test', 'catchup', 'grade', 'habit')),
  title text not null default '',
  status text not null check (status in ('sent', 'failed', 'held', 'skipped', 'no_phone')),
  error text,
  http_status integer,
  created_at timestamptz not null default now()
);

create index if not exists delivery_attempts_user_idx on public.delivery_attempts (user_id, created_at desc);

alter table public.delivery_attempts enable row level security;
revoke all on public.delivery_attempts from anon;
revoke insert, update, delete on public.delivery_attempts from authenticated;
grant select on public.delivery_attempts to authenticated;
drop policy if exists delivery_attempts_select_own on public.delivery_attempts;
create policy delivery_attempts_select_own on public.delivery_attempts
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- the clock: claim what is due
-- Same inputs and outputs as before. The difference: no "nudge style" filter any more, and every
-- held or skipped reminder is recorded with a plain-words reason.
create or replace function public.dispatch_claim(
  p_now timestamptz,
  p_window_minutes integer default 2,
  p_min_age_minutes integer default 0,
  p_label text default null
)
returns table (
  send_id uuid, user_id uuid, item_id uuid, title text, item_type text,
  due_at timestamptz, all_day boolean, amount_cents integer, currency text,
  kind text, label text, fire_at timestamptz, timezone text, language text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  claimed_ids uuid[];
begin
  with cand as (
    select o.id as occ_id, o.user_id, o.due_at, i.type as item_type, i.space_id,
           ('r:' || r.id::text) as key,
           case
             when r.offset_minutes is not null
               then o.due_at - (r.offset_minutes * interval '1 minute')
             else (((o.due_at at time zone i.timezone)::date - r.days_before) + r.at_time)
                  at time zone i.timezone
           end as fire_at
    from public.occurrences o
    join public.items i on i.id = o.item_id
    join public.reminders r on r.item_id = i.id
    where o.status = 'open' and i.status = 'open'
      and (o.snoozed_until is null or o.snoozed_until <= p_now)
      and o.due_at > p_now - (p_window_minutes * interval '1 minute') - interval '2 days'
      and o.due_at <= p_now + interval '367 days'
    union all
    select o.id, o.user_id, o.due_at, i.type, i.space_id,
           ('s:' || extract(epoch from o.snoozed_until)::bigint::text),
           o.snoozed_until
    from public.occurrences o
    join public.items i on i.id = o.item_id
    where o.status = 'open' and i.status = 'open' and o.snoozed_until is not null
  ),
  due as (
    select c.* from cand c
    where c.fire_at <= p_now - (p_min_age_minutes * interval '1 minute')
      and c.fire_at > p_now - (p_window_minutes * interval '1 minute')
  ),
  decided as (
    select d.*,
           pr.timezone as tz, pr.quiet_start, pr.quiet_end,
           case
             when (pr.type_switches ->> d.item_type) = 'false' then 'skipped'
             when exists (select 1 from public.spaces s
                          where s.id = d.space_id and not s.notifications_enabled) then 'skipped'
             when not (pr.urgent_override and (d.due_at - p_now) <= interval '1 hour')
                  and public.nudge_in_quiet((p_now at time zone pr.timezone)::time, pr.quiet_start, pr.quiet_end)
               then 'held'
             else 'claimed'
           end as decision
    from due d
    join public.profiles pr on pr.user_id = d.user_id
  ),
  ins as (
    insert into public.reminder_sends (user_id, occurrence_id, key, fire_at, status, label, send_after, claimed_at, detail)
    select dd.user_id, dd.occ_id, dd.key, dd.fire_at, dd.decision, p_label,
           case when dd.decision = 'held'
                then public.nudge_quiet_end_at(p_now, dd.tz, dd.quiet_end) end,
           p_now,
           case dd.decision
             when 'skipped' then 'The "' || dd.item_type || '" switch or this space is turned off in Settings.'
             when 'held' then 'Quiet hours: held until ' || to_char(dd.quiet_end, 'HH12:MI AM') || '.'
           end
    from decided dd
    on conflict (occurrence_id, key) do nothing
    returning id, status
  )
  select coalesce(array_agg(ins.id) filter (where ins.status = 'claimed'), '{}'::uuid[])
    into claimed_ids
  from ins;

  -- Write held and skipped reminders into the Delivery log, once each.
  insert into public.delivery_attempts (user_id, send_id, kind, title, status, error)
  select rs.user_id, rs.id, case when p_label = 'missed' then 'catchup' else 'reminder' end,
         i.title, rs.status, rs.detail
  from public.reminder_sends rs
  join public.occurrences o on o.id = rs.occurrence_id
  join public.items i on i.id = o.item_id
  where rs.claimed_at = p_now and rs.status in ('held', 'skipped')
    and not exists (select 1 from public.delivery_attempts a where a.send_id = rs.id);

  return query select * from public.dispatch_rows(claimed_ids);
end;
$fn$;

-- ---------------------------------------------------------------- small server helpers
create or replace function public.dispatch_occurrence_ids(p_send_ids uuid[])
returns table (send_id uuid, occurrence_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select rs.id, rs.occurrence_id from public.reminder_sends rs where rs.id = any (p_send_ids);
$fn$;

create or replace function public.dispatch_log_attempt(
  p_user_id uuid, p_send_id uuid, p_kind text, p_title text,
  p_status text, p_error text default null, p_http_status integer default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  insert into public.delivery_attempts (user_id, send_id, kind, title, status, error, http_status)
  values (p_user_id, p_send_id, p_kind, left(coalesce(p_title, ''), 200), p_status, left(p_error, 500), p_http_status);
$fn$;

-- How many reminders this minute's claim held back or skipped (they never appear as "claimed").
create or replace function public.dispatch_tick_stats(p_now timestamptz)
returns table (held integer, skipped integer)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select (count(*) filter (where status = 'held'))::integer,
         (count(*) filter (where status = 'skipped'))::integer
  from public.reminder_sends
  where claimed_at = p_now and status in ('held', 'skipped');
$fn$;

-- Keep the free database small: the Delivery log keeps 30 days.
create or replace function public.nudge_cleanup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details where end_time < now() - interval '7 days';
  end if;
  delete from public.dispatch_log where ran_at < now() - interval '30 days';
  delete from public.reminder_sends where created_at < now() - interval '90 days';
  delete from public.summary_sends where sent_at < now() - interval '90 days';
  delete from public.delivery_attempts where created_at < now() - interval '30 days';
end;
$fn$;

-- ---------------------------------------------------------------- who may run what
do $perm$
declare
  fn text;
  fns text[] := array[
    'dispatch_claim(timestamptz, integer, integer, text)',
    'dispatch_occurrence_ids(uuid[])',
    'dispatch_log_attempt(uuid, uuid, text, text, text, text, integer)',
    'dispatch_tick_stats(timestamptz)',
    'nudge_cleanup()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end;
$perm$;
