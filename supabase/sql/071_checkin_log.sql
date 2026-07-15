-- 071: checkin_log — dedupe ledger for AI proactive check-ins. The `checkins`
-- Edge Function claims a (kind, subject, period) row before sending so each
-- check-in fires exactly once per period even if the cron overlaps or retries.
-- Only the service role writes here (RLS on, no policies = deny all).
--
-- kind    ∈ { 'morning', 'eod', 'stalled' }
-- subject = member id (the recipient)
-- period  = 'YYYY-MM-DD' (HQ date) for morning/eod; HQ-Monday week key for stalled.

create table if not exists public.checkin_log (
  kind     text not null,
  subject  text not null,
  period   text not null,
  sent_at  timestamptz not null default now(),
  primary key (kind, subject, period)
);

alter table public.checkin_log enable row level security;

-- Cron scheduling lives outside this migration (needs the deployed function URL
-- + CHECKINS_SECRET). After deploying `checkins` and setting the secret, run in
-- the SQL editor:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'checkins', '*/30 * * * *',
--     $$ select net.http_post(
--          url := 'https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/checkins',
--          headers := jsonb_build_object(
--            'Content-Type','application/json',
--            'x-checkins-secret','<THE_CHECKINS_SECRET_YOU_SET>'),
--          body := '{}'::jsonb
--        ); $$
--   );
--
-- To change/stop later: select cron.unschedule('checkins');
