-- 041: A worker may only assign a task to an approved member of the SAME company.
--
-- Background: migration 028 opened task INSERT to workers but only gated the
-- task's OWN company (company_id must be in the worker's company_ids). It put no
-- constraint on assignee_id, so a worker could create an in-company task assigned
-- to anyone — a member of another company, or a ghost/unapproved row that still
-- exists in team_members. This tightens the worker branch of the INSERT policy so
-- the assignee must be an approved profile that shares the task's company.
--
-- Scope of this change:
--   * Only the WORKER branch is constrained. Managers (admin / supervisor /
--     construction_supervisor / sales) are unchanged — they may still assign to
--     anyone within their company, matching how they manage across a team.
--   * Assigning to YOURSELF keeps working: your own approved profile is in the
--     company, so the check passes.
--   * Only INSERT needs this. The UPDATE policy (028) already pins a worker's
--     assignee_id to themselves, so a worker cannot reassign a task to anyone
--     else after creation — there's no cross-company leak to close on update.
--
-- "Approved member of the company" uses the same semantics as elsewhere
-- (activePeople / migration 039): a profile whose `approved` is not explicitly
-- false and whose company_ids contains the task's company.
--
-- Why a SECURITY DEFINER helper: workers can't read public.profiles (RLS), so an
-- inline `exists (select 1 from profiles ...)` in the WITH CHECK would be
-- filtered to nothing for the very role we're gating. The helper runs as definer
-- to see profiles, and only ever answers a yes/no membership question.
--
-- Idempotent; transaction-wrapped.

begin;

-- Is p_member_id an approved profile that belongs to company p_company_id?
create or replace function public.assignee_in_company(p_member_id text, p_company_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.member_id = p_member_id
      and p.approved is distinct from false
      and p_company_id = any(p.company_ids)
  );
$$;

revoke all on function public.assignee_in_company(text, text) from public, anon;
grant execute on function public.assignee_in_company(text, text) to authenticated;

-- Recreate the tasks INSERT policy (supersedes 028:109) with the worker branch
-- requiring a same-company approved assignee. Developer + manager branches are
-- carried over verbatim.
drop policy if exists "role users can insert tasks" on public.tasks;
create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and (
      public.current_profile_role() in ('admin', 'supervisor', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'worker'
        and public.assignee_in_company(assignee_id, company_id)
      )
    )
  )
);

commit;

-- Verify (authenticated as a worker in company 'roofing'):
--   * insert a task company_id='roofing', assignee_id = an approved roofing
--     member -> succeeds.
--   * insert with assignee_id = a member of another company, or an
--     unapproved/ghost member -> rejected by RLS.
--   * insert with assignee_id = yourself -> succeeds.
