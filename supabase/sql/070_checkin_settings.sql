-- 070: checkin_settings — single-row config for AI proactive check-ins.
-- The boss (admin/developer) toggles each mode from the Check-ins settings page;
-- the scheduled `checkins` Edge Function reads this row via the service role.
-- All modes default OFF so the feature ships dark.

create table if not exists public.checkin_settings (
  id               integer primary key default 1,
  morning_enabled  boolean not null default false,
  eod_enabled      boolean not null default false,
  stalled_enabled  boolean not null default false,
  stalled_days     integer not null default 3,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  constraint checkin_settings_singleton check (id = 1)
);

-- Seed the single row so the client always has something to read/update.
insert into public.checkin_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.checkin_settings enable row level security;

-- Admins/developers may read and update the one row. The service role (cron)
-- bypasses RLS entirely.
create policy checkin_settings_admin_select on public.checkin_settings
  for select using (public.current_profile_role() in ('admin', 'developer'));
create policy checkin_settings_admin_update on public.checkin_settings
  for update using (public.current_profile_role() in ('admin', 'developer'))
             with check (public.current_profile_role() in ('admin', 'developer'));
