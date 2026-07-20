-- Two-tenant isolation proof for migration 072. RUN ON A DEV COPY.
--
-- Proves that Business A (Lumen / tenant 0) and Business B cannot see or write
-- each other's data — enforced at the DATABASE (RLS), not just the UI. This is
-- the gate that greenlights applying 072 to PROD.
--
-- Setup required before running:
--   * userA = an existing Lumen admin (already tenant 0 after the 072 backfill).
--   * userB = a brand-new auth user with a profile row whose tenant_id IS NULL
--             (i.e. signed up but has not created a workspace yet).
--   Substitute the two real auth.users UUIDs for <USER_A_UUID> / <USER_B_UUID>.
--
-- Impersonation: current_tenant_id()/auth.uid() read request.jwt.claims.sub,
-- so setting that claim makes RLS behave as that user. Run in the Supabase SQL
-- Editor (as a role that RLS applies to) or: psql -f this_file.
--
-- Expected PASS output is called out inline. ANY deviation = do NOT ship to PROD.

------------------------------------------------------------------------
-- 1. userB creates their own workspace (tenant B).
------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';

select public.create_workspace('Beta Roofing', 'Bob Beta') as tenant_b;
-- PASS: returns a fresh uuid. (Re-running fails with "account already belongs
-- to a workspace" — that guard is also correct behaviour.)

------------------------------------------------------------------------
-- 2. Cross-tenant READ isolation.
------------------------------------------------------------------------
-- As userA (Lumen / tenant 0):
set local request.jwt.claims to '{"sub":"<USER_A_UUID>"}';
select 'A: Beta company visible?' as check, count(*) as n
  from public.companies where label = 'Beta Roofing';        -- PASS: n = 0
select 'A: own tasks visible' as check, count(*) as n
  from public.tasks;                                          -- PASS: n = Lumen's task count (unchanged)

-- As userB (Beta / tenant B):
set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';
select 'B: Lumen roofing company visible?' as check, count(*) as n
  from public.companies where id = 'roofing';                -- PASS: n = 0
select 'B: Lumen tasks visible?' as check, count(*) as n
  from public.tasks where tenant_id = '00000000-0000-0000-0000-000000000000';  -- PASS: n = 0
select 'B: own companies' as check, count(*) as n
  from public.companies;                                     -- PASS: n = 2 (default co_* + overall_*)

------------------------------------------------------------------------
-- 3. Cross-tenant WRITE isolation: userB tries to insert a task into tenant 0.
--    The stamp trigger (explicit foreign tenant_id) OR the restrictive
--    WITH CHECK must reject it.
------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';
do $$
begin
  insert into public.tasks
    (id, title, description, company_id, creator_id, assignee_id, due, tenant_id)
  values
    ('x-leak-072', 'leak', '', 'roofing', 'abraham', 'abraham', now()::date,
     '00000000-0000-0000-0000-000000000000');
  raise exception 'FAIL: cross-tenant insert into tenant 0 SUCCEEDED';
exception
  when others then
    raise notice 'PASS: cross-tenant insert blocked (%).', sqlerrm;
end $$;

------------------------------------------------------------------------
-- 4. developer role is tenant-clamped (Task 6): a developer in tenant B
--    still sees no tenant-0 rows. Run only if userB is set to role developer.
--    (Optional; skip if you don't want to flip userB's role.)
------------------------------------------------------------------------
-- update public.profiles set role='developer' where id='<USER_B_UUID>';  -- via service role
-- set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';
-- select 'B-dev: Lumen tasks visible?' as check, count(*) as n
--   from public.tasks where tenant_id = '00000000-0000-0000-0000-000000000000';  -- PASS: n = 0

------------------------------------------------------------------------
-- 5. Cleanup (run as service role / postgres, outside RLS):
--   delete from public.tasks where id = 'x-leak-072';
--   -- and tear down tenant B + userB's seeded rows if this was a scratch run.
------------------------------------------------------------------------
