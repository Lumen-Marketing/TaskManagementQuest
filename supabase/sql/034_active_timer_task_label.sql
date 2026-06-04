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
