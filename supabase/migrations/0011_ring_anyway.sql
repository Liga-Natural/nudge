-- Nudge, Phase 4, file 11: "ring anyway" for reminders you save inside quiet hours.
-- Safe to run more than once. Run it after 0010.
--
-- When you save a reminder whose alert would land in quiet hours, the app now asks
-- "This is during quiet hours - ring anyway?". "Ring anyway" sets this flag on the item; the clock
-- then lets that item's reminders through. "Keep quiet" leaves the flag off and the reminder is held
-- until quiet hours end (the Delivery log now says exactly when).

alter table public.items add column if not exists ring_anyway boolean not null default false;

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
    select o.id as occ_id, o.user_id, o.due_at, i.type as item_type, i.space_id, i.ring_anyway,
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
    select o.id, o.user_id, o.due_at, i.type, i.space_id, i.ring_anyway,
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
             when d.item_type = 'habit' and (pr.prefs ->> 'habit_summary') = 'true' then 'skipped'
             when not (d.ring_anyway or (pr.urgent_override and (d.due_at - p_now) <= interval '1 hour'))
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
             when 'skipped' then case
               when dd.item_type = 'habit' and (select (p2.prefs ->> 'habit_summary') = 'true' from public.profiles p2 where p2.user_id = dd.user_id)
                 then 'Habit reminders are bundled into your one daily habit summary (Settings).'
               else 'The "' || dd.item_type || '" switch or this space is turned off in Settings.'
             end
             when 'held' then 'Held — quiet hours, will send at ' || to_char(dd.quiet_end, 'FMHH12:MI AM')
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

-- "Delete" in the app now hides an item first (so Undo works); items hidden for 30 days are removed for good.
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
  delete from public.items where status = 'archived' and feed_id is null and updated_at < now() - interval '30 days';
end;
$fn$;
