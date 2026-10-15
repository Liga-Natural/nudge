-- Nudge: "why didn't my reminder arrive?" Read-only. Paste into Supabase -> SQL Editor -> Run.
-- Shows your last 15 reminders with the due time in Miami time (America/New_York) and what happened.
select
  i.title,
  i.type,
  to_char(o.due_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as due_miami,
  o.status                                                                   as item_state,
  (select count(*) from public.reminders r where r.item_id = i.id)           as reminders_set,
  coalesce(rs.status, 'NOTHING HAPPENED YET')                                 as delivery_status,
  to_char(rs.fire_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as should_fire_miami,
  to_char(rs.sent_at at time zone 'America/New_York', 'HH12:MI:SS AM')         as sent_miami,
  rs.attempts,
  rs.detail                                                                  as why,
  (select a.error from public.delivery_attempts a
     where a.send_id = rs.id order by a.created_at desc limit 1)              as last_error
from public.occurrences o
join public.items i on i.id = o.item_id
left join public.reminder_sends rs on rs.occurrence_id = o.id
order by o.due_at desc, rs.fire_at desc
limit 15;
