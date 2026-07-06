-- 063: "stuck" / blocked-on state for a task (Task Detail Slice B).
--
-- A task can be flagged STUCK with a reason and the person it's blocked on. Stored
-- as a single nullable jsonb column: null = not stuck; else { reason, on, at }
--   reason : text — what's blocking
--   on     : member_id of the person who owns unblocking
--   at     : ISO timestamp when flagged
-- "Unblock" sets the column back to null. No RLS change needed — the existing
-- tasks policies already gate who can read/update a task. Idempotent.
alter table public.tasks
  add column if not exists stuck jsonb;

-- Verify: column exists; existing rows are null (no task is stuck yet).
