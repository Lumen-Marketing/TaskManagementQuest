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
