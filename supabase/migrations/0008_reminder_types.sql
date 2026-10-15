-- Nudge, Phase 3, file 8: more kinds of reminders (work, habits, birthdays), checklists, locations.
-- Safe to run more than once. Run it after 0007.
-- Nothing shows up in the app until you switch the matching feature on in Settings.

-- ---------------------------------------------------------------- new kinds of item
alter table public.items drop constraint if exists items_type_check;
alter table public.items add constraint items_type_check
  check (type in ('task', 'homework', 'payment', 'package', 'event', 'renewal', 'work', 'habit', 'birthday'));

-- Where the item comes from. 'classroom', 'colegia' and 'manual' are the agent/inbox sources,
-- 'joker' is the bills sync.
alter table public.items drop constraint if exists items_source_check;
alter table public.items add constraint items_source_check
  check (source in ('manual', 'ics', 'package', 'shortcut', 'email', 'classroom', 'colegia', 'joker'));

alter table public.items add column if not exists location text check (location is null or char_length(location) <= 200);
-- Work items: game_day | registration | sponsor | posting
alter table public.items add column if not exists subtype text check (subtype is null or char_length(subtype) <= 40);

-- The Updates feed learns two more kinds.
alter table public.updates drop constraint if exists updates_kind_check;
alter table public.updates add constraint updates_kind_check
  check (kind in ('new_item', 'changed', 'removed', 'paid', 'info', 'grade', 'bill'));

-- ---------------------------------------------------------------- checklists inside a reminder
create table if not exists public.item_checklist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 200),
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists item_checklist_item_idx on public.item_checklist (item_id, sort_order);

-- ---------------------------------------------------------------- one habit summary a day
create table if not exists public.habit_summary_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ---------------------------------------------------------------- security
do $sec$
declare
  t text;
  tables text[] := array['item_checklist'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end;
$sec$;

alter table public.habit_summary_sends enable row level security;
revoke all on public.habit_summary_sends from anon, authenticated;

-- ---------------------------------------------------------------- clock: the daily habit summary
-- For people who chose "one summary instead of many pings" (Settings > Habits). Sent once a day at
-- the time they picked (default 8:00 PM), only when something is still open today.
create or replace function public.dispatch_habit_summaries(p_now timestamptz, p_window_minutes integer default 90)
returns table (user_id uuid, timezone text, language text, local_date date, pending integer, total integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  return query
  with cand as (
    select p.user_id, p.timezone, p.language,
           (p_now at time zone p.timezone)::date as local_date,
           (date_trunc('day', p_now at time zone p.timezone)) at time zone p.timezone as day_start,
           coalesce(nullif(p.prefs ->> 'habit_summary_time', ''), '20:00')::time as at_time
    from public.profiles p
    where (p.prefs ->> 'habit_summary') = 'true'
      and coalesce((p.features ->> 'habits')::boolean, false)
  ),
  due as (
    select c.* from cand c
    where extract(epoch from ((p_now at time zone c.timezone)::time - c.at_time)) / 60.0
          between 0 and p_window_minutes
  ),
  counts as (
    select d.*,
      (select count(*) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = d.user_id and i.type = 'habit' and i.status = 'open'
          and o.status = 'open'
          and o.due_at >= d.day_start and o.due_at < d.day_start + interval '1 day')::integer as pending,
      (select count(*) from public.occurrences o join public.items i on i.id = o.item_id
        where o.user_id = d.user_id and i.type = 'habit' and i.status = 'open'
          and o.due_at >= d.day_start and o.due_at < d.day_start + interval '1 day')::integer as total
    from due d
  ),
  worth as (select * from counts where counts.pending > 0),
  ins as (
    insert into public.habit_summary_sends (user_id, local_date)
    select w.user_id, w.local_date from worth w
    on conflict do nothing
    returning habit_summary_sends.user_id, habit_summary_sends.local_date
  )
  select w.user_id, w.timezone, w.language, w.local_date, w.pending, w.total
  from worth w join ins on ins.user_id = w.user_id and ins.local_date = w.local_date;
end;
$fn$;

-- ---------------------------------------------------------------- who may run what
do $perm$
declare
  fn text;
  fns text[] := array['dispatch_habit_summaries(timestamptz, integer)'];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end;
$perm$;
