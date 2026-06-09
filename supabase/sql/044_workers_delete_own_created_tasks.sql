-- 044: Let a worker DELETE the tasks they created (only their own).
--
-- Background: the tasks DELETE policy (028:182) allows only managers
-- (admin / supervisor / construction_supervisor / sales) + developer to delete,
-- scoped to their company. Workers can create+delegate tasks (041/043) but had no
-- way to remove one they made — the detail view's Delete button was hidden for
-- them and the DELETE would be RLS-rejected anyway.
--
-- Fix: add a worker branch that permits deleting a task ONLY when the worker is
-- its creator (creator_id = current_member_id()), still inside their company. A
-- worker cannot delete tasks a manager created and handed to them — just their
-- own. Mirrors the creator-scoped read added in 043.
--
-- Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can delete tasks" on public.tasks;
create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and (
      public.current_profile_role() in ('admin', 'supervisor', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'worker'
        and creator_id = public.current_member_id()
      )
    )
  )
);

commit;

-- Verify (as a worker): deleting a task you created -> succeeds; deleting a task
-- a manager created and assigned to you -> still rejected by RLS.
