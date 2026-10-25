-- Nudge, terms and school years, file 13: grades belong to a quarter and a school year, classes to a year.
-- Safe to run more than once. Run it after 0012.
--
--  * grades.term: q1 q2 q3 q4 s1 s2 final        grades.school_year: "2026-2027"
--  * courses.school_year: the year a class belongs to (past years stay read-only in the app)
--  * the import function reads term / school_year, and the "New grade" push names the quarter
--  * your existing rows are filled in: "1st 9-Weeks" grades -> q1, classes p02-p08 -> 2026-2027

alter table public.grades add column if not exists term text;
alter table public.grades add column if not exists school_year text;
alter table public.courses add column if not exists school_year text;
alter table public.grades drop constraint if exists grades_term_check;
alter table public.grades add constraint grades_term_check check (term is null or term in ('q1', 'q2', 'q3', 'q4', 's1', 's2', 'final'));
alter table public.grades drop constraint if exists grades_school_year_check;
alter table public.grades add constraint grades_school_year_check check (school_year is null or school_year ~ '^[0-9]{4}-[0-9]{4}$');
alter table public.courses drop constraint if exists courses_school_year_check;
alter table public.courses add constraint courses_school_year_check check (school_year is null or school_year ~ '^[0-9]{4}-[0-9]{4}$');

-- ---------------------------------------------------------------- fill in what is already there
update public.courses set school_year = '2026-2027'
 where school_year is null and name ~* '(^|[^a-z0-9])p0[2-8]([^0-9]|$)';
update public.grades set term = 'q1'
 where term is null and title ~* '1st[ -]*9[ -]*weeks?';
update public.grades set school_year = '2026-2027'
 where school_year is null and title ~* '1st[ -]*9[ -]*weeks?';
update public.grades g set school_year = c.school_year
  from public.courses c
 where g.course_id = c.id and g.school_year is null and c.school_year is not null;

create or replace function public.nudge_import(p_user uuid, p_source text, p_payload jsonb, p_commit boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_tz text;
  v_prefs jsonb;
  v_night text;
  v_hours integer;
  rec jsonb;
  crow public.courses%rowtype;
  arow public.assignments%rowtype;
  irow public.items%rowtype;
  grow public.grades%rowtype;
  v_course uuid;
  v_ref text;
  v_status text;
  v_item uuid;
  v_assignment uuid;
  v_due timestamptz;
  v_done boolean;
  v_notes text;
  v_title text;
  v_posted timestamptz;
  v_notify boolean;
  v_link text;
  v_letter text;
  v_term text;
  v_year text;
  v_points numeric;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object(
    'classes', jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0),
    'assignments', jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0),
    'grades', jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0));
  v_kind text;
  v_warnings jsonb := '[]'::jsonb;
  v_refs text[];
begin
  if p_source not in ('classroom', 'colegia', 'manual') then
    raise exception 'Unknown source %', p_source;
  end if;
  if v_uid is not null and v_uid <> p_user then
    raise exception 'You can only import into your own account.';
  end if;

  select timezone, prefs into v_tz, v_prefs from public.profiles where user_id = p_user;
  if v_tz is null then
    raise exception 'No profile for this account yet. Open Nudge once first.';
  end if;
  -- Classes named in this very payload (they may not exist yet during a preview).
  select coalesce(array_agg(r), '{}'::text[]) into v_refs from (
    select e ->> 'external_id' as r from jsonb_array_elements(coalesce(p_payload -> 'classes', '[]'::jsonb)) e
    union all
    select lower(e ->> 'name') from jsonb_array_elements(coalesce(p_payload -> 'classes', '[]'::jsonb)) e
  ) q;
  v_night := coalesce(nullif(v_prefs ->> 'hw_night_time', ''), '18:00');
  v_hours := coalesce(nullif(v_prefs ->> 'hw_hours_before', '')::integer, 2);

  -- ---- classes
  for rec in select * from jsonb_array_elements(coalesce(p_payload -> 'classes', '[]'::jsonb)) loop
    v_kind := 'classes';
    select * into crow from public.courses
      where user_id = p_user and source = p_source and external_id = rec ->> 'external_id';
    if not found then
      select * into crow from public.courses
        where user_id = p_user and lower(name) = lower(rec ->> 'name') and external_id is null;
      if found then
        v_status := 'updated'; -- an existing class of yours is adopted, not duplicated
      else
        v_status := 'new';
      end if;
    elsif crow.name is distinct from (rec ->> 'name') or crow.teacher is distinct from nullif(rec ->> 'teacher', '')
       or (nullif(rec ->> 'school_year', '') is not null and crow.school_year is distinct from (rec ->> 'school_year')) then
      v_status := 'updated';
    else
      v_status := 'unchanged';
    end if;

    if p_commit and v_status = 'new' then
      insert into public.courses (user_id, name, source, external_id, teacher, school_year)
        values (p_user, left(rec ->> 'name', 60), p_source, rec ->> 'external_id', nullif(left(rec ->> 'teacher', 80), ''),
                nullif(rec ->> 'school_year', ''))
        on conflict do nothing;
    elsif p_commit and v_status = 'updated' then
      update public.courses
        set name = left(rec ->> 'name', 60), teacher = nullif(left(rec ->> 'teacher', 80), ''),
            source = p_source, external_id = rec ->> 'external_id',
            school_year = coalesce(nullif(rec ->> 'school_year', ''), school_year)
        where id = crow.id;
    end if;

    v_counts := jsonb_set(v_counts, array[v_kind, v_status], to_jsonb((v_counts -> v_kind ->> v_status)::integer + 1));
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'kind', 'class', 'external_id', rec ->> 'external_id', 'title', rec ->> 'name', 'status', v_status));
  end loop;

  -- ---- assignments (each one is a Homework item you get reminded about)
  for rec in select * from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb)) loop
    v_kind := 'assignments';
    v_ref := rec ->> 'class';
    v_course := null;
    if v_ref is not null then
      select id into v_course from public.courses
        where user_id = p_user and (external_id = v_ref or lower(name) = lower(v_ref))
        order by (source = p_source) desc limit 1;
      if v_course is null and not p_commit and (v_ref = any (v_refs) or lower(v_ref) = any (v_refs)) then
        v_course := gen_random_uuid(); -- a class this preview would create
      end if;
      if v_course is null then
        v_warnings := v_warnings || to_jsonb('Assignment "' || (rec ->> 'title') || '": class "' || v_ref || '" is not known, so it was added without a class.');
      end if;
    end if;
    v_due := nullif(rec ->> 'due_at', '')::timestamptz;
    v_done := coalesce((rec ->> 'done')::boolean, false);
    v_link := case when (rec ->> 'link') ~* '^https?://' then left(rec ->> 'link', 500) end;
    v_title := left(btrim(rec ->> 'title'), 200);
    v_notes := nullif(btrim(coalesce(rec ->> 'notes', '') ||
                 case when coalesce(rec ->> 'url', '') <> '' then E'\n' || (rec ->> 'url') else '' end), '');

    select * into irow from public.items
      where user_id = p_user and source = p_source and external_uid = rec ->> 'external_id' and feed_id is null;
    if not found then
      v_status := 'new';
    elsif irow.locally_edited then
      v_status := 'unchanged';
    elsif irow.title is distinct from v_title
       or irow.due_at is distinct from v_due
       or irow.course_id is distinct from v_course
       or (v_link is not null and irow.link is distinct from v_link)
       or irow.notes is distinct from left(v_notes, 5000)
       or (v_done and irow.status = 'open') then
      v_status := 'updated';
    else
      v_status := 'unchanged';
    end if;

    if p_commit and v_status = 'new' then
      insert into public.items (user_id, type, title, notes, due_at, all_day, timezone, status,
                                source, external_uid, course_id, link)
        values (p_user, 'homework', v_title, left(v_notes, 5000), v_due, false, v_tz,
                case when v_done then 'done' else 'open' end, p_source, rec ->> 'external_id', v_course, v_link)
        returning id into v_item;
      if v_due is not null then
        insert into public.occurrences (user_id, item_id, due_at, status, done_at)
          values (p_user, v_item, v_due, case when v_done then 'done' else 'open' end,
                  case when v_done then now() end)
          on conflict do nothing;
        -- The night before, and a couple of hours before (both adjustable in Settings).
        if v_night <> 'off' then
          insert into public.reminders (user_id, item_id, days_before, at_time)
            values (p_user, v_item, 1, v_night::time) on conflict do nothing;
        end if;
        if v_hours > 0 then
          insert into public.reminders (user_id, item_id, offset_minutes)
            values (p_user, v_item, v_hours * 60) on conflict do nothing;
        end if;
      end if;
      insert into public.updates (user_id, kind, title, body, item_id)
        values (p_user, 'new_item', v_title, 'homework', v_item);
    elsif p_commit and v_status = 'updated' then
      v_item := irow.id;
      update public.items set title = v_title, notes = left(v_notes, 5000), due_at = v_due, course_id = v_course, link = coalesce(v_link, link),
             status = case when v_done then 'done' else status end
        where id = v_item;
      if irow.due_at is distinct from v_due then
        delete from public.occurrences where item_id = v_item and status = 'open' and due_at is distinct from v_due;
        if v_due is not null then
          insert into public.occurrences (user_id, item_id, due_at) values (p_user, v_item, v_due) on conflict do nothing;
        end if;
        insert into public.updates (user_id, kind, title, item_id) values (p_user, 'changed', v_title, v_item);
      end if;
      if v_done then
        update public.occurrences set status = 'done', done_at = coalesce(done_at, now())
          where item_id = v_item and status = 'open';
      end if;
    elsif p_commit then
      v_item := irow.id;
    end if;

    -- the matching row in the assignments list
    if p_commit then
      insert into public.assignments (user_id, course_id, item_id, title, due_at, url, source, external_id)
        values (p_user, v_course, v_item, v_title, v_due, nullif(left(rec ->> 'url', 500), ''), p_source, rec ->> 'external_id')
        on conflict (user_id, source, external_id) where external_id is not null
        do update set course_id = excluded.course_id, item_id = coalesce(excluded.item_id, public.assignments.item_id),
                      title = excluded.title, due_at = excluded.due_at, url = excluded.url;
    end if;

    v_counts := jsonb_set(v_counts, array[v_kind, v_status], to_jsonb((v_counts -> v_kind ->> v_status)::integer + 1));
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'kind', 'assignment', 'external_id', rec ->> 'external_id', 'title', v_title, 'status', v_status));
  end loop;

  -- ---- grades
  for rec in select * from jsonb_array_elements(coalesce(p_payload -> 'grades', '[]'::jsonb)) loop
    v_kind := 'grades';
    v_ref := rec ->> 'class';
    v_course := null;
    if v_ref is not null then
      select id into v_course from public.courses
        where user_id = p_user and (external_id = v_ref or lower(name) = lower(v_ref))
        order by (source = p_source) desc limit 1;
    end if;
    if v_course is null and not p_commit and v_ref is not null and (v_ref = any (v_refs) or lower(v_ref) = any (v_refs)) then
      v_course := gen_random_uuid(); -- a class this preview would create
    end if;
    if v_course is null then
      v_warnings := v_warnings || to_jsonb('Grade "' || (rec ->> 'title') || '": class "' || coalesce(v_ref, '') || '" is not known, so it was skipped.');
      continue;
    end if;
    v_assignment := null;
    if coalesce(rec ->> 'assignment', '') <> '' then
      select id into v_assignment from public.assignments
        where user_id = p_user and source = p_source and external_id = rec ->> 'assignment';
    end if;
    v_title := left(btrim(rec ->> 'title'), 200);
    v_posted := coalesce(nullif(rec ->> 'posted_at', '')::timestamptz, now());
    v_letter := nullif(upper(btrim(coalesce(rec ->> 'letter', ''))), '');
    v_points := nullif(rec ->> 'points', '')::numeric;
    v_term := nullif(lower(btrim(coalesce(rec ->> 'term', ''))), '');
    v_year := nullif(btrim(coalesce(rec ->> 'school_year', '')), '');

    select * into grow from public.grades
      where user_id = p_user and source = p_source and external_id = rec ->> 'external_id';
    if not found then
      v_status := 'new';
    elsif grow.title is distinct from v_title
       or grow.score is distinct from (rec ->> 'score')::numeric
       or grow.out_of is distinct from (rec ->> 'out_of')::numeric
       or grow.course_id is distinct from v_course
       or (v_letter is not null and grow.letter is distinct from v_letter)
       or (v_points is not null and grow.points is distinct from v_points)
       or (v_term is not null and grow.term is distinct from v_term)
       or (v_year is not null and grow.school_year is distinct from v_year) then
      v_status := 'updated';
    else
      v_status := 'unchanged';
    end if;

    if p_commit and v_status = 'new' then
      -- Only grades that are actually fresh send a push (not a whole old report card on the first import).
      v_notify := p_source <> 'manual' and v_posted > now() - interval '7 days';
      insert into public.grades (user_id, course_id, assignment_id, title, score, out_of, posted_at, comment,
                                 source, external_id, notified_at, letter, points, term, school_year)
        values (p_user, v_course, v_assignment, v_title, (rec ->> 'score')::numeric, (rec ->> 'out_of')::numeric,
                v_posted, nullif(left(rec ->> 'comment', 500), ''), p_source, rec ->> 'external_id',
                case when v_notify then null else now() end, v_letter, v_points, v_term, v_year)
        on conflict do nothing;
      if v_notify then
        insert into public.updates (user_id, kind, title, body)
          values (p_user, 'grade', 'New grade posted in ' || (select name from public.courses where id = v_course),
                  case when v_term is null then '' when v_term = 'final' then 'Final — ' else upper(v_term) || ' — ' end ||
                  case when v_letter is not null then v_title || ': ' || v_letter || coalesce(' ' || to_char(v_points, 'FM990.00'), '')
                       else v_title || ': ' || (rec ->> 'score') || '/' || (rec ->> 'out_of') end);
      end if;
    elsif p_commit and v_status = 'updated' then
      update public.grades set title = v_title, score = (rec ->> 'score')::numeric, out_of = (rec ->> 'out_of')::numeric,
             course_id = v_course, assignment_id = coalesce(v_assignment, assignment_id),
             posted_at = v_posted, comment = nullif(left(rec ->> 'comment', 500), ''),
             letter = coalesce(v_letter, letter), points = coalesce(v_points, points),
             term = coalesce(v_term, term), school_year = coalesce(v_year, school_year)
        where id = grow.id;
    end if;

    v_counts := jsonb_set(v_counts, array[v_kind, v_status], to_jsonb((v_counts -> v_kind ->> v_status)::integer + 1));
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'kind', 'grade', 'external_id', rec ->> 'external_id', 'title', v_title, 'status', v_status));
  end loop;

  return jsonb_build_object('committed', p_commit, 'counts', v_counts, 'results', v_results, 'warnings', v_warnings);
end;
$fn$;

-- A new name again, so earlier files can still be run twice.
create or replace function public.dispatch_grade_notifications_v3(p_limit integer default 50)
returns table (
  grade_id uuid, user_id uuid, course_name text, title text, score numeric, out_of numeric,
  percent numeric, timezone text, language text, letter text, points numeric, term text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  return query
  with picked as (
    select g.id from public.grades g
    where g.notified_at is null
    order by g.created_at
    limit p_limit
    for update skip locked
  ),
  marked as (
    update public.grades g set notified_at = now()
    from picked where g.id = picked.id
    returning g.id, g.user_id, g.course_id, g.title, g.score, g.out_of, g.percent, g.letter, g.points, g.term
  )
  select m.id, m.user_id, coalesce(c.name, ''), m.title, m.score, m.out_of, m.percent, p.timezone, p.language, m.letter, m.points, m.term
  from marked m
  join public.profiles p on p.user_id = m.user_id
  left join public.courses c on c.id = m.course_id;
end;
$fn$;

revoke all on function public.nudge_import(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.nudge_import(uuid, text, jsonb, boolean) to authenticated;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nudge_import(uuid, text, jsonb, boolean) to service_role;
    grant execute on function public.dispatch_grade_notifications_v3(integer) to service_role;
  end if;
end;
$g$;
revoke all on function public.dispatch_grade_notifications_v3(integer) from public, anon, authenticated;
