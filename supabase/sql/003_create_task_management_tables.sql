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
