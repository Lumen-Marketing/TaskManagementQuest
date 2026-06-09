-- 043: Let a worker READ the tasks they created (not only ones assigned to them).
--
-- Symptom: a worker creating a task and assigning it to a TEAMMATE gets
--   "new row violates row-level security policy for table tasks"
-- even though the INSERT itself is permitted (migration 041) and every value
-- checks out. Self-assignment works; assigning to anyone else fails.
--
-- Root cause: the client inserts with RETURNING — supabase-js does
-- `.insert(row).select('updated_at')` (SupabaseDataStore._saveTasks) to capture
-- the optimistic-lock version. Postgres applies the SELECT policy to the
-- RETURNING row. The worker branch of the tasks SELECT policy (028:98) only lets
-- a worker read tasks where `assignee_id = current_member_id()`, NOT ones they
-- merely created. When a worker delegates a task (assignee = a teammate), the
-- just-inserted row is invisible to them, so RETURNING is rejected and the whole
-- statement reports as an RLS violation. (This is the exact gap migration 040's
-- comment flagged: "the tasks SELECT policy only lets a worker READ tasks
-- ASSIGNED to them, NOT ones they merely created.")
--
-- Fix: add `creator_id = current_member_id()` to the worker branch of the SELECT
-- policy — the same clause the supervisor branch (028:90) already has. A worker
-- can now read tasks they created (so INSERT...RETURNING succeeds, and delegated
-- tasks show on the creator's board too). Everything else in the policy is
-- carried over verbatim from 028; only the worker branch gains the OR.
--
-- Scope: SELECT only. INSERT stays gated by 041 (same-company approved assignee).
-- UPDATE is intentionally left unchanged so a worker still cannot reassign a task
-- after creation (041's note) — this migration only widens read visibility.
--
-- Idempotent; transaction-wrapped.

begin;

drop policy if exists "role users can read tasks" on public.tasks;
create policy "role users can read tasks" on public.tasks
for select to authenticated
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
);

commit;

-- Verify (as a worker who just created task X assigned to a teammate): the row is
-- now visible, so the app's `.insert(...).select('updated_at')` returns it instead
-- of tripping RLS, and the task appears on the creator's board.
