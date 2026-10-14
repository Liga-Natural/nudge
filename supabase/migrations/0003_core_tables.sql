-- Nudge, Phase 1, file 3: profile, spaces, items, occurrences, reminders, history.
-- Safe to run more than once. Every table is locked so each person only sees their own rows.

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create or replace function public.check_timezone_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone;
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'America/New_York',
  language text not null default 'en' check (language in ('en', 'es')),
  mode text not null default 'full' check (mode in ('simple', 'full')),
  track_types text[] not null default '{}',
  nudge_style text not null default 'on_time'
    check (nudge_style in ('morning', 'on_time', 'before', 'important')),
  morning_enabled boolean not null default true,
  morning_time time not null default '08:00',
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:00',
  urgent_override boolean not null default true,
  type_switches jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_check_tz on public.profiles;
create trigger profiles_check_tz before insert or update of timezone on public.profiles
  for each row execute function public.check_timezone_name();

-- ---------------------------------------------------------------- spaces
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  emoji text not null default '📁',
  is_default boolean not null default false,
  notifications_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create unique index if not exists spaces_one_default_per_user
  on public.spaces (user_id) where is_default;

-- ---------------------------------------------------------------- items
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid references public.spaces (id) on delete set null,
  type text not null default 'task'
    check (type in ('task', 'homework', 'payment', 'package', 'event', 'renewal')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  due_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'America/New_York',
  status text not null default 'open'
    check (status in ('open', 'done', 'skipped', 'archived')),
  priority smallint not null default 0 check (priority between 0 and 2),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  currency text not null default 'USD',
  rrule text check (rrule is null or char_length(rrule) <= 300),
  source text not null default 'manual'
    check (source in ('manual', 'ics', 'package', 'shortcut', 'email')),
  external_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_user_status_idx on public.items (user_id, status);
create index if not exists items_user_space_idx on public.items (user_id, space_id);

drop trigger if exists items_updated_at on public.items;
create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists items_check_tz on public.items;
create trigger items_check_tz before insert or update of timezone on public.items
  for each row execute function public.check_timezone_name();

-- ---------------------------------------------------------------- occurrences
-- One row per time something is due. A normal item has one; a repeating item has
-- the next several, which the app and the clock keep topped up.
create table if not exists public.occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  snoozed_until timestamptz,
  snooze_count integer not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, due_at)
);

create index if not exists occurrences_user_open_due_idx
  on public.occurrences (user_id, due_at) where status = 'open';
create index if not exists occurrences_snooze_idx
  on public.occurrences (snoozed_until) where snoozed_until is not null and status = 'open';

-- ---------------------------------------------------------------- reminders
-- Either "N minutes before the due time" (offset_minutes), or
-- "N days before, at a clock time" (days_before + at_time).
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  offset_minutes integer check (offset_minutes between 0 and 525600),
  days_before integer check (days_before between 0 and 365),
  at_time time,
  created_at timestamptz not null default now(),
  check (
    (offset_minutes is not null and days_before is null and at_time is null)
    or (offset_minutes is null and days_before is not null and at_time is not null)
  )
);

create unique index if not exists reminders_unique_per_item
  on public.reminders (
    item_id,
    coalesce(offset_minutes, -1),
    coalesce(days_before, -1),
    coalesce(at_time, time '00:00')
  );

-- ---------------------------------------------------------------- history
create table if not exists public.item_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  kind text not null check (kind in ('created', 'done', 'skipped', 'snoozed', 'reopened', 'edited')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists item_events_item_idx on public.item_events (item_id, created_at desc);

-- ---------------------------------------------------------------- security
do $sec$
declare
  t text;
  tables text[] := array['profiles', 'spaces', 'items', 'occurrences', 'reminders', 'item_events'];
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

grant usage on schema public to authenticated;

-- ---------------------------------------------------------------- app helpers
-- Makes sure the signed-in person has a profile and a default "Personal" space.
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := (select auth.uid());
  result public.profiles;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  insert into public.spaces (user_id, name, emoji, is_default)
    values (uid, 'Personal', '🏠', true)
    on conflict do nothing;
  select * into result from public.profiles where user_id = uid;
  return result;
end;
$fn$;

-- Replaces the still-open future occurrences of one item with the given list.
-- Done and skipped occurrences are never touched.
create or replace function public.sync_item_occurrences(p_item_id uuid, p_dues timestamptz[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.items where id = p_item_id and user_id = uid) then
    raise exception 'Item not found';
  end if;
  delete from public.occurrences
    where item_id = p_item_id and user_id = uid and status = 'open'
      and not (due_at = any (coalesce(p_dues, '{}'::timestamptz[])));
  insert into public.occurrences (user_id, item_id, due_at)
    select uid, p_item_id, d from unnest(coalesce(p_dues, '{}'::timestamptz[])) as d
    on conflict (item_id, due_at) do nothing;
end;
$fn$;

revoke all on function public.ensure_profile() from public, anon;
revoke all on function public.sync_item_occurrences(uuid, timestamptz[]) from public, anon;
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.sync_item_occurrences(uuid, timestamptz[]) to authenticated;
