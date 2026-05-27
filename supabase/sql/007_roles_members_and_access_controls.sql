alter table public.profiles add column if not exists member_id text references public.team_members(id);
alter table public.profiles alter column approved set default false;
alter table public.profiles alter column role set default 'member';

create or replace function public.slugify_member_id(input text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, 'member')), '[^a-z0-9]+', '-', 'g'));
$$;

with profile_members as (
  select
    p.id,
    coalesce(nullif(public.slugify_member_id(split_part(p.email, '@', 1)), ''), 'member-' || left(p.id::text, 8)) as member_id,
    coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'Member') as full_name,
    p.email
  from public.profiles p
  where p.member_id is null
)
insert into public.team_members (id, name, full_name, email, color)
select
  pm.member_id,
  split_part(pm.full_name, ' ', 1),
  pm.full_name,
  pm.email,
  '#' || substr(md5(pm.email), 1, 6)
from profile_members pm
on conflict (id) do update set
  name = excluded.name,
  full_name = excluded.full_name,
  email = excluded.email;

with profile_members as (
  select
    p.id,
    coalesce(nullif(public.slugify_member_id(split_part(p.email, '@', 1)), ''), 'member-' || left(p.id::text, 8)) as member_id
  from public.profiles p
  where p.member_id is null
)
update public.profiles p
set member_id = pm.member_id
from profile_members pm
where p.id = pm.id;

update public.profiles
set role = 'admin', approved = true
where email in ('joshuasajor28@gmail.com', 'asiandoes28@gmail.com');

insert into public.tasks (id, title, description, company_id, creator_id, assignee_id, due, priority, urgency, status, project_id)
values ('general-shift', 'General shift', 'Clock-in bucket for workers without a specific task assignment.', 'roofing', 'abraham', 'abraham', current_date, 'low', 'low', 'todo', null)
on conflict (id) do update set title = excluded.title, description = excluded.description, status = excluded.status;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'member');
$$;

create or replace function public.current_member_id()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select (select p.member_id from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.can_manage_roles()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_profile_role() in ('admin', 'construction_supervisor');
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_member_id() from public;
revoke all on function public.can_manage_roles() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.can_manage_roles() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id text := coalesce(nullif(public.slugify_member_id(split_part(new.email, '@', 1)), ''), 'member-' || left(new.id::text, 8));
  v_full_name text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1));
begin
  insert into public.team_members (id, name, full_name, email, color)
  values (v_member_id, split_part(v_full_name, ' ', 1), v_full_name, new.email, '#' || substr(md5(new.email), 1, 6))
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email;

  insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id)
  values (new.id, new.email, v_full_name, false, 'member', false, v_member_id)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    member_id = excluded.member_id;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

do $$
declare
  table_name text;
  task_check text := 'public.current_profile_role() in (''admin'', ''construction_supervisor'', ''supervisor'', ''sales'')';
  worker_check text := 'public.current_profile_role() in (''admin'', ''construction_supervisor'', ''supervisor'', ''sales'', ''worker'')';
begin
  foreach table_name in array array['companies', 'projects', 'schedules', 'task_watchers', 'task_subtasks', 'task_activity'] loop
    execute format('drop policy if exists "approved users can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can delete %1$s" on public.%1$I', table_name);
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
    execute format('drop policy if exists "approved users can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can delete %1$s" on public.%1$I', table_name);
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

drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "managers read profiles" on public.profiles;
drop policy if exists "managers update profiles" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "managers read profiles" on public.profiles for select to authenticated using (public.can_manage_roles());
create policy "managers update profiles" on public.profiles for update to authenticated using (public.can_manage_roles()) with check (public.can_manage_roles());

drop policy if exists "approved users can read team_members" on public.team_members;
drop policy if exists "approved users can insert team_members" on public.team_members;
drop policy if exists "approved users can update team_members" on public.team_members;
drop policy if exists "approved users can delete team_members" on public.team_members;
drop policy if exists "role users can read team_members" on public.team_members;
drop policy if exists "managers can insert team_members" on public.team_members;
drop policy if exists "managers can update team_members" on public.team_members;
drop policy if exists "managers can delete team_members" on public.team_members;
create policy "role users can read team_members" on public.team_members
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales', 'worker'));
create policy "managers can insert team_members" on public.team_members for insert to authenticated with check (public.can_manage_roles());
create policy "managers can update team_members" on public.team_members for update to authenticated using (public.can_manage_roles()) with check (public.can_manage_roles());
create policy "managers can delete team_members" on public.team_members for delete to authenticated using (public.can_manage_roles());

drop policy if exists "worker can read general shift task" on public.tasks;
create policy "worker can read general shift task" on public.tasks
for select to authenticated
using (public.current_profile_role() = 'worker' and id = 'general-shift');

drop policy if exists "worker can append general shift activity" on public.task_activity;
create policy "worker can append general shift activity" on public.task_activity
for insert to authenticated
with check (public.current_profile_role() = 'worker' and task_id = 'general-shift');
