-- 028: Company scoping (multi-tenant data isolation) for tasks.
--
-- Until now the tasks RLS policies (migration 017) gated access by ROLE only,
-- so any admin/supervisor could read and write tasks in EVERY company through
-- the API. The product now requires per-company isolation enforced at the data
-- layer. This migration adds public.current_company_ids() and rewrites the four
-- tasks policies so that, on top of the role gate, every non-developer is
-- confined to tasks whose company_id is one of their profiles.company_ids.
-- Within that company window, row visibility is further narrowed by role:
--
--   worker     -> only tasks assigned to them (+ shared general-shift)
--   supervisor -> tasks assigned to/created by them, or assigned to a direct
--                 report (profiles.supervisor_id = caller's member_id)
--   admin      -> all tasks in their companies
--   developer  -> ALL tasks, ALL companies (company gate bypassed = god mode)
--
-- It also OPENS task INSERT to workers (previously blocked), constrained to
-- their own companies, because workers now create tasks.
--
-- Identity mapping: tasks.assignee_id / creator_id -> team_members.id;
-- profiles.member_id -> team_members.id; a supervisor's reports are profiles
-- whose supervisor_id equals the supervisor's member_id.
--
-- general-shift (the shared clock-in bucket, company 'roofing') keeps a
-- carve-out so any worker can read/update it regardless of company access.
--
-- Retired role names (construction_supervisor, sales) are left in the IN(...)
-- lists: once no profile holds them they are inert, and keeping them avoids
-- surprise lockouts if this runs before everyone is migrated.
--
-- time_entries / active_timers / notifications are intentionally left
-- owner-scoped (migration 008): a user only ever sees their own rows, so no
-- cross-company task data leaks through them. Task isolation is the hard
-- requirement and is what this migration enforces.
--
-- Transaction-wrapped; all policies dropped before recreate; idempotent.

begin;

------------------------------------------------------------------------
-- 1. Helper: the caller's company access list.
--    SECURITY DEFINER + STABLE + locked search_path, mirroring
--    current_profile_role() / current_member_id() from migration 007.
--    Coalesced to '{}' so `= any(...)` is well-defined (fails closed)
--    for a missing/anon profile.
------------------------------------------------------------------------
create or replace function public.current_company_ids()
returns text[]
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(
    (select p.company_ids from public.profiles p where p.id = auth.uid()),
    '{}'::text[]
  );
$$;

revoke all on function public.current_company_ids() from public, anon;
grant execute on function public.current_company_ids() to authenticated;

-- Supports the supervisor EXISTS subquery below (only supervisor_id was indexed).
create index if not exists profiles_member_id_idx on public.profiles(member_id);

------------------------------------------------------------------------
-- 2. Rewrite tasks policies (supersedes 017:73-113).
------------------------------------------------------------------------
drop policy if exists "role users can read tasks"          on public.tasks;
drop policy if exists "role users can insert tasks"        on public.tasks;
drop policy if exists "role users can update tasks"        on public.tasks;
drop policy if exists "role users can delete tasks"        on public.tasks;
drop policy if exists "worker can read general shift task" on public.tasks;

----------------------------------------------------------------
-- SELECT
----------------------------------------------------------------
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
        and (assignee_id = public.current_member_id() or id = 'general-shift')
      )
    )
  )
);

----------------------------------------------------------------
-- INSERT  (workers now allowed, scoped to their companies)
----------------------------------------------------------------
create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'worker', 'construction_supervisor', 'sales')
  )
);

----------------------------------------------------------------
-- UPDATE  (same visibility rule on both sides of the lock; the
--          with-check also blocks moving a task into a company
--          you don't belong to)
----------------------------------------------------------------
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
        and (assignee_id = public.current_member_id() or id = 'general-shift')
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
        and (assignee_id = public.current_member_id() or id = 'general-shift')
      )
    )
  )
);

----------------------------------------------------------------
-- DELETE  (management roles, in-company; mirrors the JS
--          canDeleteTasks list in AppController)
----------------------------------------------------------------
create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'construction_supervisor', 'sales')
  )
);

commit;

-- Verify (run while authenticated as a worker): should return only the
-- worker's own in-company tasks plus general-shift.
--   select id, company_id, assignee_id from public.tasks order by company_id;
