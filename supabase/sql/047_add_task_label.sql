-- 047: Add a job-scope "label" tag to tasks.
--
-- The client added a Label combo-box to the New task popup (App.TASK_LABELS:
-- 'roof', 'roof_framing', 'framing'). This adds the backing column so the
-- choice persists. Nullable so rows written before this migration (and any
-- task created without a label) stay valid. Idempotent — safe to re-run.

alter table public.tasks
  add column if not exists label text;

alter table public.tasks
  drop constraint if exists tasks_label_check;

alter table public.tasks
  add constraint tasks_label_check
  check (label is null or label in ('roof', 'roof_framing', 'framing'));
