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
