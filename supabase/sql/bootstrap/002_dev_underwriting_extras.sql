-- DEV-ONLY extra checks for 073 beyond verify/073_underwriting_check.sql: role
-- matrix, cross-tenant, unfiled Bid task, project delete. Self-checking (RAISE on
-- failure); runs in one transaction and rolls back. Needs 001_dev_seed.sql.
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.expect_error(sql text, fragment text default null) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if fragment is not null and position(lower(fragment) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: expected error containing "%" but got "%" for: %', fragment, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'FAIL: expected an error but none was raised for: %', sql;
end $$;

create temp table _x (k text primary key, v text) on commit drop;
grant all on _x to authenticated;

-- admin creates the project-filed Bid underwriting; developer the unfiled one
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into _x select 'uw1', public.create_underwriting_for_task('dev-bid-1')::text;
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000006');
insert into _x select 'uw2', public.create_underwriting_for_task('dev-bid-2')::text;
do $$ begin
  if (select project_id from public.underwritings where id = (select v::uuid from _x where k='uw2')) is not null then
    raise exception 'FAIL: unfiled Bid task produced an underwriting with a project'; end if;
  if (select project_id from public.underwritings where id = (select v::uuid from _x where k='uw1')) is distinct from 'dev-proj-1' then
    raise exception 'FAIL: project not carried from the Bid task'; end if;
end $$;
-- developer is not blocked from the decision
select public.save_underwriting_estimate((select v::uuid from _x where k='uw2'), null, 0, 100, 100, 0, 50, null, null, 200, 400, null);
select public.set_underwriting_status((select v::uuid from _x where k='uw2'), 'ready_for_review');
select public.set_underwriting_status((select v::uuid from _x where k='uw2'), 'declined', 'dev decline');
do $$ begin
  if (select status from public.underwritings where id = (select v::uuid from _x where k='uw2')) <> 'declined' then
    raise exception 'FAIL: developer could not decline'; end if;
end $$;
-- declined is locked except for a return to draft (values differ: inside one transaction
-- now() is constant, so an identical re-save would be an invisible no-op)
select pg_temp.expect_error($q$ select public.save_underwriting_estimate((select v::uuid from _x where k='uw2'), null, 0, 150, 100, 0, 50, null, null, 250, 500, 'x') $q$, 'locked');
select public.set_underwriting_status((select v::uuid from _x where k='uw2'), 'draft', 'reopen');

-- supervisor (sam): can read + edit an existing underwriting, cannot decide, cannot create on an invisible task
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.underwritings) <> 2 then raise exception 'FAIL: supervisor should read 2 underwritings'; end if;
end $$;
select public.save_underwriting_estimate((select v::uuid from _x where k='uw1'), 1000, 10, 500, 500, 0, 20, 1100.00, 11.00, 1000.00, 1250.00, 'supervisor takeoff');
select pg_temp.expect_error($q$ select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'declined') $q$);
select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'ready_for_review');
select pg_temp.expect_error($q$ select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'approved') $q$, 'only an admin');
select pg_temp.expect_error($q$ select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'declined') $q$, 'only an admin');

-- worker (wanda) and sales (sally): no underwriting at all
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
do $$ begin if (select count(*) from public.underwritings)+(select count(*) from public.underwriting_field_changes)+(select count(*) from public.task_underwriting_links) <> 0 then raise exception 'FAIL: worker sees underwriting data'; end if; end $$;
select pg_temp.expect_error($q$ select public.create_underwriting_for_task('dev-bid-1') $q$);
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');
do $$ begin if (select count(*) from public.underwritings)+(select count(*) from public.underwriting_field_changes)+(select count(*) from public.task_underwriting_links) <> 0 then raise exception 'FAIL: sales sees underwriting data'; end if; end $$;
select pg_temp.expect_error($q$ select public.create_underwriting_for_task('dev-bid-1') $q$);

-- cross-tenant: a Beta workspace owner sees nothing and cannot touch Lumen's task
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');
select public.create_workspace('Beta Roofing', 'Bob Beta');
do $$ begin if (select count(*) from public.underwritings)+(select count(*) from public.underwriting_field_changes)+(select count(*) from public.task_underwriting_links) <> 0 then raise exception 'FAIL: Beta tenant sees Lumen underwriting'; end if; end $$;
select pg_temp.expect_error($q$ select public.create_underwriting_for_task('dev-bid-1') $q$);
select pg_temp.expect_error($q$ select public.save_underwriting_estimate((select v::uuid from _x where k='uw1'), 1,1,1,1,1,50,1.01,0.01,3.00,6.00,'steal') $q$);

-- project delete: approve, then delete the project folder; underwriting + approval survive
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'approved', 'ok');
reset role;
delete from public.projects where id = 'dev-proj-1';
do $$ begin
  if not exists (select 1 from public.underwritings where id = (select v::uuid from _x where k='uw1') and project_id is null and status = 'approved') then
    raise exception 'FAIL: approved underwriting did not survive project delete'; end if;
  if (select project_id from public.tasks where id='dev-bid-1') is not null then raise exception 'FAIL: task not unfiled'; end if;
end $$;

do $$ begin raise notice '073 extras: ALL CHECKS PASSED'; end $$;
rollback;
