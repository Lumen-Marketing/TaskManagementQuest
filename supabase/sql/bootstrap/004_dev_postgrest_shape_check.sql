-- DEV-ONLY: replicates HOW PostgREST invokes an RPC and pins the SQLSTATEs the client
-- relies on. Self-checking; one transaction; rolls back. Needs 001_dev_seed.sql.
--
-- PostgREST does not call `save_underwriting_estimate(...)` with positional literals. It
-- takes the JSON request body and runs, in effect:
--     SELECT * FROM public.save_underwriting_estimate(p_id := args.p_id, ...)
--     FROM json_to_record($1) AS args(p_id uuid, p_roof_area_sqft numeric, ...)
-- so a JSON *string* ("8000.00") or *number* (8000) for a numeric parameter is coerced by
-- json_to_record's text input. supabase-js sends the strings built by UnderwritingModel
-- (never JS floats). This proves that mechanism; it is not PostgREST itself — the real
-- thing is verified on the hosted dev project (see docs/runbooks/hosted-dev-test-matrix.md).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
end $$;

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into _p select 'uw', public.create_underwriting_for_task('dev-bid-1')::text;

-- 1. JSON STRING numerics (what supabase-js sends from the model) -> accepted, stored exactly
select public.save_underwriting_estimate(
  p_id := a.p_id, p_roof_area_sqft := a.p_roof_area_sqft, p_waste_percent := a.p_waste_percent,
  p_material_cost := a.p_material_cost, p_labor_cost := a.p_labor_cost, p_other_cost := a.p_other_cost,
  p_target_margin_percent := a.p_target_margin_percent, p_adjusted_roof_area_sqft := a.p_adjusted_roof_area_sqft,
  p_squares := a.p_squares, p_total_estimated_cost := a.p_total_estimated_cost,
  p_recommended_sale_price := a.p_recommended_sale_price, p_reason := a.p_reason)
from json_to_record(json_build_object(
  'p_id', (select v from _p where k = 'uw'), 'p_roof_area_sqft', '2500.00', 'p_waste_percent', '10.00',
  'p_material_cost', '8000.00', 'p_labor_cost', '6000.00', 'p_other_cost', '1000.00',
  'p_target_margin_percent', '35.00', 'p_adjusted_roof_area_sqft', '2750.00', 'p_squares', '27.50',
  'p_total_estimated_cost', '15000.00', 'p_recommended_sale_price', '23076.92', 'p_reason', 'via json strings')) as a(
  p_id uuid, p_roof_area_sqft numeric, p_waste_percent numeric, p_material_cost numeric, p_labor_cost numeric,
  p_other_cost numeric, p_target_margin_percent numeric, p_adjusted_roof_area_sqft numeric, p_squares numeric,
  p_total_estimated_cost numeric, p_recommended_sale_price numeric, p_reason text);
do $$ begin
  if not exists (select 1 from public.underwritings where id = (select v::uuid from _p where k='uw')
                 and recommended_sale_price = 23076.92 and total_estimated_cost = 15000.00 and squares = 27.50) then
    raise exception 'FAIL: string-numeric save did not store the exact values'; end if;
end $$;

-- 2. JSON NUMBERS and an explicit null roof area (roof is optional) also work
select public.save_underwriting_estimate(
  p_id := a.p_id, p_roof_area_sqft := a.p_roof_area_sqft, p_waste_percent := a.p_waste_percent,
  p_material_cost := a.p_material_cost, p_labor_cost := a.p_labor_cost, p_other_cost := a.p_other_cost,
  p_target_margin_percent := a.p_target_margin_percent, p_adjusted_roof_area_sqft := a.p_adjusted_roof_area_sqft,
  p_squares := a.p_squares, p_total_estimated_cost := a.p_total_estimated_cost,
  p_recommended_sale_price := a.p_recommended_sale_price, p_reason := a.p_reason)
from json_to_record(('{"p_id":"' || (select v from _p where k='uw') || '","p_roof_area_sqft":null,"p_waste_percent":0,
  "p_material_cost":8500,"p_labor_cost":6000,"p_other_cost":1000,"p_target_margin_percent":35,
  "p_adjusted_roof_area_sqft":null,"p_squares":null,"p_total_estimated_cost":15500,
  "p_recommended_sale_price":23846.15,"p_reason":"via json numbers"}')::json) as a(
  p_id uuid, p_roof_area_sqft numeric, p_waste_percent numeric, p_material_cost numeric, p_labor_cost numeric,
  p_other_cost numeric, p_target_margin_percent numeric, p_adjusted_roof_area_sqft numeric, p_squares numeric,
  p_total_estimated_cost numeric, p_recommended_sale_price numeric, p_reason text);
do $$ begin
  if (select roof_area_sqft from public.underwritings where id = (select v::uuid from _p where k='uw')) is not null then
    raise exception 'FAIL: null roof area was not stored as null'; end if;
end $$;

-- 3. SQLSTATE contract the client depends on (SupabaseDataStore._throwUnderwritingError
--    surfaces ONLY P0001 messages; everything else becomes a generic "Could not ...")
create or replace function pg_temp.sqlstate_of(q text) returns text language plpgsql as $$
declare st text;
begin
  begin execute q; return 'NO ERROR';
  exception when others then get stacked diagnostics st = returned_sqlstate; return st || ' | ' || sqlerrm; end;
end $$;
do $$
declare r text;
begin
  -- authored trigger/RPC messages -> P0001
  r := pg_temp.sqlstate_of($q$ select public.create_underwriting_for_task('dev-admin-1') $q$);
  if r not like 'P0001 | underwriting can only be created for a Bid task%' then raise exception 'FAIL non-bid: %', r; end if;
  r := pg_temp.sqlstate_of($q$ select public.create_underwriting_for_task('nope') $q$);
  if r not like 'P0001 | task not found%' then raise exception 'FAIL missing task: %', r; end if;
  r := pg_temp.sqlstate_of($q$ select public.set_underwriting_status((select v::uuid from _p where k='uw'), 'approved') $q$);
  if r not like 'P0001 | cannot move underwriting from draft to approved%' then raise exception 'FAIL bad transition: %', r; end if;
  -- a derived figure that disagrees with its inputs -> 23514 (check_violation): generic message client-side
  r := pg_temp.sqlstate_of($q$ select public.save_underwriting_estimate((select v::uuid from _p where k='uw'), null,0,1,1,1,50,null,null,3,99,null) $q$);
  if r not like '23514 | %' then raise exception 'FAIL check violation sqlstate: %', r; end if;
  -- overflow -> 22003 (numeric_value_out_of_range): prevented client-side by UnderwritingModel.LIMITS
  r := pg_temp.sqlstate_of($q$ select public.save_underwriting_estimate((select v::uuid from _p where k='uw'), null,0,9999999999.99,9999999999.99,0,50,null,null,19999999999.98,39999999999.96,null) $q$);
  if r not like '22003 | %' then raise exception 'FAIL overflow sqlstate: %', r; end if;
end $$;
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
do $$
declare r text;
begin
  perform public.set_underwriting_status((select v::uuid from _p where k='uw'), 'ready_for_review');
  r := pg_temp.sqlstate_of($q$ select public.set_underwriting_status((select v::uuid from _p where k='uw'), 'approved') $q$);
  if r not like 'P0001 | only an admin can approve an estimate%' then raise exception 'FAIL supervisor approve: %', r; end if;
  r := pg_temp.sqlstate_of($q$ select public.set_underwriting_status((select v::uuid from _p where k='uw'), 'declined') $q$);
  if r not like 'P0001 | only an admin can decline an estimate%' then raise exception 'FAIL supervisor decline: %', r; end if;
end $$;

do $$ begin raise notice 'postgrest-shape: ALL CHECKS PASSED'; end $$;
rollback;
