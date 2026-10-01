-- DEV-ONLY: assertions for 072 TASK 8 (handle_new_user + create_workspace roster entry).
-- Self-checking; one transaction; rolls back. Needs the auth users from
-- local_seed_auth_users.sql. Runs as the DB owner (the signup trigger is an auth-side
-- insert, not an RLS-bound caller).
begin;

create or replace function pg_temp.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(lower(fragment) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: expected "%" but got "%"', fragment, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: expected an error containing "%" but none was raised', fragment;
end $$;

-- 1. seeded identities took the right paths
do $$ begin
  if (select count(*) from public.profiles where id in
        ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003',
         'a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000006')
        and tenant_id = '00000000-0000-0000-0000-000000000000' and member_id is not null) <> 5 then
    raise exception 'FAIL A: tenant-scoped signups did not get tenant + member_id'; end if;
  if exists (select 1 from public.team_members where email = 'abraham@quest.test' and tenant_id is distinct from '00000000-0000-0000-0000-000000000000') then
    raise exception 'FAIL A: team_members row not in the tenant'; end if;
  if not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000005' and tenant_id is null and member_id is null) then
    raise exception 'FAIL B: tenant-less signup should be profile-only'; end if;
  if exists (select 1 from public.team_members where email = 'bob@quest.test') then
    raise exception 'FAIL B: tenant-less signup must NOT create a team_members row'; end if;
end $$;

-- 2. SECURITY: a forged user_metadata tenant is ignored
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-0000000000f1','forger@quest.test',
  '{"full_name":"Forger","tenant_id":"00000000-0000-0000-0000-000000000000"}');
do $$ begin
  if (select tenant_id from public.profiles where id='a0000000-0000-0000-0000-0000000000f1') is not null
     or exists (select 1 from public.team_members where email='forger@quest.test') then
    raise exception 'FAIL SECURITY: user_metadata.tenant_id was honoured'; end if;
end $$;

-- 3. malformed / unknown tenant aborts the signup (no silent fallback)
select pg_temp.expect_error($q$ insert into auth.users (id,email,raw_app_meta_data) values ('a0000000-0000-0000-0000-0000000000f2','bad@quest.test','{"tenant_id":"not-a-uuid"}') $q$, 'not a valid uuid');
select pg_temp.expect_error($q$ insert into auth.users (id,email,raw_app_meta_data) values ('a0000000-0000-0000-0000-0000000000f3','ghost@quest.test','{"tenant_id":"99999999-9999-9999-9999-999999999999"}') $q$, 'does not exist');
do $$ begin
  if exists (select 1 from public.profiles where email in ('bad@quest.test','ghost@quest.test')) then
    raise exception 'FAIL: a rejected signup left a profile behind'; end if;
end $$;

-- 4. cross-tenant slug collision: Beta's "abraham" must not adopt Lumen's roster row
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-00000000000b','Beta');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
 ('a0000000-0000-0000-0000-0000000000f4','abraham@beta.test','{"full_name":"Other Abraham"}','{"tenant_id":"00000000-0000-0000-0000-00000000000b"}');
do $$ declare m text; begin
  select member_id into m from public.profiles where id='a0000000-0000-0000-0000-0000000000f4';
  if m is null or m = 'abraham' then raise exception 'FAIL: slug collision adopted/clobbered (member_id=%)', m; end if;
  if (select tenant_id from public.team_members where id = 'abraham') is distinct from '00000000-0000-0000-0000-000000000000'
     or (select email from public.team_members where id = 'abraham') <> 'abraham@quest.test' then
    raise exception 'FAIL: Lumen''s abraham roster row was modified by another tenant''s signup'; end if;
  if (select tenant_id from public.team_members where id = m) <> '00000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: suffixed roster row not in Beta'; end if;
end $$;

-- 5. create_workspace gives the tenant-less user their roster entry, inside the new tenant
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000005"}', true);
create temp table _t (id uuid) on commit drop;
grant all on _t to authenticated;
insert into _t select public.create_workspace('Beta Roofing', 'Bob Beta');
reset role;
do $$ declare m text; t uuid; begin
  select id into t from _t;
  select member_id into m from public.profiles where id='a0000000-0000-0000-0000-000000000005';
  if m is null then raise exception 'FAIL: create_workspace left the new admin without a member_id'; end if;
  if (select tenant_id from public.team_members where id = m) is distinct from t then
    raise exception 'FAIL: roster entry not created in the new tenant'; end if;
  if (select tenant_id from public.profiles where id='a0000000-0000-0000-0000-000000000005') is distinct from t then
    raise exception 'FAIL: profile not moved into the new tenant'; end if;
end $$;

do $$ begin raise notice 'signup assertions: ALL CHECKS PASSED'; end $$;
rollback;
