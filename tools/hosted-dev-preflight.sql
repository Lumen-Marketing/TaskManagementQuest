-- READ-ONLY inventory of the hosted DEV project (expected ref ydrekmghdbpkothhmbut).
-- Session is forced READ ONLY (autocommit, so one failed query — e.g. a missing
-- table — does not abort the rest): any write attempt errors. Prints counts and names
-- only — no user emails, no row contents, no secrets.
--   psql "$DEV_DB_URL" -X -f tools/hosted-dev-preflight.sql
set default_transaction_read_only = on;
\pset pager off
\echo '== 0. identity (expect prototype: work_items t, tasks f)'
select current_database() db, current_user usr, inet_server_addr() is not null as has_addr,
       to_regclass('public.work_items') is not null as work_items, to_regclass('public.tasks') is not null as tasks;
\echo '== 1. public tables (approx rows, writes since stats reset)'
select relname, n_live_tup rows_est, n_tup_ins ins, n_tup_upd upd, n_tup_del del from pg_stat_user_tables where schemaname='public' order by 1;
\echo '== 2. migration/schema state'
select to_regclass('supabase_migrations.schema_migrations') is not null as has_migrations_table;
select count(*) as applied_migrations, min(version) first_v, max(version) last_v from supabase_migrations.schema_migrations;
select proname from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by 1;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'auth.%';
select extname from pg_extension order by 1;
\echo '== 3. auth (counts only)'
select count(*) as auth_users, max(last_sign_in_at) as latest_sign_in, max(created_at) as latest_signup from auth.users;
select count(*) as sessions, max(updated_at) as latest_session_activity from auth.sessions;
\echo '== 4. storage'
select id as bucket, public from storage.buckets order by 1;
select bucket_id, count(*) objects from storage.objects group by 1 order by 1;
\echo '== 5. things that signal active use'
select count(*) as other_connections from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid();
select application_name, count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() group by 1 order by 2 desc;
select pubname, schemaname, tablename from pg_publication_tables where schemaname='public' order by 1,3;
select to_regclass('cron.job') is not null as has_cron;
select to_regclass('supabase_functions.hooks') is not null as has_webhook_table;
select stats_reset from pg_stat_database where datname=current_database();
\echo '== 6. size (is a pg_dump realistic?)'
select pg_size_pretty(pg_database_size(current_database())) as db_size;
