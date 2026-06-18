-- 051: Let a user READ any task they're a WATCHER on (within their company).
--
-- Why: the Watching view now lists "Tasks you're watching" for every role,
-- including workers. But the tasks SELECT policy (028 → 043) only lets a worker
-- read tasks they're the assignee or creator of, and a supervisor read their
-- own / their reports' tasks. So a worker (or supervisor) added as a watcher on
-- a teammate's task could see it counted in the Watching badge but NOT load the
-- row — it never appears. Admins/construction_supervisors already read every
-- company task, so only the worker and supervisor branches need widening.
--
-- Fix: add `watchers ? current_member_id()` to the worker and supervisor
-- branches. `watchers` is a JSONB array of member_id strings (migration 013), so
-- the `?` operator is "does this string exist as a top-level array element". The
-- clause stays INSIDE the company_id scope wrapper, so a watcher can only read
-- watched tasks within a company they belong to — no cross-company exposure.
--
-- Everything else is carried over verbatim from 043; only the two branches gain
-- the OR. SELECT only — INSERT/UPDATE/DELETE policies are unchanged.
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
          or watchers ? public.current_member_id()
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
          or watchers ? public.current_member_id()
          or id = 'general-shift'
        )
      )
    )
  )
);

commit;

-- Verify (as a worker added as a watcher on a teammate's task): the task row is
-- now readable, so it loads into the client and shows under "Tasks you're
-- watching". A worker who is NOT a watcher and not the assignee/creator still
-- cannot read it.
