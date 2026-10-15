-- Nudge: same question, for BEFORE you have run file 0007. Read-only. Paste into Supabase -> SQL Editor -> Run.
-- Look at "nudge_style": if it says morning or important, that was why on-time reminders were thrown away.
select
  i.title,
  to_char(o.due_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as due_miami,
  o.status                                                                   as item_state,
  (select count(*) from public.reminders r where r.item_id = i.id)           as reminders_set,
  coalesce(rs.status, 'NO SEND RECORD')                                       as delivery_status,
  to_char(rs.fire_at at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as should_fire_miami,
  p.nudge_style,
  p.quiet_start::text || '-' || p.quiet_end::text                            as quiet_hours,
  p.urgent_override
from public.occurrences o
join public.items i on i.id = o.item_id
join public.profiles p on p.user_id = o.user_id
left join public.reminder_sends rs on rs.occurrence_id = o.id
order by o.due_at desc, rs.fire_at desc
limit 15;
