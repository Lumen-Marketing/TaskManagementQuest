-- Verification for migration 073 (underwriting). RUN ON A DEV COPY ONLY.
--
-- Self-checking: every assertion RAISES on failure, so a clean run that prints
-- "073 verify: ALL CHECKS PASSED" is the pass signal. The whole script runs in one
-- transaction and ROLLS BACK, leaving the dev copy untouched.
--
-- Substitute these placeholders (all must already exist in the dev copy):
--   <ADMIN_UUID>      auth.users id of an admin (or developer) with a member_id,
--                     whose company_ids include the company of <BID_TASK_ID>
--   <WORKER_UUID>     auth.users id of a worker in that same company
--   <SUPERVISOR_UUID> auth.users id of a supervisor in that same company
--   <BID_TASK_ID>     an existing task with type = 'bid' in that company
--   <NON_BID_TASK_ID> an existing task with type <> 'bid' in that company
--
-- Cross-tenant isolation of the new tables rides the same RESTRICTIVE wall as 072;
-- re-run supabase/sql/verify/072_isolation_check.sql after applying 073 to prove it.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/sql/verify/073_underwriting_check.sql

begin;

-- Helper: act as a user (RLS applies) or as the owner.
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
end $$;

-- Helper: assert that running `sql` fails (optionally with a message fragment).
create or replace function pg_temp.expect_error(sql text, fragment text default null) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if fragment is not null and position(lower(fragment) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: expected error containing "%" but got "%" for: %', fragment, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'FAIL: expected an error but none was raised for: %', sql;
end $$;

------------------------------------------------------------------------
-- 1. Structure
------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['underwritings','underwriting_field_changes','task_underwriting_links'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'FAIL: % missing or RLS not enabled', t;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                   and policyname = 'tenant_isolation_' || t and permissive = 'RESTRICTIVE') then
      raise exception 'FAIL: % has no RESTRICTIVE tenant wall', t;
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass
                   and tgname = 'stamp_tenant_' || t) then
      raise exception 'FAIL: % has no tenant stamp trigger', t;
    end if;
  end loop;
end $$;

-- The history table is append-only for clients: SELECT only.
do $$
declare p text;
begin
  foreach p in array array['insert','update','delete','truncate'] loop
    if has_table_privilege('authenticated', 'public.underwriting_field_changes', p) then
      raise exception 'FAIL: authenticated has % on underwriting_field_changes', p;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.underwritings', 'select') then
    raise exception 'FAIL: anon can read underwritings';
  end if;
end $$;

------------------------------------------------------------------------
-- 2. Bid-task linkage
------------------------------------------------------------------------
select pg_temp.act_as('<ADMIN_UUID>'::uuid);

create temp table _ctx (uw uuid) on commit drop;
grant all on _ctx to authenticated;

insert into _ctx select public.create_underwriting_for_task('<BID_TASK_ID>');

do $$
declare a uuid; b uuid;
begin
  select uw into a from _ctx;
  b := public.create_underwriting_for_task('<BID_TASK_ID>');
  if a is null or a is distinct from b then
    raise exception 'FAIL: create_underwriting_for_task is not idempotent (% vs %)', a, b;
  end if;
  if (select count(*) from public.task_underwriting_links where task_id = '<BID_TASK_ID>') <> 1 then
    raise exception 'FAIL: expected exactly one link for the bid task';
  end if;
end $$;

select pg_temp.expect_error($q$ select public.create_underwriting_for_task('<NON_BID_TASK_ID>') $q$, 'Bid task');
select pg_temp.expect_error($q$ select public.create_underwriting_for_task('no-such-task') $q$, 'not found');

-- Creation writes the first history row (status: null -> draft) attributed to the actor.
do $$
declare n int;
begin
  select count(*) into n from public.underwriting_field_changes f, _ctx
   where f.underwriting_id = _ctx.uw and f.field_name = 'status' and f.old_value is null
     and f.new_value = 'draft' and f.changed_by = public.current_member_id();
  if n <> 1 then raise exception 'FAIL: expected one creation history row, got %', n; end if;
end $$;

------------------------------------------------------------------------
-- 3. Save: derived figures must match the formulas; history is atomic
------------------------------------------------------------------------
-- A derived figure that disagrees with its inputs is rejected by the CHECKs.
select pg_temp.expect_error($q$
  select public.save_underwriting_estimate((select uw from _ctx),
    2500, 10, 8000, 6000, 1000, 35, 2750.00, 27.50, 15000.00, 99999.99, null) $q$,
  'underwritings_price_consistent');
select pg_temp.expect_error($q$
  select public.save_underwriting_estimate((select uw from _ctx),
    2500, 10, 8000, 6000, 1000, 35, 2751.00, 27.50, 15000.00, 23076.92, null) $q$,
  'underwritings_area_consistent');
select pg_temp.expect_error($q$
  select public.save_underwriting_estimate((select uw from _ctx),
    2500, 10, 8000, 6000, 1000, 35, 2750.00, 27.50, 14999.00, 23075.38, null) $q$,
  'underwritings_total_cost_consistent');

select public.save_underwriting_estimate((select uw from _ctx),
  2500, 10, 8000, 6000, 1000, 35, 2750.00, 27.50, 15000.00, 23076.92, 'initial takeoff');

do $$
declare r record; n int;
begin
  select * into r from public.underwritings where id = (select uw from _ctx);
  if r.recommended_sale_price <> 23076.92 or r.calculated_at is null then
    raise exception 'FAIL: estimate not stored (%, %)', r.recommended_sale_price, r.calculated_at;
  end if;
  -- First calculation: every entered input appears with old_value NULL (never entered,
  -- the column defaults are not a real "previous value"), carrying the reason.
  select count(*) into n from public.underwriting_field_changes f
   where f.underwriting_id = r.id and f.old_value is null and f.reason = 'initial takeoff'
     and f.field_name in ('roof_area_sqft','waste_percent','material_cost','labor_cost','other_cost','target_margin_percent');
  if n <> 6 then raise exception 'FAIL: expected 6 first-calculation history rows, got %', n; end if;
end $$;

-- A later edit records old -> new for ONLY the changed field.
select public.save_underwriting_estimate((select uw from _ctx),
  2500, 10, 8500, 6000, 1000, 35, 2750.00, 27.50, 15500.00, 23846.15, 'supplier raised price');
do $$
declare r record; n int;
begin
  select count(*) into n from public.underwriting_field_changes f, _ctx
   where f.underwriting_id = _ctx.uw and f.reason = 'supplier raised price';
  if n <> 1 then raise exception 'FAIL: expected exactly 1 row for the material edit, got %', n; end if;
  select f.* into r from public.underwriting_field_changes f, _ctx
   where f.underwriting_id = _ctx.uw and f.reason = 'supplier raised price';
  if r.field_name <> 'material_cost' or r.old_value <> '8000.00' or r.new_value <> '8500.00'
     or r.changed_by is distinct from public.current_member_id() then
    raise exception 'FAIL: bad material history row (% % -> %, by %)', r.field_name, r.old_value, r.new_value, r.changed_by;
  end if;
end $$;

-- Re-saving identical values writes no history.
select public.save_underwriting_estimate((select uw from _ctx),
  2500, 10, 8500, 6000, 1000, 35, 2750.00, 27.50, 15500.00, 23846.15, 'no-op');
do $$ begin
  if exists (select 1 from public.underwriting_field_changes where reason = 'no-op') then
    raise exception 'FAIL: a no-op save wrote history';
  end if;
end $$;

------------------------------------------------------------------------
-- 4. History cannot be tampered with, even by its own reader
------------------------------------------------------------------------
select pg_temp.expect_error($q$ update public.underwriting_field_changes set new_value = 'x' $q$);
select pg_temp.expect_error($q$ delete from public.underwriting_field_changes $q$);
select pg_temp.expect_error($q$ insert into public.underwriting_field_changes
  (underwriting_id, company_id, field_name, new_value)
  select uw, (select company_id from public.underwritings where id = uw), 'status', 'approved' from _ctx $q$);

------------------------------------------------------------------------
-- 5. Status machine + approval
------------------------------------------------------------------------
select pg_temp.expect_error($q$ select public.set_underwriting_status((select uw from _ctx), 'approved') $q$, 'cannot move');
select public.set_underwriting_status((select uw from _ctx), 'ready_for_review', 'ready for Abraham');
do $$ begin
  if not exists (select 1 from public.underwriting_field_changes f, _ctx
                  where f.underwriting_id = _ctx.uw and f.field_name = 'status'
                    and f.old_value = 'draft' and f.new_value = 'ready_for_review'
                    and f.reason = 'ready for Abraham') then
    raise exception 'FAIL: status change not in history';
  end if;
end $$;

-- A worker cannot read underwriting at all (margins/costs), nor approve.
reset role;
select pg_temp.act_as('<WORKER_UUID>'::uuid);
do $$ begin
  if (select count(*) from public.underwritings) <> 0 then raise exception 'FAIL: worker can read underwritings'; end if;
  if (select count(*) from public.underwriting_field_changes) <> 0 then raise exception 'FAIL: worker can read history'; end if;
end $$;
select pg_temp.expect_error($q$ select public.set_underwriting_status((select uw from _ctx), 'approved') $q$);

-- A supervisor can read the estimate but may neither approve nor decline it.
reset role;
select pg_temp.act_as('<SUPERVISOR_UUID>'::uuid);
do $$ begin
  if (select count(*) from public.underwritings) <> 1 then raise exception 'FAIL: supervisor cannot read the underwriting'; end if;
end $$;
select pg_temp.expect_error($q$ select public.set_underwriting_status((select uw from _ctx), 'declined') $q$, 'only an admin');
select pg_temp.expect_error($q$ select public.set_underwriting_status((select uw from _ctx), 'approved') $q$, 'only an admin');

-- Admin approves; the numbers then lock.
reset role;
select pg_temp.act_as('<ADMIN_UUID>'::uuid);
select public.set_underwriting_status((select uw from _ctx), 'approved', 'approved at 35%');
do $$
declare r record;
begin
  select * into r from public.underwritings where id = (select uw from _ctx);
  if r.status <> 'approved' or r.approved_by is distinct from public.current_member_id() or r.approved_at is null then
    raise exception 'FAIL: approval not stamped (%, %, %)', r.status, r.approved_by, r.approved_at;
  end if;
end $$;
select pg_temp.expect_error($q$
  select public.save_underwriting_estimate((select uw from _ctx),
    2500, 10, 9999, 6000, 1000, 35, 2750.00, 27.50, 16999.00, 26152.31, 'sneaky') $q$, 'locked');
select pg_temp.expect_error($q$ select public.set_underwriting_status((select uw from _ctx), 'draft') $q$, 'cannot move');
select pg_temp.expect_error($q$ update public.underwritings set approved_by = null, status = 'draft' where id = (select uw from _ctx) $q$);

reset role;
select 'ok' as _; -- keep psql output tidy
do $$ begin raise notice '073 verify: ALL CHECKS PASSED'; end $$;

rollback;
