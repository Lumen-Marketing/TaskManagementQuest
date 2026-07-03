-- 062: Store the chosen reminder OFFSET spec on the task.
--
-- Values: 'none' | 'at' | '1h' | '1d' | 'morn' | 'custom:{n}:{unit}'. This lets a
-- FUTURE server-side firing job recompute fire time in the tenant timezone. The
-- absolute reminder_at (migration 037) is still written by the client for now;
-- server-side firing stays deferred. Idempotent.
alter table public.tasks
  add column if not exists reminder_offset text;

-- Verify: column exists; existing rows are null (no offset recorded yet).
