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
