-- Nudge, Phase 1, file 4: the reminder clock's database side.
-- Tables that remember what was sent, plus the functions the /api/dispatch route calls.
-- Only the server's secret key can run these functions. Safe to run more than once.

-- ---------------------------------------------------------------- tables
create table if not exists public.reminder_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  occurrence_id uuid not null references public.occurrences (id) on delete cascade,
  key text not null,
  fire_at timestamptz not null,
  status text not null check (status in ('claimed', 'held', 'sent', 'failed', 'skipped')),
  label text,
  send_after timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- This line is what makes double sends impossible: one row per reminder per time.
  unique (occurrence_id, key)
);

create index if not exists reminder_sends_user_idx on public.reminder_sends (user_id, created_at desc);
create index if not exists reminder_sends_open_idx on public.reminder_sends (status)
  where status in ('claimed', 'held', 'failed');

create table if not exists public.summary_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create table if not exists public.dispatch_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  now_used timestamptz not null,
  claimed integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  held integer not null default 0,
  summaries integer not null default 0,
  duration_ms integer,
  note text
);

create index if not exists dispatch_log_ran_idx on public.dispatch_log (ran_at desc);

-- Locked down: people may read their own send history; the logs are server-only.
alter table public.reminder_sends enable row level security;
alter table public.summary_sends enable row level security;
alter table public.dispatch_log enable row level security;

revoke all on public.reminder_sends from anon;
revoke all on public.summary_sends from anon, authenticated;
revoke all on public.dispatch_log from anon, authenticated;
grant select on public.reminder_sends to authenticated;

drop policy if exists reminder_sends_select_own on public.reminder_sends;
create policy reminder_sends_select_own on public.reminder_sends
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- small helpers
create or replace function public.nudge_in_quiet(p_local time, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_start = p_end then false
    when p_start < p_end then p_local >= p_start and p_local < p_end
    else p_local >= p_start or p_local < p_end
  end;
$fn$;

-- The next moment quiet hours end, in the person's own time zone.
create or replace function public.nudge_quiet_end_at(p_now timestamptz, p_tz text, p_end time)
returns timestamptz
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select ((date_trunc('day', p_now at time zone p_tz) + p_end)
          + case when (p_now at time zone p_tz)::time >= p_end then interval '1 day' else interval '0' end)
         at time zone p_tz;
$fn$;

-- ---------------------------------------------------------------- shape rows for the server
create or replace function public.dispatch_rows(p_send_ids uuid[])
returns table (
  send_id uuid, user_id uuid, item_id uuid, title text, item_type text,
  due_at timestamptz, all_day boolean, amount_cents integer, currency text,
  kind text, label text, fire_at timestamptz, timezone text, language text
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select rs.id, rs.user_id, i.id, i.title, i.type, o.due_at, i.all_day, i.amount_cents, i.currency,
         case when rs.key like 's:%' then 'snooze' else 'reminder' end,
         rs.label, rs.fire_at, p.timezone, p.language
  from public.reminder_sends rs
  join public.occurrences o on o.id = rs.occurrence_id
  join public.items i on i.id = o.item_id
  join public.profiles p on p.user_id = rs.user_id
  where rs.id = any (p_send_ids)
  order by o.due_at, rs.id;
$fn$;

-- ---------------------------------------------------------------- claim what is due
-- Writes one row per reminder that is due, then returns only the rows THIS call wrote.
-- A second call at the same moment writes nothing, so nothing is ever sent twice.
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
declare
  claimed_ids uuid[];
begin
  with cand as (
    select o.id as occ_id, o.user_id, o.due_at, i.type as item_type, i.priority, i.space_id,
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
    select o.id, o.user_id, o.due_at, i.type, i.priority, i.space_id,
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
             when pr.nudge_style = 'morning' and d.priority < 2 then 'skipped'
             when pr.nudge_style = 'important' and d.priority < 1 then 'skipped'
             when not (pr.urgent_override and (d.due_at - p_now) <= interval '1 hour')
                  and public.nudge_in_quiet((p_now at time zone pr.timezone)::time, pr.quiet_start, pr.quiet_end)
               then 'held'
             else 'claimed'
           end as decision
    from due d
    join public.profiles pr on pr.user_id = d.user_id
  ),
  ins as (
    insert into public.reminder_sends (user_id, occurrence_id, key, fire_at, status, label, send_after, claimed_at)
    select dd.user_id, dd.occ_id, dd.key, dd.fire_at, dd.decision, p_label,
           case when dd.decision = 'held'
                then public.nudge_quiet_end_at(p_now, dd.tz, dd.quiet_end) end,
           p_now
    from decided dd
    on conflict (occurrence_id, key) do nothing
    returning id, status
  )
  select coalesce(array_agg(ins.id) filter (where ins.status = 'claimed'), '{}'::uuid[])
    into claimed_ids
  from ins;

  return query select * from public.dispatch_rows(claimed_ids);
end;
$fn$;

-- Releases held reminders (quiet hours ended), retries failed ones, and rescues
-- reminders whose sender crashed. Items finished in the meantime are dropped.
create or replace function public.dispatch_reclaim(p_now timestamptz)
returns table (
  send_id uuid, user_id uuid, item_id uuid, title text, item_type text,
  due_at timestamptz, all_day boolean, amount_cents integer, currency text,
  kind text, label text, fire_at timestamptz, timezone text, language text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  ids uuid[];
begin
  -- Drop anything the person already finished, skipped or deleted the day before.
  update public.reminder_sends rs set status = 'skipped'
  where (
      (rs.status = 'held' and rs.send_after <= p_now)
      or (rs.status = 'failed' and rs.attempts < 3 and rs.claimed_at > p_now - interval '10 minutes')
      or (rs.status = 'claimed' and rs.sent_at is null and rs.claimed_at < p_now - interval '3 minutes' and rs.attempts < 2)
    )
    and not exists (
      select 1 from public.occurrences o
      join public.items i on i.id = o.item_id
      where o.id = rs.occurrence_id and o.status = 'open' and i.status = 'open'
    );

  with moved as (
    update public.reminder_sends rs
    set status = 'claimed',
        claimed_at = p_now,
        attempts = rs.attempts + case when rs.status = 'claimed' then 1 else 0 end
    where (rs.status = 'held' and rs.send_after <= p_now)
       or (rs.status = 'failed' and rs.attempts < 3 and rs.claimed_at > p_now - interval '10 minutes')
       or (rs.status = 'claimed' and rs.sent_at is null and rs.claimed_at < p_now - interval '3 minutes' and rs.attempts < 2)
    returning rs.id
  )
  select coalesce(array_agg(moved.id), '{}'::uuid[]) into ids from moved;

  return query select * from public.dispatch_rows(ids);
end;
$fn$;

create or replace function public.dispatch_finish(p_send_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Bad status %', p_status;
  end if;
  update public.reminder_sends
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      attempts = attempts + case when p_status = 'failed' then 1 else 0 end
  where id = p_send_id and status = 'claimed';
end;
$fn$;

-- ---------------------------------------------------------------- morning summary
create or replace function public.dispatch_summaries(p_now timestamptz, p_window_minutes integer default 90)
returns table (
  user_id uuid, timezone text, language text, local_date date,
  today_count integer, late_count integer, payments_count integer, payments_cents bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  with cand as (
    select p.user_id, p.timezone, p.language,
           (p_now at time zone p.timezone)::date as local_date,
           (date_trunc('day', p_now at time zone p.timezone)) at time zone p.timezone as day_start
    from public.profiles p
    where p.morning_enabled and p.onboarded
      and extract(epoch from ((p_now at time zone p.timezone)::time - p.morning_time)) / 60.0
          between 0 and p_window_minutes
  ),
  counts as (
    select c.*,
      (select count(*) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = c.user_id and o.status = 'open' and i.status = 'open'
          and o.due_at >= c.day_start and o.due_at < c.day_start + interval '1 day'
          and not exists (select 1 from public.spaces s where s.id = i.space_id and not s.notifications_enabled)
      )::integer as today_count,
      (select count(*) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = c.user_id and o.status = 'open' and i.status = 'open'
          and o.due_at < c.day_start and o.due_at >= c.day_start - interval '30 days'
          and not exists (select 1 from public.spaces s where s.id = i.space_id and not s.notifications_enabled)
      )::integer as late_count,
      (select count(*) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = c.user_id and o.status = 'open' and i.status = 'open' and i.type = 'payment'
          and o.due_at >= c.day_start and o.due_at < c.day_start + interval '7 days'
      )::integer as payments_count,
      (select coalesce(sum(i.amount_cents), 0) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = c.user_id and o.status = 'open' and i.status = 'open' and i.type = 'payment'
          and o.due_at >= c.day_start and o.due_at < c.day_start + interval '7 days'
      )::bigint as payments_cents
    from cand c
  ),
  worth as (
    select * from counts where today_count > 0 or late_count > 0 or payments_count > 0
  ),
  ins as (
    insert into public.summary_sends (user_id, local_date)
    select w.user_id, w.local_date from worth w
    on conflict do nothing
    returning summary_sends.user_id, summary_sends.local_date
  )
  select w.user_id, w.timezone, w.language, w.local_date, w.today_count, w.late_count,
         w.payments_count, w.payments_cents
  from worth w join ins on ins.user_id = w.user_id and ins.local_date = w.local_date;
end;
$fn$;

-- ---------------------------------------------------------------- phones
create or replace function public.dispatch_subscriptions(p_user_ids uuid[])
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select s.user_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id = any (p_user_ids);
$fn$;

create or replace function public.dispatch_remove_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$fn$;

-- ---------------------------------------------------------------- repeating items
create or replace function public.dispatch_series_needing_topup(p_horizon timestamptz, p_limit integer default 200)
returns table (item_id uuid, user_id uuid, start_at timestamptz, timezone text, rrule text, last_due timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select i.id, i.user_id, i.due_at, i.timezone, i.rrule,
         (select max(o.due_at) from public.occurrences o where o.item_id = i.id)
  from public.items i
  where i.rrule is not null and i.status = 'open' and i.due_at is not null
    and coalesce((select max(o.due_at) from public.occurrences o where o.item_id = i.id), '-infinity'::timestamptz) < p_horizon
  limit p_limit;
$fn$;

create or replace function public.dispatch_add_occurrences(p_item_id uuid, p_dues timestamptz[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  insert into public.occurrences (user_id, item_id, due_at)
  select i.user_id, i.id, d
  from public.items i, unnest(coalesce(p_dues, '{}'::timestamptz[])) as d
  where i.id = p_item_id and i.status = 'open'
  on conflict (item_id, due_at) do nothing;
$fn$;

-- ---------------------------------------------------------------- logging and cleanup
create or replace function public.dispatch_log_write(
  p_now timestamptz, p_claimed integer, p_sent integer, p_failed integer,
  p_held integer, p_summaries integer, p_duration_ms integer, p_note text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  insert into public.dispatch_log (now_used, claimed, sent, failed, held, summaries, duration_ms, note)
  values (p_now, p_claimed, p_sent, p_failed, p_held, p_summaries, p_duration_ms, p_note);
$fn$;

-- Keeps the free 500 MB database small: the clock's own log, our log, old send records.
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
end;
$fn$;

-- ---------------------------------------------------------------- who may run what
do $perm$
declare
  fn text;
  fns text[] := array[
    'dispatch_rows(uuid[])',
    'dispatch_claim(timestamptz, integer, integer, text)',
    'dispatch_reclaim(timestamptz)',
    'dispatch_finish(uuid, text)',
    'dispatch_summaries(timestamptz, integer)',
    'dispatch_subscriptions(uuid[])',
    'dispatch_remove_subscription(text)',
    'dispatch_series_needing_topup(timestamptz, integer)',
    'dispatch_add_occurrences(uuid, timestamptz[])',
    'dispatch_log_write(timestamptz, integer, integer, integer, integer, integer, integer, text)',
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
