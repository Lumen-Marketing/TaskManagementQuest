-- DEV-ONLY checks for 074 (proposals). Self-checking (RAISE on failure); one
-- transaction, rolls back. Needs 001_dev_seed.sql and 073.
--
-- Sprint scenario: roof 2000 sqft, waste 10%, material 8000, labor 4000, other 1000,
-- target margin 30%  ->  total cost 13000, approved sale price 18571.43.
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

-- 0. structure: no cost / margin column can exist on the customer-facing row
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='proposals'
             and (column_name ~ 'cost|margin|labor|material|recommended')) then
    raise exception 'FAIL: proposals carries an internal cost/margin column'; end if;
  if not exists (select 1 from pg_policies where tablename='proposals' and policyname='tenant_isolation_proposals' and permissive='RESTRICTIVE') then
    raise exception 'FAIL: proposals has no RESTRICTIVE tenant wall'; end if;
  if has_table_privilege('authenticated','public.proposal_counters','select') or has_table_privilege('authenticated','public.proposal_counters','insert') then
    raise exception 'FAIL: clients can touch proposal_counters'; end if;
  if has_function_privilege('authenticated','public.assign_proposal_number(text)','execute') then
    raise exception 'FAIL: clients can call assign_proposal_number'; end if;
end $$;

-- 1. admin builds the sprint estimate on the project-filed Bid task
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into _x select 'uw1', public.create_underwriting_for_task('dev-bid-1')::text;
select public.save_underwriting_estimate((select v::uuid from _x where k='uw1'),
  2000, 10, 8000, 4000, 1000, 30, 2200.00, 22.00, 13000.00, 18571.43, 'sprint scenario');

-- 2. not approved yet -> no proposal (draft, then ready_for_review)
select pg_temp.expect_error($q$ select public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1')) $q$, 'approved underwriting');
select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'ready_for_review');
select pg_temp.expect_error($q$ select public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1')) $q$, 'approved underwriting');
select pg_temp.expect_error($q$ insert into public.proposals (underwriting_id) values ((select v::uuid from _x where k='uw1')) $q$, 'approved underwriting');

-- 3. approved -> proposal inherits the price
select public.set_underwriting_status((select v::uuid from _x where k='uw1'), 'approved');
insert into _x select 'p1', public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1'))::text;
do $$ declare p record; begin
  select * into p from public.proposals where id = (select v::uuid from _x where k='p1');
  if p.total <> 18571.43 then raise exception 'FAIL: total % <> 18571.43', p.total; end if;
  if p.proposal_number <> 1 then raise exception 'FAIL: first number is %', p.proposal_number; end if;
  if p.company_id <> 'roofing' or p.project_id <> 'dev-proj-1' or p.task_id <> 'dev-bid-1' then
    raise exception 'FAIL: wrong company/project/task: % % %', p.company_id, p.project_id, p.task_id; end if;
  if p.client_name <> 'CNL Properties' or p.project_name <> 'Paradise Valley re-roof' then
    raise exception 'FAIL: client/project snapshot: % / %', p.client_name, p.project_name; end if;
  if p.company_name = '' or p.title = '' or p.scope_of_work = '' or p.terms = '' then
    raise exception 'FAIL: defaults not filled'; end if;
  if p.scope_of_work || p.terms || p.title ~* '(13,?000|8,?000|4,?000|margin|markup|cost)' then
    raise exception 'FAIL: default text mentions internal numbers'; end if;
end $$;

-- 4. repeat generation is intentional: same row, same number, counter not burned
insert into _x select 'p1b', public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1'))::text;
do $$ begin
  if (select v from _x where k='p1b') <> (select v from _x where k='p1') then raise exception 'FAIL: repeat create made a new proposal'; end if;
  if (select count(*) from public.proposals) <> 1 then raise exception 'FAIL: duplicate proposal rows'; end if;
end $$;

-- 5. editable vs immutable
update public.proposals set title = 'Re-roof proposal', scope_of_work = 'Tear off and replace.', terms = 'Net 15',
  client_name = 'CNL Properties LLC', job_address = '1 Main St' where id = (select v::uuid from _x where k='p1');
select pg_temp.expect_error($q$ update public.proposals set total = 1 where id = (select v::uuid from _x where k='p1') $q$, 'permission denied');
select pg_temp.expect_error($q$ update public.proposals set proposal_number = 99 where id = (select v::uuid from _x where k='p1') $q$, 'permission denied');
select pg_temp.expect_error($q$ update public.proposals set company_id = 'lumen' where id = (select v::uuid from _x where k='p1') $q$, 'permission denied');
select pg_temp.expect_error($q$ insert into public.proposals (underwriting_id, title) values (gen_random_uuid(), 'x') $q$);
-- column grant stops a forged total/number on insert
select pg_temp.expect_error($q$ insert into public.proposals (underwriting_id, total, proposal_number) values ((select v::uuid from _x where k='uw1'), 1, 5) $q$, 'permission denied');
-- even as the table owner the guard trigger holds the line
reset role;
select pg_temp.expect_error($q$ update public.proposals set total = 1 where id = (select v::uuid from _x where k='p1') $q$, 'immutable');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
do $$ begin
  if (select title from public.proposals where id = (select v::uuid from _x where k='p1')) <> 'Re-roof proposal' then raise exception 'FAIL: edit lost'; end if;
  if (select total from public.proposals where id = (select v::uuid from _x where k='p1')) <> 18571.43 then raise exception 'FAIL: total changed'; end if;
end $$;

-- 6. second proposal in the same company gets number 2 (developer on the unfiled Bid)
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000006');
insert into _x select 'uw2', public.create_underwriting_for_task('dev-bid-2')::text;
select public.save_underwriting_estimate((select v::uuid from _x where k='uw2'), null, 0, 100, 100, 0, 50, null, null, 200, 400, null);
select public.set_underwriting_status((select v::uuid from _x where k='uw2'), 'ready_for_review');
select public.set_underwriting_status((select v::uuid from _x where k='uw2'), 'approved');
insert into _x select 'p2', public.create_proposal_for_underwriting((select v::uuid from _x where k='uw2'))::text;
do $$ declare p record; begin
  select * into p from public.proposals where id = (select v::uuid from _x where k='p2');
  if p.proposal_number <> 2 then raise exception 'FAIL: second number is %', p.proposal_number; end if;
  if p.project_id is not null or p.client_name <> '' then raise exception 'FAIL: unfiled project leaked context'; end if;
end $$;

-- 7. supervisor reads; worker / sales see and create nothing
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
do $$ begin if (select count(*) from public.proposals) <> 2 then raise exception 'FAIL: supervisor should read 2 proposals'; end if; end $$;
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
do $$ begin if (select count(*) from public.proposals) <> 0 then raise exception 'FAIL: worker sees proposals'; end if; end $$;
select pg_temp.expect_error($q$ select public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1')) $q$);
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');
do $$ begin if (select count(*) from public.proposals) <> 0 then raise exception 'FAIL: sales sees proposals'; end if; end $$;

-- 8. another tenant: sees nothing, cannot generate or edit
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');
select public.create_workspace('Beta Roofing', 'Bob Beta');
do $$ begin if (select count(*) from public.proposals) <> 0 then raise exception 'FAIL: Beta tenant sees Lumen proposals'; end if; end $$;
select pg_temp.expect_error($q$ select public.create_proposal_for_underwriting((select v::uuid from _x where k='uw1')) $q$);
do $$ declare n int; begin
  update public.proposals set title = 'pwned'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Beta tenant updated % Lumen proposals', n; end if;
end $$;

do $$ begin raise notice '074 proposals: ALL CHECKS PASSED'; end $$;
rollback;
