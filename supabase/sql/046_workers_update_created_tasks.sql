-- 046: Let a worker UPDATE the tasks they created (complete / edit a task they
--      delegated), not only tasks assigned to them.
--
-- Symptom: a worker marks a task they created+delegated as done and gets a
-- "Task updated elsewhere — refreshed to the latest version" toast, and the
-- change reverts. No error is shown.
--
-- Root cause: the client updates with an optimistic lock —
--   .update(row).eq('id', id).eq('updated_at', known).select('updated_at')
-- and treats "0 rows affected" as a concurrent-edit conflict (refetch + toast).
-- The worker branch of the tasks UPDATE policy (028:146/171) only matches rows
-- where assignee_id = current_member_id(). A delegated task (assignee = a
-- teammate) doesn't match the USING clause, so the UPDATE affects 0 rows and the
-- app reports a phantom conflict. This is the UPDATE-side twin of 043 (read) and
-- 044 (delete).
--
-- Fix: add `creator_id = current_member_id()` to the worker branch.
--   * USING gains it so a worker can target a task they created.
--   * WITH CHECK gains it guarded by assignee_in_company(assignee_id, company_id)
--     — so a worker-creator can complete/edit (and, if they reassign, only to a
--     same-company approved member, exactly as 041 gates their INSERT). A worker
--     updating a task assigned to themselves is unchanged.
--
-- Other role branches (developer / admin / supervisor) are carried over verbatim
-- from 028. Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can update tasks" on public.tasks;
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or id = 'general-shift'
        )
      )
    )
  )
)
with check (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or id = 'general-shift')
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or (
            creator_id = public.current_member_id()
            and public.assignee_in_company(assignee_id, company_id)
          )
          or id = 'general-shift'
        )
      )
    )
  )
);

commit;

-- Verify (as a worker): marking a task you created+delegated as done now sticks
-- (the UPDATE affects its row, no phantom conflict); reassigning it to a member of
-- another company is still rejected by the WITH CHECK.
