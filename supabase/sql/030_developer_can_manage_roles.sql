-- 030: Restore developer to can_manage_roles() so developers can see and
--      approve PENDING (unapproved) users.
--
-- Symptom this fixes: a developer opens the Approvals page and sees only
-- already-approved users; brand-new signups (approved=false) never appear,
-- so they can't be approved.
--
-- Root cause: the profiles read policies (migration 014) only return
-- unapproved rows when public.can_manage_roles() is true --
--
--   team viewers read profiles:  can_view_team() AND (approved is true OR can_manage_roles())
--   managers read profiles:      can_manage_roles()
--
-- Migration 011 already widened can_manage_roles() to include 'developer',
-- but this database is running the older 007 definition (it was never
-- applied here -- evidenced by signups still landing with the retired
-- role='member', which migration 032 was meant to remove). Under the 007
-- definition a developer fails can_manage_roles(), so RLS filters every
-- pending profile out of the result before it reaches the browser.
--
-- This re-asserts the 011 definition. Idempotent / safe to re-run.
--
-- NOTE: this fixes the immediate Approvals visibility bug, but the real
-- problem is that the live database is behind on migrations. After this,
-- apply the unrun migrations in order (notably 032 to retire the 'member'
-- role and refresh handle_new_user, 029 to install the signup trigger
-- + backfill, and 033 to harden member_id/role integrity) so new signups
-- behave correctly going forward.

begin;

create or replace function public.can_manage_roles()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_profile_role() in ('admin', 'construction_supervisor', 'developer');
$$;

revoke all on function public.can_manage_roles() from public, anon;
grant execute on function public.can_manage_roles() to authenticated;

commit;

-- Verify the new definition includes 'developer':
--   select prosrc from pg_proc where proname = 'can_manage_roles';
-- Then reload the Approvals page (or click Refresh): pending users should appear.
