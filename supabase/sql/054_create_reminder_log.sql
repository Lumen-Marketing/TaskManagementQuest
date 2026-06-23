-- 054: reminder_log — dedupe ledger for SERVER-SIDE due-date reminders.
-- The scheduled `due-reminders` Edge Function claims a (task_id, kind) row
-- before sending so the same reminder fires exactly once even if the cron runs
-- often or overlaps. Only the service role writes here (RLS on, no policies =
-- deny all for normal users; the service role bypasses RLS).
--
-- kind ∈ { 'pre' (4h before), 'at' (due), 'overdue' (+24h), 'morning' (8am HQ) }.

create table if not exists public.reminder_log (
  task_id  text not null,
  kind     text not null,
  sent_at  timestamptz not null default now(),
  primary key (task_id, kind)
);

alter table public.reminder_log enable row level security;

-- The cron scheduling lives outside this migration because it needs the
-- deployed function URL + a shared secret (set per project). After deploying the
-- `due-reminders` function and setting REMINDERS_SECRET, run (in the SQL editor):
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'due-reminders', '*/15 * * * *',
--     $$ select net.http_post(
--          url := 'https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/due-reminders',
--          headers := jsonb_build_object(
--            'Content-Type','application/json',
--            'x-reminders-secret','<THE_REMINDERS_SECRET_YOU_SET>'),
--          body := '{}'::jsonb
--        ); $$
--   );
--
-- To change/stop it later: select cron.unschedule('due-reminders');
