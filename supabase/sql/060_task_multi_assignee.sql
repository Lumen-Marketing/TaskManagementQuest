-- 060: Ordered multi-assignee for tasks.
--
-- The app now supports assigning a task to MORE THAN ONE person, kept in order
-- with index 0 as the accountable "lead". The lead is ALSO mirrored into the
-- existing single assignee_id column by the client, so every prior RLS policy,
-- notify path, and query keeps working unchanged. This migration only ADDS:
--   (a) tasks.assignee_ids text[], backfilled from the current single assignee, and
--   (b) a NEW permissive SELECT policy so a NON-LEAD assignee can read the task.
--
-- Why an additive policy instead of editing "role users can read tasks" (043/051):
-- Postgres combines PERMISSIVE policies with OR, so a separate policy can only
-- WIDEN visibility — it cannot break any existing read path. The big role-branched
-- policy is left untouched. The new grant mirrors 051's watcher pattern: it uses
-- public.current_member_id() and stays inside the company window
-- (company_id = any(current_company_ids())) so there is no cross-company exposure.
-- Assignment is already company-scoped (migration 041), so a non-lead assignee is
-- always same-company anyway; the company guard is defence-in-depth.
--
-- SELECT only. INSERT/UPDATE/DELETE policies are unchanged. Idempotent.

begin;

alter table public.tasks
  add column if not exists assignee_ids text[] not null default '{}';

-- Backfill: seed the array from the current single assignee where present and the
-- array hasn't already been populated.
update public.tasks
  set assignee_ids = array[assignee_id]
  where assignee_id is not null
    and (assignee_ids is null or assignee_ids = '{}');

drop policy if exists "assignees can read tasks" on public.tasks;
create policy "assignees can read tasks" on public.tasks
for select to authenticated
using (
  public.current_member_id() = any(assignee_ids)
  and (company_id = any(public.current_company_ids()) or id = 'general-shift')
);

commit;

-- Verify (as a worker who is a NON-LEAD assignee on a teammate's task, i.e. their
-- member id is in assignee_ids but not assignee_id): the row is now readable and
-- loads into their board. A worker who is neither assignee, creator, nor watcher
-- still cannot read it.
