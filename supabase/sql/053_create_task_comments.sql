-- 053: task_comments — a real per-task discussion thread (beyond the one-line
-- activity log). Comments carry @mentions (member_ids) so the app can notify
-- the people called out.
--
-- RLS mirrors task visibility: you can READ a task's comments if you can read
-- the task (the EXISTS subquery is itself RLS-scoped against `tasks`), and you
-- can INSERT a comment only as yourself, on a task you can see, while approved.
-- Uses the existing helpers public.current_member_id() / approved check.

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     text not null,
  author_id   text not null,
  body        text not null,
  mentions    text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists task_comments_task_idx
  on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;

-- READ: any comment whose parent task is visible to the caller.
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_comments.task_id));

-- INSERT: author must be the caller, the task must be visible, caller approved.
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_id = public.current_member_id()
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved is true)
  );

-- DELETE: a user may remove their own comment (admins/supervisors too).
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (
    author_id = public.current_member_id()
    or public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor')
  );
