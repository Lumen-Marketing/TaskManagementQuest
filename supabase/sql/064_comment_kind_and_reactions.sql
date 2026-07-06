-- 064: Task-detail comment upgrades (Slice C).
--   (1) task_comments.kind — a real comment "kind" column so a call log or a
--       note is a first-class type instead of an emoji-in-body heuristic.
--       Existing rows default to 'comment'; the client backfills the visual
--       tag for legacy 📞/📝-prefixed bodies until they age out.
--   (2) comment_reactions — one row per (comment, member, emoji). A reaction is
--       a toggle: a member holds at most one row per emoji per comment, so the
--       UI shows aggregated counts and whether *you* reacted.
--
-- RLS mirrors task_comments (migration 053): you can act on a reaction only for
-- a comment whose parent task you can see, and only as yourself while approved.
-- Reuses the same helpers: public.current_member_id() / current_profile_role().

-- ---------- (1) comment kind ----------
alter table public.task_comments
  add column if not exists kind text not null default 'comment';

-- Constrain to the known kinds. Guarded so re-running the migration is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_comments_kind_check'
  ) then
    alter table public.task_comments
      add constraint task_comments_kind_check
      check (kind in ('comment', 'note', 'call'));
  end if;
end $$;

-- ---------- (2) reactions ----------
create table if not exists public.comment_reactions (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references public.task_comments (id) on delete cascade,
  member_id   text not null,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (comment_id, member_id, emoji)
);

create index if not exists comment_reactions_comment_idx
  on public.comment_reactions (comment_id);

alter table public.comment_reactions enable row level security;

-- READ: any reaction whose comment's parent task is visible to the caller.
-- The inner EXISTS against tasks is itself RLS-scoped, so visibility follows
-- the task wall exactly like task_comments_select does.
drop policy if exists comment_reactions_select on public.comment_reactions;
create policy comment_reactions_select on public.comment_reactions
  for select to authenticated
  using (
    exists (
      select 1
      from public.task_comments c
      join public.tasks t on t.id = c.task_id
      where c.id = comment_reactions.comment_id
    )
  );

-- INSERT: reactor must be the caller, the comment's task must be visible, and
-- the caller must be approved.
drop policy if exists comment_reactions_insert on public.comment_reactions;
create policy comment_reactions_insert on public.comment_reactions
  for insert to authenticated
  with check (
    member_id = public.current_member_id()
    and exists (
      select 1
      from public.task_comments c
      join public.tasks t on t.id = c.task_id
      where c.id = comment_reactions.comment_id
    )
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.approved is true
    )
  );

-- DELETE: a member removes only their own reaction (toggling off). Admins and
-- supervisors may clear any reaction, mirroring task_comments_delete.
drop policy if exists comment_reactions_delete on public.comment_reactions;
create policy comment_reactions_delete on public.comment_reactions
  for delete to authenticated
  using (
    member_id = public.current_member_id()
    or public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor')
  );
