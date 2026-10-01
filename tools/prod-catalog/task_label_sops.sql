-- READ-ONLY production catalog query: recover public.task_label_sops in ONE result.
-- Metadata only — it never selects from the table, so no row data is read.
-- Paste the single JSON cell back; it replaces the PROVISIONAL
-- supabase/sql/bootstrap/000b_dev_baseline_task_label_sops.sql.
--
-- IMPORTANT: "table_exists": false is itself a valid, useful answer — it would mean
-- migration 069 was never applied to production (the client tolerates that; see
-- SupabaseDataStore._optionalSelect), and 072 must then treat this table as OPTIONAL.
--
-- Run in the production SQL editor. Safe to run repeatedly.
select jsonb_pretty(jsonb_build_object(
  'table_exists', to_regclass('public.task_label_sops') is not null,
  'columns', (select jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity, 'generated', a.attgenerated)
        order by a.attnum)
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = to_regclass('public.task_label_sops') and a.attnum > 0 and not a.attisdropped),
  'constraints', (select jsonb_agg(jsonb_build_object('name', conname, 'type', contype,
        'def', pg_get_constraintdef(oid)) order by conname)
      from pg_constraint where conrelid = to_regclass('public.task_label_sops')),
  'indexes', (select jsonb_agg(indexdef order by indexname)
      from pg_indexes where schemaname = 'public' and tablename = 'task_label_sops'),
  'triggers', (select jsonb_agg(jsonb_build_object('name', tgname, 'def', pg_get_triggerdef(oid)) order by tgname)
      from pg_trigger where tgrelid = to_regclass('public.task_label_sops') and not tgisinternal),
  'trigger_functions', (select jsonb_agg(jsonb_build_object('fn', p.proname, 'def', pg_get_functiondef(p.oid)))
      from pg_proc p where p.oid in (select tgfoid from pg_trigger
        where tgrelid = to_regclass('public.task_label_sops') and not tgisinternal)),
  'rls', (select jsonb_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity)
      from pg_class where oid = to_regclass('public.task_label_sops')),
  'policies', (select jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'permissive', permissive,
        'roles', roles, 'using', qual, 'check', with_check) order by policyname)
      from pg_policies where schemaname = 'public' and tablename = 'task_label_sops'),
  'grants', (select jsonb_agg(jsonb_build_object('grantee', grantee, 'privilege', privilege_type)
        order by grantee, privilege_type)
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'task_label_sops'),
  -- Anything else that mentions the table by name (functions, views): names only.
  'referenced_by_functions', (select jsonb_agg(p.proname order by p.proname)
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and pg_get_functiondef(p.oid) ilike '%task_label_sops%'),
  'referenced_by_views', (select jsonb_agg(c.relname order by c.relname)
      from pg_class c where c.relkind in ('v','m') and c.relnamespace = 'public'::regnamespace
        and pg_get_viewdef(c.oid) ilike '%task_label_sops%'),
  -- Is migration 072 already applied? (production was confirmed NOT to have it.)
  'tenants_table_exists', to_regclass('public.tenants') is not null
)) as task_label_sops_schema;
