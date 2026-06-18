-- 050_add_task_focus_seq.sql
-- Focus list / execution order. A task's focus_seq is a float sort-key for the
-- assignee's curated "Focus" queue: NULL = not in Focus; non-null = in Focus at
-- that position. Reorders set a midpoint value so only the moved row changes.
-- Scoped per person implicitly via assignee_id (each task is in one queue).
alter table public.tasks
  add column if not exists focus_seq real;

comment on column public.tasks.focus_seq is
  'Execution-order sort key for the assignee''s Focus list. NULL = not in Focus.';
