-- READ-ONLY production preflight for the 072 -> 073 -> 074 rollout.
-- Target must be qqvmcsvdxhgjooirznrj (PRODUCTION). Session forced read-only; prints names and counts
-- and policy definitions (no emails, no row contents, no secrets). Save the output: it is the BEFORE snapshot that every
-- later stage is compared against.
--   psql "$PROD_DB_URL" -X -f tools/prod-catalog/go-live-preflight.sql | tee ~/prod-before-$(date +%F).txt
\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';
\pset pager off
\echo '== 0. identity (expect QUEST HQ: tasks t, tenants f, work_items f)'
select current_database() db, version() pg,
       to_regclass('public.tasks') is not null tasks, to_regclass('public.tenants') is not null tenants_exists,
       to_regclass('public.work_items') is not null work_items,
       to_regclass('public.task_label_sops') is not null task_label_sops,
       to_regclass('public.underwritings') is not null underwritings, to_regclass('public.proposals') is not null proposals;
\echo '== 1. size + load (is a maintenance window needed?)'
select pg_size_pretty(pg_database_size(current_database())) db_size;
select relname, n_live_tup rows_est, pg_size_pretty(pg_total_relation_size(relid)) size from pg_stat_user_tables where schemaname='public' order by pg_total_relation_size(relid) desc;
select count(*) other_connections from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid();
select application_name, count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() group by 1 order by 2 desc;
\echo '== 2. EXACT row counts (the before/after fingerprint)'
select 'auth.users' t, count(*) n from auth.users
union all select 'profiles', count(*) from public.profiles
union all select 'team_members', count(*) from public.team_members
union all select 'companies', count(*) from public.companies
union all select 'projects', count(*) from public.projects
union all select 'tasks', count(*) from public.tasks
union all select 'task_comments', count(*) from public.task_comments
union all select 'time_entries', count(*) from public.time_entries
union all select 'notifications', count(*) from public.notifications
union all select 'wo_counters', count(*) from public.wo_counters;
\echo '== 3. what 072 needs: helper functions present?'
select proname from pg_proc where pronamespace='public'::regnamespace and proname in
  ('current_profile_role','current_member_id','current_company_ids','can_manage_roles','assign_wo_number','handle_new_user','slugify_member_id','assignee_in_company','stamp_tenant_id','current_tenant_id','create_workspace') order by 1;
\echo '== 4. the 20 tables 072 walls: which exist (task_label_sops expected ABSENT = fine)'
select t, to_regclass('public.'||t) is not null as exists_in_prod from unnest(array['profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules','time_entries','active_timers','notifications','reminder_log','task_types','task_type_statuses','task_labels','task_label_sops','bug_reports','checkin_settings','checkin_log','wo_counters']) t order by 2, 1;
\echo '== 5. signup trigger (029 may NOT have installed it: it only NOTICEs on insufficient privilege)'
select tgname, tgenabled, tgrelid::regclass, pg_get_triggerdef(oid) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;
select prosecdef as security_definer, (pg_get_functiondef(oid) like '%tenant%') as already_tenant_aware from pg_proc where proname='handle_new_user' and pronamespace='public'::regnamespace;
\echo '== 6. RLS policies on tasks today (072 TASK 5 rewrites these; compare full definitions with 051/046/041/044 + additive policies)'
select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='tasks' order by 1;
\echo '== 7. data shape 072 relies on'
select count(*) filter (where company_ids is null or cardinality(company_ids)=0) profiles_without_companies, count(*) filter (where member_id is null) profiles_without_member, count(*) filter (where role is null) profiles_without_role, count(*) filter (where approved) approved_profiles from public.profiles;
select role, count(*) from public.profiles group by 1 order by 1;
select count(*) tasks_with_unknown_company from public.tasks t where not exists (select 1 from public.companies c where c.id=t.company_id);
select count(*) tasks_unknown_type from public.tasks t where type is not null and type not in (select id from public.task_types) ;
select to_regclass('public.task_types') is not null as has_task_types;
\echo '== 8. drift flags'
select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='onboarded') as profiles_has_onboarded;
select extname from pg_extension order by 1;
\echo '== 9. app surface that must keep working: edge functions are NOT visible here -> run: supabase functions list --project-ref qqvmcsvdxhgjooirznrj'
\echo '== 10. auth settings that matter are dashboard-only: public signup on/off, email confirmation, site URL'

rollback;
