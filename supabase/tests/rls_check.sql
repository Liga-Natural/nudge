-- Nudge security check. Run in the Supabase SQL editor: it must return ZERO rows.
-- Any row it returns is a problem to fix before going on.

-- 1. A table in public without row level security turned on.
select 'table has no row level security' as problem, c.relname::text as thing
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

union all

-- 2. Signed-out visitors (anon) holding any permission on a table in public.
select 'signed-out visitors can touch a table', g.table_name::text
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'anon'

union all

-- 3. Server-only functions that signed-out or signed-in visitors may run.
select 'visitors can run a server-only function', p.proname::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))

union all

-- 4. Server-only tables that signed-in visitors may read.
select 'signed-in visitors can touch a server-only table', g.table_name::text
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'authenticated'
  and g.table_name in ('summary_sends', 'dispatch_log');
