-- 040: Let a worker notify the people on a task they created.
--
-- Background: migration 028 opened task INSERT to workers, so a worker can now
-- create a task and assign it to a teammate. But the notifications INSERT policy
-- (008, last rewritten in 038) only lets you insert a notification for YOURSELF
-- or if you hold a manager role (admin/supervisor/sales/construction_supervisor/
-- developer). Workers are not in that list, so when a worker creates+assigns a
-- task the in-app ping to the assignee/watchers trips:
--   new row violates row-level security policy for table "notifications"
-- even though the worker is legitimately allowed to create that very task.
--
-- Fix: allow a notification insert when the caller CREATED the referenced task
-- and the recipient is a participant of it (its assignee or one of its
-- watchers). This is tightly scoped — a worker can only ping people already on a
-- task they own, not arbitrary members — and it subsumes the worker case without
-- loosening anything for other roles.
--
-- Why a SECURITY DEFINER helper instead of an inline EXISTS in the policy:
-- the tasks SELECT policy (028) only lets a worker READ tasks ASSIGNED to them,
-- NOT ones they merely created. So an inline `exists (select 1 from tasks ...)`
-- inside the WITH CHECK would be filtered by tasks RLS and find nothing for the
-- exact case we're trying to allow. The helper runs as definer (bypassing tasks
-- RLS) but stays safe because it pins creator_id to the caller's own member id.
--
-- Idempotent; transaction-wrapped.

begin;

-- Ownership check: does the caller's task `p_task_id` exist with the caller as
-- creator, and is `p_member_id` its assignee or one of its watchers? Runs as
-- definer to see past the tasks SELECT policy; current_member_id() ties it to
-- the caller so it can't be used to vouch for someone else's task.
create or replace function public.creator_can_notify_member(p_task_id text, p_member_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.creator_id = public.current_member_id()
      and (
        t.assignee_id = p_member_id
        or t.watchers ? p_member_id
      )
  );
$$;

revoke all on function public.creator_can_notify_member(text, text) from public, anon;
grant execute on function public.creator_can_notify_member(text, text) to authenticated;

-- Recreate the notifications INSERT policy with the creator-of-task branch added.
-- (Keeps the self-insert and manager-role branches from migration 038 verbatim.)
drop policy if exists "role users can insert notifications" on public.notifications;
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (
  member_id = public.current_member_id()
  or public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or public.creator_can_notify_member(task_id, member_id)
);

commit;

-- Verify (as a worker who created task X assigned to member Y): inserting a
-- notification row with task_id = X, member_id = Y should now succeed, while a
-- row with member_id = some unrelated member, or task_id = a task they didn't
-- create, should still be rejected.
