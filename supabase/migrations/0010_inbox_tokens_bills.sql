-- Nudge, Phase 3, file 10: access tokens for /api/inbox, the rate limiter, per-feed timing,
-- and the Joker bills sync. Safe to run more than once. Run it after 0009.

-- ---------------------------------------------------------------- access tokens (hashed)
-- Only a fingerprint (SHA-256) of each token is stored, never the token itself. The token is shown
-- once, when you create it.
create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_tokens_user_idx on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from anon;
-- People can see, create, rename/revoke and delete their own tokens. They can never read the hash
-- of anyone else's, and the app never sends the hash to the browser.
revoke all on public.api_tokens from authenticated;
grant select (id, user_id, name, token_prefix, created_at, last_used_at, expires_at, revoked_at) on public.api_tokens to authenticated;
grant insert (user_id, name, token_hash, token_prefix, expires_at) on public.api_tokens to authenticated;
grant update (name, revoked_at) on public.api_tokens to authenticated;
grant delete on public.api_tokens to authenticated;

drop policy if exists api_tokens_select_own on public.api_tokens;
create policy api_tokens_select_own on public.api_tokens for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists api_tokens_insert_own on public.api_tokens;
create policy api_tokens_insert_own on public.api_tokens for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists api_tokens_update_own on public.api_tokens;
create policy api_tokens_update_own on public.api_tokens for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists api_tokens_delete_own on public.api_tokens;
create policy api_tokens_delete_own on public.api_tokens for delete to authenticated using (user_id = (select auth.uid()));

-- Server only: who does this token belong to? Also notes that it was just used.
create or replace function public.api_token_lookup(p_hash text)
returns table (token_id uuid, user_id uuid, name text, outcome text, last_used_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  t public.api_tokens%rowtype;
begin
  select * into t from public.api_tokens where token_hash = p_hash;
  if not found then
    return query select null::uuid, null::uuid, null::text, 'unknown'::text, null::timestamptz;
    return;
  end if;
  if t.revoked_at is not null then
    return query select t.id, t.user_id, t.name, 'revoked'::text, t.last_used_at;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select t.id, t.user_id, t.name, 'expired'::text, t.last_used_at;
    return;
  end if;
  update public.api_tokens set last_used_at = now() where id = t.id;
  return query select t.id, t.user_id, t.name, 'ok'::text, t.last_used_at;
end;
$fn$;

-- ---------------------------------------------------------------- rate limiter (shared by every server copy)
create table if not exists public.api_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create index if not exists api_rate_limits_window_idx on public.api_rate_limits (window_start);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

-- Counts one hit and says whether it is within the limit for the current window.
create or replace function public.api_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.api_rate_limits as r (key, window_start, hits)
    values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into n;
  if random() < 0.02 then
    delete from public.api_rate_limits where window_start < now() - interval '1 day';
  end if;
  return query select n <= p_limit,
                      greatest(1, ceil(extract(epoch from (w + (p_window_seconds * interval '1 second') - now()))))::integer;
end;
$fn$;

-- ---------------------------------------------------------------- per-feed timing and kind
alter table public.calendar_feeds add column if not exists kind text not null default 'calendar';
alter table public.calendar_feeds drop constraint if exists calendar_feeds_kind_check;
alter table public.calendar_feeds add constraint calendar_feeds_kind_check check (kind in ('calendar', 'classroom', 'bills'));
alter table public.calendar_feeds add column if not exists interval_minutes integer not null default 30
  check (interval_minutes between 15 and 1440);

-- Same job as before, now with each feed's own timing (hourly for Classroom and Joker bills) and
-- the facts the app needs to read it (its kind, and the person's homework reminder timing).
drop function if exists public.dispatch_feeds_due(timestamptz, integer);
create or replace function public.dispatch_feeds_due(p_now timestamptz, p_limit integer default 2)
returns table (
  feed_id uuid, user_id uuid, url_encrypted text, etag text, default_type text,
  space_id uuid, course_id uuid, timezone text, kind text, prefs jsonb
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
    where f.enabled
      and (f.last_synced_at is null or f.last_synced_at < p_now - (f.interval_minutes * interval '1 minute'))
    order by f.last_synced_at nulls first
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.calendar_feeds f
    set last_synced_at = p_now
    from due
    where f.id = due.id
    returning f.id, f.user_id, f.url_encrypted, f.etag, f.default_type, f.space_id, f.course_id, f.kind
  )
  select c.id, c.user_id, c.url_encrypted, c.etag, c.default_type, c.space_id, c.course_id, p.timezone, c.kind, p.prefs
  from claimed c
  join public.profiles p on p.user_id = c.user_id;
end;
$fn$;

-- ---------------------------------------------------------------- Joker bills
-- Applies one fetched Joker bills list. p_bills is
--   [{ id, name, amount_cents, currency, due_date (YYYY-MM-DD), status (unpaid|paid|canceled),
--      paid_on (YYYY-MM-DD), autopay, notes }]
-- New bills become Payment items with the usual payment reminders. A bill the feed says is paid is
-- marked done (and recorded under Payments). Bills that vanish from the list are archived unless you
-- already paid them or edited them yourself.
create or replace function public.dispatch_bills_apply(
  p_feed_id uuid,
  p_bills jsonb,
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
  b jsonb;
  it public.items%rowtype;
  v_due timestamptz;
  v_status text;
  v_title text;
  v_cents integer;
  v_auto boolean;
  v_id uuid;
  v_occ uuid;
  v_paid_on date;
  v_created integer := 0;
  v_changed integer := 0;
  v_paid integer := 0;
  v_removed integer := 0;
  seen text[] := '{}';
begin
  select * into f from public.calendar_feeds where id = p_feed_id and kind = 'bills';
  if not found then
    return jsonb_build_object('created', 0, 'changed', 0, 'paid', 0, 'removed', 0, 'missing', true);
  end if;
  if p_error is not null then
    update public.calendar_feeds set last_error = left(p_error, 300) where id = p_feed_id;
    return jsonb_build_object('created', 0, 'changed', 0, 'paid', 0, 'removed', 0, 'error', true);
  end if;
  if p_bills is null then
    update public.calendar_feeds set last_error = null, etag = coalesce(p_etag, etag) where id = p_feed_id;
    return jsonb_build_object('created', 0, 'changed', 0, 'paid', 0, 'removed', 0, 'unchanged', true);
  end if;

  select timezone into tz from public.profiles where user_id = f.user_id;

  for b in select * from jsonb_array_elements(p_bills) limit 500 loop
    continue when coalesce(b ->> 'id', '') = '' or coalesce(b ->> 'name', '') = '' or coalesce(b ->> 'due_date', '') = '';
    v_title := left(btrim(b ->> 'name'), 200);
    v_cents := (b ->> 'amount_cents')::integer;
    v_auto := coalesce((b ->> 'autopay')::boolean, false);
    v_status := coalesce(nullif(b ->> 'status', ''), 'unpaid');
    -- Bills are due by the end of their day, New York time unless the person's own zone says otherwise.
    v_due := ((b ->> 'due_date') || ' 23:59')::timestamp at time zone tz;

    select * into it from public.items where feed_id = p_feed_id and external_uid = b ->> 'id';

    if v_status = 'canceled' then
      if found and it.status = 'open' and not it.locally_edited then
        update public.items set status = 'archived' where id = it.id;
        insert into public.updates (user_id, kind, title, item_id) values (f.user_id, 'removed', it.title, it.id);
        v_removed := v_removed + 1;
      end if;
      continue;
    end if;
    seen := array_append(seen, b ->> 'id');

    if not found then
      insert into public.items (user_id, space_id, type, title, notes, due_at, all_day, timezone, amount_cents,
                                autopay, source, external_uid, feed_id, status)
        values (f.user_id, f.space_id, 'payment', v_title, left(b ->> 'notes', 5000), v_due, true, tz, v_cents,
                v_auto, 'joker', b ->> 'id', p_feed_id, case when v_status = 'paid' then 'done' else 'open' end)
        returning id into v_id;
      insert into public.occurrences (user_id, item_id, due_at, status, done_at)
        values (f.user_id, v_id, v_due, case when v_status = 'paid' then 'done' else 'open' end,
                case when v_status = 'paid' then p_now end)
        returning id into v_occ;
      if v_status = 'paid' then
        v_paid_on := coalesce(nullif(b ->> 'paid_on', '')::date, (p_now at time zone tz)::date);
        insert into public.item_payments (user_id, item_id, occurrence_id, amount_cents, currency, paid_on)
          values (f.user_id, v_id, v_occ, coalesce(v_cents, 0), coalesce(nullif(b ->> 'currency', ''), 'USD'), v_paid_on);
        v_paid := v_paid + 1;
      else
        insert into public.reminders (user_id, item_id, days_before, at_time)
          values (f.user_id, v_id, 3, '09:00'), (f.user_id, v_id, 0, '09:00') on conflict do nothing;
        insert into public.updates (user_id, kind, title, body, item_id)
          values (f.user_id, 'bill', v_title, coalesce(b ->> 'amount_cents', ''), v_id);
      end if;
      v_created := v_created + 1;

    elsif it.locally_edited then
      null;
    else
      -- the feed says paid and we still have it open: mark it done
      if v_status = 'paid' and it.status = 'open' then
        update public.items set status = 'done' where id = it.id;
        update public.occurrences set status = 'done', done_at = p_now, snoozed_until = null
          where item_id = it.id and status = 'open'
          returning id into v_occ;
        v_paid_on := coalesce(nullif(b ->> 'paid_on', '')::date, (p_now at time zone tz)::date);
        insert into public.item_payments (user_id, item_id, occurrence_id, amount_cents, currency, paid_on)
          values (f.user_id, it.id, v_occ, coalesce(v_cents, it.amount_cents, 0),
                  coalesce(nullif(b ->> 'currency', ''), it.currency), v_paid_on);
        insert into public.updates (user_id, kind, title, body, item_id)
          values (f.user_id, 'paid', it.title, coalesce(v_cents, it.amount_cents)::text, it.id);
        v_paid := v_paid + 1;
      elsif it.status = 'open' or it.status = 'archived' then
        -- still unpaid: follow date/amount/name changes
        if it.status = 'archived' then
          update public.items set status = 'open' where id = it.id;
        end if;
        if it.title is distinct from v_title or it.due_at is distinct from v_due
           or it.amount_cents is distinct from v_cents or it.autopay is distinct from v_auto then
          update public.items set title = v_title, due_at = v_due, amount_cents = v_cents, autopay = v_auto
            where id = it.id;
          if it.due_at is distinct from v_due then
            delete from public.occurrences where item_id = it.id and status = 'open' and due_at <> v_due;
            insert into public.occurrences (user_id, item_id, due_at) values (f.user_id, it.id, v_due) on conflict do nothing;
            insert into public.updates (user_id, kind, title, item_id) values (f.user_id, 'changed', v_title, it.id);
          end if;
          v_changed := v_changed + 1;
        end if;
      end if;
    end if;
  end loop;

  for it in
    select * from public.items
    where feed_id = p_feed_id and status = 'open' and not locally_edited and not (external_uid = any (seen))
  loop
    update public.items set status = 'archived' where id = it.id;
    insert into public.updates (user_id, kind, title, item_id) values (f.user_id, 'removed', it.title, it.id);
    v_removed := v_removed + 1;
  end loop;

  update public.calendar_feeds
  set last_synced_at = p_now, last_error = null, etag = p_etag,
      item_count = (select count(*) from public.items where feed_id = p_feed_id and status = 'open')
  where id = p_feed_id;

  return jsonb_build_object('created', v_created, 'changed', v_changed, 'paid', v_paid, 'removed', v_removed);
end;
$fn$;

-- ---------------------------------------------------------------- who may run what
do $perm$
declare
  fn text;
  fns text[] := array[
    'api_token_lookup(text)',
    'api_rate_hit(text, integer, integer)',
    'dispatch_feeds_due(timestamptz, integer)',
    'dispatch_bills_apply(uuid, jsonb, text, text, timestamptz)'
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
