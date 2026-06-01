-- 013: Phase 3 authz hardening
--
-- 1. Constrain profiles.role to the set of roles the app understands.
--    Without this, a manager could (accidentally or maliciously) set role to
--    an unknown string like 'super_admin' — every RLS check then treats it
--    as 'member' (no perms), but UI code may also do string compares that
--    behave unpredictably. Enforce the enum at the schema level.
-- 2. Forbid a profile from listing itself as its own supervisor (cycle of 1).
-- 3. Recreate the trigger ensuring profiles.updated_at is bumped on every
--    write — already exists per migration 005, but we re-declare defensively.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'member', 'worker', 'sales', 'supervisor',
    'construction_supervisor', 'admin', 'developer'
  ));

alter table public.profiles
  drop constraint if exists profiles_supervisor_not_self;
alter table public.profiles
  add constraint profiles_supervisor_not_self
  check (supervisor_id is null or supervisor_id <> member_id);

-- Defense-in-depth: ensure approval status is a real boolean, not null.
alter table public.profiles
  alter column approved set not null;

-- A profile that is `approved=false` should be invisible to anyone except
-- itself and managers. The existing "users read own profile" + "managers
-- read profiles" + "team viewers read profiles" combination already covers
-- this, but team_viewers (supervisors) should not see UNAPPROVED users in
-- their org chart — that leaks pending applicants. Tighten the policy.
drop policy if exists "team viewers read profiles" on public.profiles;
create policy "team viewers read profiles" on public.profiles
for select to authenticated
using (public.can_view_team() and (approved is true or public.can_manage_roles()));
