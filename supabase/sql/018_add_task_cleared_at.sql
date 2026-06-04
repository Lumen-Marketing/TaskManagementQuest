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
