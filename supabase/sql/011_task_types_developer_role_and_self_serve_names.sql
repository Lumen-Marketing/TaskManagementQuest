-- 011: Task types & bid status, developer role, self-serve display names
--
-- This migration:
--   1. Adds `type` and `bid_status` columns to tasks so the new Type column persists.
--   2. Adds 'developer' to every RLS role check so developer accounts have admin-level reach.
--   3. Loosens profile/team_member update policies so users can edit their own display name
--      (managers retain full edit access).

------------------------------------------------------------------------
-- 1. Task type + bid status
------------------------------------------------------------------------
alter table public.tasks
  add column if not exists type text not null default 'admin',
  add column if not exists bid_status text;

alter table public.tasks
  drop constraint if exists tasks_type_check;
alter table public.tasks
  add constraint tasks_type_check
  check (type in ('lead', 'bid', 'admin', 'invoicing', 'ar', 'meeting'));

alter table public.tasks
  drop constraint if exists tasks_bid_status_check;
alter table public.tasks
  add constraint tasks_bid_status_check
  check (bid_status is null or bid_status in ('queue', 'started', 'supplier', 'ready'));

------------------------------------------------------------------------
-- 2. Developer role — same powers as admin, plus future debug flags
------------------------------------------------------------------------
create or replace function public.can_manage_roles()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_profile_role() in ('admin', 'construction_supervisor', 'developer');
$$;

revoke all on function public.can_manage_roles() from public;
grant execute on function public.can_manage_roles() to authenticated;

do $$
declare
  table_name text;
  task_check text := 'public.current_profile_role() in (''admin'', ''construction_supervisor'', ''developer'', ''supervisor'', ''sales'')';
  worker_check text := 'public.current_profile_role() in (''admin'', ''construction_supervisor'', ''developer'', ''supervisor'', ''sales'', ''worker'')';
begin
  foreach table_name in array array['companies', 'projects', 'schedules', 'task_watchers', 'task_subtasks', 'task_activity'] loop
    execute format('drop policy if exists "role users can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can delete %1$s" on public.%1$I', table_name);
    execute format('create policy "role users can read %1$s" on public.%1$I for select to authenticated using (%2$s)', table_name, task_check);
    execute format('create policy "role users can insert %1$s" on public.%1$I for insert to authenticated with check (%2$s)', table_name, task_check);
    execute format('create policy "role users can update %1$s" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', table_name, task_check);
    execute format('create policy "role users can delete %1$s" on public.%1$I for delete to authenticated using (%2$s)', table_name, task_check);
  end loop;

  foreach table_name in array array['time_entries', 'active_timers', 'notifications'] loop
    execute format('drop policy if exists "role users can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "role users can delete %1$s" on public.%1$I', table_name);
    execute format('create policy "role users can read %1$s" on public.%1$I for select to authenticated using (%2$s)', table_name, worker_check);
    execute format('create policy "role users can insert %1$s" on public.%1$I for insert to authenticated with check (%2$s)', table_name, worker_check);
    execute format('create policy "role users can update %1$s" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', table_name, worker_check);
    execute format('create policy "role users can delete %1$s" on public.%1$I for delete to authenticated using (%2$s)', table_name, worker_check);
  end loop;
end $$;

drop policy if exists "role users can read team_members" on public.team_members;
create policy "role users can read team_members" on public.team_members
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales', 'worker'));

------------------------------------------------------------------------
-- 3. Self-serve display name
--    Users may update their own full_name on profiles + their own
--    team_members row (name, full_name). Managers retain full access.
------------------------------------------------------------------------
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = (select p.role from public.profiles p where p.id = auth.uid())
  and approved = (select p.approved from public.profiles p where p.id = auth.uid())
);

drop policy if exists "users update own team_member name" on public.team_members;
create policy "users update own team_member name" on public.team_members
for update to authenticated
using (id = public.current_member_id())
with check (id = public.current_member_id());
