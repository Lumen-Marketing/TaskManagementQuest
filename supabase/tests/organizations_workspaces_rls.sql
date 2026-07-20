-- Run after 20260721063000_organizations_workspaces_foundation.sql on an
-- isolated Supabase branch or staging project. This script is read-only and
-- transaction-wrapped; any failed assertion aborts with a descriptive error.

begin;

do $$
declare
  tenant_table text;
  expected_table text;
  expected_policy text;
  missing_count bigint;
begin
  foreach tenant_table in array array[
    'organizations',
    'organization_memberships',
    'workspaces',
    'workspace_memberships',
    'legacy_company_workspace_map'
  ] loop
    if to_regclass(format('public.%I', tenant_table)) is null then
      raise exception 'missing tenant table: public.%', tenant_table;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tenant_table
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', tenant_table;
    end if;

    if has_table_privilege('anon', format('public.%I', tenant_table), 'SELECT')
       or has_table_privilege('anon', format('public.%I', tenant_table), 'INSERT')
       or has_table_privilege('anon', format('public.%I', tenant_table), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', tenant_table), 'DELETE') then
      raise exception 'anon unexpectedly has privileges on public.%', tenant_table;
    end if;
  end loop;

  for expected_table, expected_policy in
    select *
    from (values
      ('organizations', 'organizations_select'),
      ('organization_memberships', 'organization_memberships_select'),
      ('organization_memberships', 'organization_memberships_insert'),
      ('organization_memberships', 'organization_memberships_update'),
      ('organization_memberships', 'organization_memberships_delete'),
      ('workspaces', 'workspaces_select'),
      ('workspaces', 'workspaces_insert'),
      ('workspaces', 'workspaces_update'),
      ('workspaces', 'workspaces_delete'),
      ('workspace_memberships', 'workspace_memberships_select'),
      ('workspace_memberships', 'workspace_memberships_insert'),
      ('workspace_memberships', 'workspace_memberships_update'),
      ('workspace_memberships', 'workspace_memberships_delete'),
      ('legacy_company_workspace_map', 'legacy_company_workspace_map_select')
    ) as required_policies(table_name, policy_name)
  loop
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected_table
        and p.policyname = expected_policy
        and 'authenticated' = any(p.roles)
    ) then
      raise exception 'missing authenticated policy %.%', expected_table, expected_policy;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.organizations', 'SELECT')
     or has_table_privilege('authenticated', 'public.organizations', 'INSERT')
     or has_table_privilege('authenticated', 'public.organizations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.organizations', 'DELETE') then
    raise exception 'organization Data API grants are broader or narrower than expected';
  end if;

  foreach tenant_table in array array[
    'organization_memberships',
    'workspaces',
    'workspace_memberships'
  ] loop
    if not has_table_privilege('authenticated', format('public.%I', tenant_table), 'SELECT')
       or not has_table_privilege('authenticated', format('public.%I', tenant_table), 'INSERT')
       or not has_table_privilege('authenticated', format('public.%I', tenant_table), 'UPDATE')
       or not has_table_privilege('authenticated', format('public.%I', tenant_table), 'DELETE') then
      raise exception 'authenticated CRUD grants are incomplete on public.%', tenant_table;
    end if;
  end loop;

  if not has_table_privilege(
    'authenticated',
    'public.legacy_company_workspace_map',
    'SELECT'
  )
     or has_table_privilege(
       'authenticated',
       'public.legacy_company_workspace_map',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.legacy_company_workspace_map',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.legacy_company_workspace_map',
       'DELETE'
     ) then
    raise exception 'legacy mapping Data API grants are broader or narrower than expected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'company_ids'
  ) then
    raise exception 'legacy profiles.company_ids was removed';
  end if;

  foreach tenant_table in array array[
    'tasks',
    'projects',
    'task_types',
    'task_type_statuses',
    'task_labels'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tenant_table
        and column_name = 'company_id'
    ) then
      raise exception 'legacy public.%.company_id was removed', tenant_table;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tenant_table
        and column_name = 'organization_id'
    ) or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tenant_table
        and column_name = 'workspace_id'
    ) then
      raise exception 'tenant ownership columns are incomplete on public.%', tenant_table;
    end if;
  end loop;

  if exists (
    select 1
    from public.workspaces w
    where w.slug = 'overall'
  ) or exists (
    select 1
    from public.legacy_company_workspace_map m
    where m.company_id = 'overall'
  ) then
    raise exception 'Overall must remain an organization-wide view, not a workspace';
  end if;

  select count(*) into missing_count
  from public.tasks
  where company_id <> 'overall'
    and (organization_id is null or workspace_id is null);
  if missing_count <> 0 then
    raise exception 'unmapped task rows: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.projects
  where company_id <> 'overall'
    and (organization_id is null or workspace_id is null);
  if missing_count <> 0 then
    raise exception 'unmapped project rows: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.task_types
  where company_id <> 'overall'
    and (organization_id is null or workspace_id is null);
  if missing_count <> 0 then
    raise exception 'unmapped task type rows: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.task_type_statuses
  where company_id <> 'overall'
    and (organization_id is null or workspace_id is null);
  if missing_count <> 0 then
    raise exception 'unmapped task type status rows: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.task_labels
  where company_id <> 'overall'
    and (organization_id is null or workspace_id is null);
  if missing_count <> 0 then
    raise exception 'unmapped task label rows: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.organizations o
  where not exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = o.id
      and om.user_id = o.owner_user_id
      and om.role = 'owner'
      and om.status = 'active'
  );
  if missing_count <> 0 then
    raise exception 'organizations without an active owner membership: %', missing_count;
  end if;

  select count(*) into missing_count
  from public.workspace_memberships wm
  join public.workspaces w on w.id = wm.workspace_id
  where not exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = w.organization_id
      and om.user_id = wm.user_id
      and om.status = 'active'
  );
  if missing_count <> 0 then
    raise exception 'workspace memberships without active organization membership: %', missing_count;
  end if;
end;
$$;

rollback;
