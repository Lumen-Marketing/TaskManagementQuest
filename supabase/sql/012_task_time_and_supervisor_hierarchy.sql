-- 012: Optional task time + supervisor hierarchy
--
-- This migration:
--   1. Adds an optional `due_time` (HH:MM, 24h) to tasks for the new Time field.
--   2. Adds `supervisor_id` to profiles (the per-user "reports to" override) so the
--      Team hierarchy view can render a real chain of command.
--   3. Adds a `can_view_team()` helper + a profiles SELECT policy so supervisors
--      (not just role managers) can read profiles to build their org chart.

------------------------------------------------------------------------
-- 1. Optional task time
------------------------------------------------------------------------
alter table public.tasks
  add column if not exists due_time text;

alter table public.tasks
  drop constraint if exists tasks_due_time_check;
alter table public.tasks
  add constraint tasks_due_time_check
  check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

------------------------------------------------------------------------
-- 2. Supervisor hierarchy link
------------------------------------------------------------------------
alter table public.profiles
  add column if not exists supervisor_id text references public.team_members(id);

create index if not exists profiles_supervisor_idx on public.profiles(supervisor_id);

------------------------------------------------------------------------
-- 3. Team-view access for supervisors
--    Supervisors need to read profiles (role + supervisor_id) to build the
--    org chart. Managers already can via "managers read profiles".
------------------------------------------------------------------------
create or replace function public.can_view_team()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor');
$$;

revoke all on function public.can_view_team() from public, anon;
grant execute on function public.can_view_team() to authenticated;

drop policy if exists "team viewers read profiles" on public.profiles;
create policy "team viewers read profiles" on public.profiles
for select to authenticated
using (public.can_view_team());
