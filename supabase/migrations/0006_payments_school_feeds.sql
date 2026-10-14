-- Nudge, Phase 2, file 6: payments, school courses, calendar feeds, the Updates feed.
-- Safe to run more than once. Run it after 0003 and 0004.

-- ---------------------------------------------------------------- feature switches
-- Everything beyond the core is optional and OFF until you switch it on in Settings > Features.
alter table public.profiles add column if not exists features jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- courses
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default '#e4edff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------- calendar feeds
-- The feed address is stored encrypted by the app (ENCRYPTION_KEY); `host` is only for display.
create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  url_encrypted text not null,
  host text not null default '',
  default_type text not null default 'task' check (default_type in ('task', 'homework', 'payment', 'event')),
  space_id uuid references public.spaces (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  etag text,
  last_error text,
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- item extras
alter table public.items add column if not exists autopay boolean not null default false;
alter table public.items add column if not exists course_id uuid references public.courses (id) on delete set null;
alter table public.items add column if not exists feed_id uuid references public.calendar_feeds (id) on delete set null;
alter table public.items add column if not exists locally_edited boolean not null default false;

-- One item per calendar event, per feed. This is what stops duplicates when a feed refreshes.
create unique index if not exists items_feed_uid_unique
  on public.items (feed_id, external_uid) where feed_id is not null and external_uid is not null;

-- ---------------------------------------------------------------- payments made
create table if not exists public.item_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  occurrence_id uuid references public.occurrences (id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  paid_on date not null,
  created_at timestamptz not null default now()
);

create index if not exists item_payments_item_idx on public.item_payments (item_id, paid_on desc);

-- ---------------------------------------------------------------- updates feed
create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('new_item', 'changed', 'removed', 'paid', 'info')),
  title text not null,
  body text,
  item_id uuid references public.items (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists updates_user_idx on public.updates (user_id, created_at desc);

-- ---------------------------------------------------------------- security: owner-only, nothing for visitors
do $sec$
declare
  t text;
  tables text[] := array['courses', 'calendar_feeds', 'item_payments', 'updates'];
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

-- ---------------------------------------------------------------- clock: facts for push wording
create or replace function public.dispatch_item_flags(p_item_ids uuid[])
returns table (item_id uuid, autopay boolean, course_name text)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select i.id, i.autopay, c.name
  from public.items i
  left join public.courses c on c.id = i.course_id
  where i.id = any (p_item_ids);
$fn$;

-- ---------------------------------------------------------------- clock: calendar feed refresh
-- Hands out the feeds that are due (not refreshed in the last 30 minutes), at most a couple per
-- minute, and marks them as attempted right away so two clocks never fetch the same feed.
create or replace function public.dispatch_feeds_due(p_now timestamptz, p_limit integer default 2)
returns table (
  feed_id uuid, user_id uuid, url_encrypted text, etag text, default_type text,
  space_id uuid, course_id uuid, timezone text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  return query
  with due as (
    select f.id
    from public.calendar_feeds f
    where f.enabled and (f.last_synced_at is null or f.last_synced_at < p_now - interval '30 minutes')
    order by f.last_synced_at nulls first
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.calendar_feeds f
    set last_synced_at = p_now
    from due
    where f.id = due.id
    returning f.id, f.user_id, f.url_encrypted, f.etag, f.default_type, f.space_id, f.course_id
  )
  select c.id, c.user_id, c.url_encrypted, c.etag, c.default_type, c.space_id, c.course_id, p.timezone
  from claimed c
  join public.profiles p on p.user_id = c.user_id;
end;
$fn$;

-- Applies one fetched feed. `p_events` is a JSON list of
--   {uid, title, due_at, all_day, notes, rrule, cancelled, amount_cents, type, reminders:[...]}.
-- New events become items, changed ones are updated (unless you edited them yourself),
-- events that vanished from the feed are archived. Done / snoozed / skipped are never touched.
create or replace function public.dispatch_feed_apply(
  p_feed_id uuid,
  p_events jsonb,
  p_etag text,
  p_error text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  f public.calendar_feeds%rowtype;
  tz text;
  ev jsonb;
  rem jsonb;
  it public.items%rowtype;
  v_type text;
  v_due timestamptz;
  v_id uuid;
  v_created integer := 0;
  v_changed integer := 0;
  v_removed integer := 0;
  seen text[] := '{}';
  v_title text;
begin
  select * into f from public.calendar_feeds where id = p_feed_id;
  if not found then
    return jsonb_build_object('created', 0, 'changed', 0, 'removed', 0, 'missing', true);
  end if;

  if p_error is not null then
    update public.calendar_feeds set last_error = left(p_error, 300) where id = p_feed_id;
    return jsonb_build_object('created', 0, 'changed', 0, 'removed', 0, 'error', true);
  end if;

  if p_events is null then
    -- "Not modified": nothing to do except remember we checked.
    update public.calendar_feeds set last_error = null, etag = coalesce(p_etag, etag) where id = p_feed_id;
    return jsonb_build_object('created', 0, 'changed', 0, 'removed', 0, 'unchanged', true);
  end if;

  select timezone into tz from public.profiles where user_id = f.user_id;

  for ev in select * from jsonb_array_elements(p_events) limit 500 loop
    v_title := left(btrim(coalesce(ev ->> 'title', '')), 200);
    continue when v_title = '' or (ev ->> 'uid') is null;
    v_type := coalesce(nullif(ev ->> 'type', ''), f.default_type);
    v_due := (ev ->> 'due_at')::timestamptz;

    select * into it from public.items where feed_id = p_feed_id and external_uid = ev ->> 'uid';

    if coalesce((ev ->> 'cancelled')::boolean, false) then
      if found and it.status = 'open' and not it.locally_edited then
        update public.items set status = 'archived' where id = it.id;
        insert into public.updates (user_id, kind, title, item_id)
          values (f.user_id, 'removed', it.title, it.id);
        v_removed := v_removed + 1;
      end if;
      continue;
    end if;
    seen := array_append(seen, ev ->> 'uid');

    if not found then
      insert into public.items (
        user_id, space_id, course_id, type, title, notes, due_at, all_day, timezone,
        rrule, source, external_uid, feed_id, amount_cents
      ) values (
        f.user_id, f.space_id, f.course_id, v_type, v_title, left(ev ->> 'notes', 5000), v_due,
        coalesce((ev ->> 'all_day')::boolean, false), tz,
        nullif(ev ->> 'rrule', ''), 'ics', ev ->> 'uid', p_feed_id, (ev ->> 'amount_cents')::integer
      ) returning id into v_id;

      for rem in select * from jsonb_array_elements(coalesce(ev -> 'reminders', '[]'::jsonb)) loop
        insert into public.reminders (user_id, item_id, offset_minutes, days_before, at_time)
        values (
          f.user_id, v_id,
          (rem ->> 'offset_minutes')::integer,
          (rem ->> 'days_before')::integer,
          (rem ->> 'at_time')::time
        ) on conflict do nothing;
      end loop;

      insert into public.occurrences (user_id, item_id, due_at)
        values (f.user_id, v_id, v_due) on conflict do nothing;

      insert into public.updates (user_id, kind, title, body, item_id)
        values (f.user_id, 'new_item', v_title, v_type, v_id);
      v_created := v_created + 1;

    elsif it.locally_edited then
      null; -- you changed this one yourself; the feed does not override it
    elsif it.status = 'done' or it.status = 'skipped' then
      null; -- finished by you; leave it finished
    else
      if it.status = 'archived' then
        update public.items set status = 'open' where id = it.id;
      end if;
      if it.title is distinct from v_title
         or it.due_at is distinct from v_due
         or it.all_day is distinct from coalesce((ev ->> 'all_day')::boolean, false)
         or it.rrule is distinct from nullif(ev ->> 'rrule', '')
         or it.amount_cents is distinct from (ev ->> 'amount_cents')::integer then
        update public.items set
          title = v_title,
          due_at = v_due,
          all_day = coalesce((ev ->> 'all_day')::boolean, false),
          rrule = nullif(ev ->> 'rrule', ''),
          amount_cents = (ev ->> 'amount_cents')::integer,
          notes = left(ev ->> 'notes', 5000)
        where id = it.id;
        -- The date moved: swap the open time, keep anything already done or skipped.
        if it.due_at is distinct from v_due then
          delete from public.occurrences where item_id = it.id and status = 'open' and due_at <> v_due;
          insert into public.occurrences (user_id, item_id, due_at)
            values (f.user_id, it.id, v_due) on conflict do nothing;
          insert into public.updates (user_id, kind, title, item_id)
            values (f.user_id, 'changed', v_title, it.id);
        end if;
        v_changed := v_changed + 1;
      end if;
    end if;
  end loop;

  -- Gone from the feed: archive what is still open (never what you finished or edited).
  for it in
    select * from public.items
    where feed_id = p_feed_id and status = 'open' and not locally_edited
      and not (external_uid = any (seen))
  loop
    update public.items set status = 'archived' where id = it.id;
    insert into public.updates (user_id, kind, title, item_id) values (f.user_id, 'removed', it.title, it.id);
    v_removed := v_removed + 1;
  end loop;

  update public.calendar_feeds
  set last_synced_at = p_now,
      last_error = null,
      etag = p_etag,
      item_count = (select count(*) from public.items where feed_id = p_feed_id and status = 'open')
  where id = p_feed_id;

  return jsonb_build_object('created', v_created, 'changed', v_changed, 'removed', v_removed);
end;
$fn$;

-- ---------------------------------------------------------------- who may run what
do $perm$
declare
  fn text;
  fns text[] := array[
    'dispatch_item_flags(uuid[])',
    'dispatch_feeds_due(timestamptz, integer)',
    'dispatch_feed_apply(uuid, jsonb, text, text, timestamptz)'
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
