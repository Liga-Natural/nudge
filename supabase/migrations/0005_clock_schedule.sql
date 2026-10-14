-- Nudge, Phase 1, file 5: starts the reminder clock (run this LAST, after the setup steps).
-- Before running: add two Vault secrets named nudge_app_url and nudge_cron_secret
-- (steps are in NIGHT_LOG.md). Safe to run more than once.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'nudge_app_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'nudge_cron_secret') then
    raise exception 'Add the two Vault secrets first: nudge_app_url and nudge_cron_secret (see NIGHT_LOG.md).';
  end if;
end;
$check$;

-- Remove old copies so running this twice never makes two clocks.
do $unsched$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname in ('nudge-dispatch', 'nudge-cleanup') loop
    perform cron.unschedule(j.jobid);
  end loop;
end;
$unsched$;

-- Every minute: ask the app to send whatever is due. 10 second limit on the call.
select cron.schedule(
  'nudge-dispatch',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nudge_app_url') || '/api/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nudge_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);

-- Every day at 07:15 UTC (3:15 AM New York in summer, 2:15 AM in winter): tidy old logs.
select cron.schedule('nudge-cleanup', '15 7 * * *', $job$select public.nudge_cleanup();$job$);
