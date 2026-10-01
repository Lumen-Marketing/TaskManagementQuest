-- DEV-ONLY WORKAROUND — NOT a production migration, and it hides a real defect.
--
-- Migration 013 DROPS public.task_watchers / task_subtasks / task_activity (their
-- data moved into JSONB columns on tasks). Migration 072 nevertheless lists those
-- three tables in every "scoped tables" loop (add tenant_id, backfill, stamp trigger,
-- NOT NULL + restrictive policy), so on any database where 013 has run, 072 aborts
-- with `relation "public.task_watchers" does not exist` (it is transaction-wrapped,
-- so it fails harmlessly — but it cannot apply).
--
-- This file re-creates the three tables, EXACTLY as migration 003 defined them, only
-- so the local rehearsal can get past that and exercise the rest of 072 and 073.
-- The proper fix belongs in 072 (drop the three names from its arrays) or a
-- corrective migration — a decision for the repo owner, not done here.
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
alter table public.task_watchers  enable row level security;
alter table public.task_subtasks  enable row level security;
alter table public.task_activity  enable row level security;
