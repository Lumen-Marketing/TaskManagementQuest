-- 048: Reinstate a "sales" role that is identical to "worker".
--
-- Request: add a Sales role. Functionally it must be EXACTLY a worker — same
-- task access, same clock/time scope, same everything — just a different label
-- so the org can tag salespeople distinctly in the roster and Approvals picker.
--
-- Why this is an ALIAS, not a new first-class role
-- ------------------------------------------------
-- 'sales' is not a clean slate. It was a MANAGER-level role before it was
-- retired in 032/033, and its name is still baked into dozens of *manager*
-- branches across the RLS policies (007/011/017/028 and their successors), e.g.
--   ... current_profile_role() in ('admin','supervisor','sales', ...)   -- full task access
--   ... team_members write allowed to (...,'sales')                     -- member management
-- If we simply re-allowed 'sales' as a stored role, every one of those stale
-- entries would light up again and a "sales" user would get MANAGER access —
-- the opposite of "same as a worker".
--
-- Instead we resolve sales -> worker inside current_profile_role(), the single
-- SECURITY DEFINER helper every policy funnels through. The effect:
--   * Every `current_profile_role() = 'worker'` branch now ALSO matches a sales
--     profile  -> sales gets exactly the worker carve-outs (create/own/delegate
--     tasks within company, read general-shift, clock in, etc.).
--   * Every stale `in (..., 'sales')` MANAGER branch stops matching (the helper
--     never returns the literal 'sales') -> sales does NOT get manager access.
-- One change, and sales tracks worker for all existing AND future policies.
--
-- The stored profiles.role stays 'sales' (so the UI label and the roster reflect
-- it). Only the access-resolution sees it as 'worker'. The notify-email Edge
-- Function reads profiles.role directly (not via this helper), so 'sales' is
-- removed from its SEND_ROLES allowlist separately — a worker can't send mail,
-- so neither can sales.
--
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

-- 1. Allow 'sales' to be stored again. Supersedes the constraint from 033
--    (which permitted only worker/supervisor/admin/developer).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('worker', 'sales', 'supervisor', 'admin', 'developer'));

-- 2. Resolve sales -> worker for ALL row-level access. Mirror of the definition
--    in migration 007, with the single CASE added. Keeps the 'member' fallback
--    for a missing/null profile row.
create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case when role_raw = 'sales' then 'worker' else role_raw end
  from (
    select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'member') as role_raw
  ) t;
$$;

-- Re-assert the grants from 007/010 (create or replace preserves them, but be
-- explicit so a fresh apply of just this file is correct).
revoke all on function public.current_profile_role() from public;
revoke execute on function public.current_profile_role() from anon, public;
grant execute on function public.current_profile_role() to authenticated;

commit;

-- Verify:
--   -- as an admin, set a test user to sales, then while authenticated AS that
--   -- user confirm the helper reports worker and worker-scoped reads apply:
--   select public.current_profile_role();           -- expect: worker
--   -- and that a sales user is denied member management / email send exactly
--   -- like a worker.
