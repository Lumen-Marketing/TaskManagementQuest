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
