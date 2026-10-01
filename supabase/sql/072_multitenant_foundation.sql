-- 072: Multi-tenant isolation foundation.
--
-- Adds a TENANT boundary above the existing company model so two paying
-- businesses can never see or write each other's data. Every business-data
-- table gets a tenant_id; a single RESTRICTIVE RLS policy per table clamps ALL
-- access (current and future policies) to the caller's tenant via
-- current_tenant_id(). Existing Lumen data is backfilled into 'tenant 0'. A
-- create_workspace() RPC mints a new tenant + first admin + seeded taxonomy.
--
-- Design: docs/superpowers/specs/2026-07-21-multi-tenant-isolation-foundation-design.md
-- Plan:   docs/superpowers/plans/2026-07-21-multi-tenant-isolation-foundation.md
--
-- Idempotent; each phase is transaction-wrapped. RUN ON A DEV COPY FIRST and
-- pass supabase/sql/verify/072_isolation_check.sql before applying to PROD
-- (project qqvmcsvdxhgjooirznrj): this migration enforces NOT NULL across every
-- table and rewrites RLS, so a bad run can lock users out.
--
-- NOTE (task_watchers / task_subtasks / task_activity): migration 013 DROPPED these
-- three tables (their data moved into JSONB columns on tasks), so they are no longer
-- listed below. Every loop also skips any listed table that does not exist
-- (`to_regclass` guard), so the migration stays safe on a historical environment that
-- unexpectedly still has one of them — an existing leftover table would simply not be
-- walled, which is acceptable for a dead, unused table (drop it instead).
--
-- The scoped-table array below is the single source of truth reused by every
-- loop. profiles is handled specially (excluded from the auto-stamp trigger:
-- a signing-up user has no tenant yet — create_workspace()/invites set it).

------------------------------------------------------------------------
-- TASK 0: prerequisites. Fail LOUDLY, before anything is changed, if a table this
-- migration must wall is missing (e.g. a skipped earlier migration). The per-loop
-- `to_regclass` guards below exist only for legacy tables; they must never be able
-- to hide a missing REQUIRED table.
------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception '072 prerequisite missing: public.% does not exist — apply the migration that creates it first', t;
    end if;
  end loop;
end $$;

------------------------------------------------------------------------
-- TASK 1: tenants table, tenant_id columns (nullable), current_tenant_id().
------------------------------------------------------------------------
begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;

-- NULLABLE tenant_id everywhere; Task 2 backfills before Task 4 enforces NOT NULL.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '072: skipping absent table public.%', t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)', t);
    execute format('create index if not exists %I on public.%I(tenant_id)', t||'_tenant_idx', t);
  end loop;
end $$;

create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select (select p.tenant_id from public.profiles p where p.id = auth.uid());
$$;

revoke all on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;

commit;

-- Verify Task 1:
--   select count(*) from information_schema.columns
--     where table_schema='public' and column_name='tenant_id';   -- = scoped-table count
--   select public.current_tenant_id();                            -- NULL when unauthenticated

------------------------------------------------------------------------
-- TASK 2: Backfill all existing data into Lumen (tenant 0).
-- Deterministic id so re-runs are idempotent.
------------------------------------------------------------------------
begin;

insert into public.tenants (id, name, status)
values ('00000000-0000-0000-0000-000000000000', 'Lumen', 'active')
on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '072: skipping absent table public.%', t;
      continue;
    end if;
    execute format(
      'update public.%I set tenant_id = ''00000000-0000-0000-0000-000000000000'' where tenant_id is null', t);
  end loop;
end $$;

commit;

-- Verify Task 2 (every scoped table must return 0):
--   select 'tasks', count(*) from public.tasks where tenant_id is null
--   union all select 'profiles', count(*) from public.profiles where tenant_id is null
--   union all select 'companies', count(*) from public.companies where tenant_id is null;
--   -- ...extend to all scoped tables.

------------------------------------------------------------------------
-- TASK 3: Auto-stamp tenant_id on INSERT so no code can forget it.
-- Rejects an explicit attempt to write into a foreign tenant.
-- profiles is excluded (set by create_workspace()/invite flow instead).
------------------------------------------------------------------------
begin;

create or replace function public.stamp_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  elsif new.tenant_id <> public.current_tenant_id() then
    raise exception 'tenant_id % does not match caller tenant %',
      new.tenant_id, public.current_tenant_id();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'companies','team_members','tasks','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '072: skipping absent table public.%', t;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', 'stamp_tenant_'||t, t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.stamp_tenant_id()',
      'stamp_tenant_'||t, t);
  end loop;
end $$;

commit;

-- Verify Task 3 (one row per scoped table, excluding profiles/tenants):
--   select tgrelid::regclass as tbl, tgname from pg_trigger
--     where tgname like 'stamp_tenant_%' order by 1;

------------------------------------------------------------------------
-- TASK 5 (part a): shared-bucket marker, added BEFORE the wall/policies
-- reference it. Convert the legacy global 'general-shift' task to a marker.
------------------------------------------------------------------------
begin;

alter table public.tasks add column if not exists is_shared_bucket boolean not null default false;
update public.tasks set is_shared_bucket = true where id = 'general-shift';

commit;

------------------------------------------------------------------------
-- TASK 4: THE WALL. Enforce NOT NULL + one RESTRICTIVE tenant policy per
-- table. A restrictive policy is ANDed with every permissive policy, so this
-- clamps all current and future access to the caller's tenant in one place.
------------------------------------------------------------------------
begin;

-- profiles is DELIBERATELY excluded here: a freshly signed-up user has a
-- profile row (created by handle_new_user) BEFORE they have a tenant, so
-- profiles.tenant_id must stay NULLABLE and its wall must let a user reach
-- their OWN row for bootstrap. Handled separately just below.
do $$
declare t text;
begin
  foreach t in array array[
    'companies','team_members','tasks','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '072: skipping absent table public.%', t;
      continue;
    end if;
    execute format('alter table public.%I alter column tenant_id set not null', t);

    execute format('drop policy if exists %I on public.%I', 'tenant_isolation_'||t, t);
    execute format($f$
      create policy %I on public.%I
      as restrictive for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, 'tenant_isolation_'||t, t);
  end loop;
end $$;

-- profiles: tenant_id stays NULLABLE (pre-tenant signup state). The wall
-- confines a user to their own tenant's profiles PLUS their own row, so a
-- tenantless brand-new user can still read/update themselves to bootstrap
-- (and never sees any other tenant's people). A row with tenant_id NULL is
-- reachable only by its owner (id = auth.uid()).
drop policy if exists tenant_isolation_profiles on public.profiles;
create policy tenant_isolation_profiles on public.profiles
  as restrictive for all to authenticated
  using (id = auth.uid() or tenant_id = public.current_tenant_id())
  with check (id = auth.uid() or tenant_id = public.current_tenant_id());

commit;

-- Verify Task 4 (one row per scoped table, permissive = 'RESTRICTIVE'):
--   select tablename, policyname, permissive from pg_policies
--     where policyname like 'tenant_isolation_%' order by tablename;

------------------------------------------------------------------------
-- TASK 5 (part b): rewrite the four tasks policies from migration 028 to
-- match the shared bucket by MARKER (is_shared_bucket) instead of the literal
-- id 'general-shift'. The restrictive wall (Task 4) already scopes the row to
-- the caller's own tenant, so each tenant sees only its own bucket.
-- Reproduced verbatim from 028 lines 78-191 with `id = 'general-shift'`
-- replaced by `is_shared_bucket` (SELECT + UPDATE only; INSERT/DELETE never
-- referenced general-shift and are recreated unchanged for completeness).
------------------------------------------------------------------------
begin;

drop policy if exists "role users can read tasks"   on public.tasks;
drop policy if exists "role users can insert tasks"  on public.tasks;
drop policy if exists "role users can update tasks"  on public.tasks;
drop policy if exists "role users can delete tasks"  on public.tasks;

-- SELECT
create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or is_shared_bucket)
      )
    )
  )
);

-- INSERT (workers allowed, scoped to their companies)
create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'worker', 'construction_supervisor', 'sales')
  )
);

-- UPDATE
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or is_shared_bucket)
      )
    )
  )
)
with check (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and p.supervisor_id = public.current_member_id()
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or is_shared_bucket)
      )
    )
  )
);

-- DELETE (management roles, in-company)
create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    company_id = any(public.current_company_ids())
    and public.current_profile_role() in
      ('admin', 'supervisor', 'construction_supervisor', 'sales')
  )
);

commit;

-- Verify Task 5:
--   select id, is_shared_bucket, tenant_id from public.tasks where is_shared_bucket;

------------------------------------------------------------------------
-- TASK 6: developer role note.
-- The restrictive tenant_isolation_* policies have NO developer bypass, so a
-- developer is clamped to their own tenant like everyone else. The existing
-- role='developer' branches (028/056/tasks policies above) only widen COMPANY
-- visibility WITHIN a tenant and are therefore safe. Cross-tenant support
-- access is via the Supabase service role (out of band), never an in-app
-- login. No policy change is required for isolation.
------------------------------------------------------------------------

------------------------------------------------------------------------
-- TASK 7: create_workspace() — mint tenant + first admin + seed taxonomy.
-- Called by an already-authenticated brand-new user whose profiles.tenant_id
-- is still NULL (e.g. right after Supabase Auth sign-up).
------------------------------------------------------------------------
begin;

create or replace function public.create_workspace(business_name text, full_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_tenant uuid;
  new_company text;
  v_email text;
  v_base text;
  v_member text;
  v_full text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  -- One account, one business: a user who already has a tenant cannot create another.
  if (select tenant_id from public.profiles where id = auth.uid()) is not null then
    raise exception 'account already belongs to a workspace';
  end if;

  insert into public.tenants (name) values (business_name) returning id into new_tenant;

  -- Namespaced, globally-unique company id so tenants never collide on slugs.
  new_company := 'co_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.companies (id, label, pill, tenant_id)
  values (new_company, business_name, 'pill-lumen', new_tenant);

  -- Per-tenant 'overall' (spans-all-companies WITHIN this tenant).
  insert into public.companies (id, label, pill, tenant_id)
  values ('overall_' || replace(new_tenant::text, '-', ''), 'Overall', 'pill-lumen', new_tenant);

  -- Promote the caller to first admin of the new tenant.
  update public.profiles
     set tenant_id   = new_tenant,
         role        = 'admin',
         approved    = true,
         company_ids = array[new_company],
         full_name   = coalesce(nullif(create_workspace.full_name, ''), public.profiles.full_name)
   where id = auth.uid();

  -- A tenant-less signup (handle_new_user, TASK 8) created the profile ONLY — no
  -- team_members row. Create the new admin's roster entry here, inside the new tenant,
  -- with the same slug + collision rules handle_new_user uses.
  select p.email, p.full_name into v_email, v_full from public.profiles p where p.id = auth.uid();
  if (select member_id from public.profiles where id = auth.uid()) is null then
    v_base := coalesce(nullif(public.slugify_member_id(split_part(v_email, '@', 1)), ''),
                       'member-' || left(auth.uid()::text, 8));
    v_member := v_base;
    if exists (select 1 from public.profiles p where p.member_id = v_base and p.id <> auth.uid())
       or exists (select 1 from public.team_members t where t.id = v_base) then
      v_member := v_base || '-' || left(auth.uid()::text, 8);
    end if;
    insert into public.team_members (id, name, full_name, email, color, tenant_id)
    values (v_member, split_part(coalesce(v_full, v_base), ' ', 1), coalesce(v_full, v_base),
            v_email, '#' || substr(md5(coalesce(v_email, v_member)), 1, 6), new_tenant);
    update public.profiles set member_id = v_member where id = auth.uid();
  end if;

  -- Seed a minimal default taxonomy (Working on it -> Done) for the default company.
  insert into public.task_types (company_id, key, label, sort_order, tenant_id)
  values (new_company, 'general', 'General', 0, new_tenant);
  insert into public.task_type_statuses
    (company_id, type_key, key, label, sort_order, is_default, is_done, tenant_id)
  values
    (new_company, 'general', 'todo', 'Working on it', 0, true,  false, new_tenant),
    (new_company, 'general', 'done', 'Done',          1, false, true,  new_tenant);

  return new_tenant;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

commit;

-- Verify Task 7: exercised by supabase/sql/verify/072_isolation_check.sql
-- (a fresh user creates tenant B via this RPC, then isolation is asserted).

------------------------------------------------------------------------
-- TASK 8: handle_new_user() must work once tenant_id is NOT NULL.
--
-- Migration 029/033's signup trigger inserted a team_members row with no tenant. With
-- team_members.tenant_id NOT NULL (TASK 4) that insert aborts the whole auth signup.
-- It also ran for tenant-less signups that have no business to join yet.
--
-- New behaviour (supersedes 033's definition):
--   A. raw_app_meta_data->>'tenant_id' present -> profile AND team_members row are
--      created inside that tenant (the admin "create-user" flow sets it).
--   B. absent -> profile ONLY (tenant_id NULL, member_id NULL, no team_members row).
--      create_workspace() (TASK 7) creates the roster entry when they make a business.
--
-- SECURITY: the tenant is read ONLY from raw_APP_meta_data, which only the service
-- role / Auth admin API can write. raw_USER_meta_data is attacker-controlled
-- (supabase.auth.signUp({options:{data:...}})) and is NEVER used to choose a tenant.
-- A malformed or non-existent tenant id RAISES (failing the signup) rather than
-- silently falling back to "no tenant".
--
-- team_members.id is a GLOBAL text key, so a slug that already belongs to another
-- tenant's roster entry (or another profile) gets a uuid suffix instead of being
-- adopted; the conflict-update only ever touches a row of the SAME tenant.
------------------------------------------------------------------------
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_raw text := nullif(btrim(new.raw_app_meta_data ->> 'tenant_id'), '');
  v_tenant uuid;
  v_base text := coalesce(
    nullif(public.slugify_member_id(split_part(new.email, '@', 1)), ''),
    'member-' || left(new.id::text, 8)
  );
  v_member_id text := v_base;
  v_full_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );
begin
  if v_tenant_raw is not null then
    begin
      v_tenant := v_tenant_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'handle_new_user: app_metadata.tenant_id is not a valid uuid: %', v_tenant_raw;
    end;
    if not exists (select 1 from public.tenants where id = v_tenant) then
      raise exception 'handle_new_user: tenant % does not exist', v_tenant;
    end if;
  end if;

  -- B. No tenant: profile only. Never trust user_metadata for this.
  if v_tenant is null then
    insert into public.profiles (id, email, full_name, approved, role, email_verified)
    values (new.id, new.email, v_full_name, false, 'worker', false)
    on conflict (id) do update set
      email = excluded.email,
      full_name = excluded.full_name;
    return new;
  end if;

  -- A. Tenant-scoped signup. Collision-proof member id (global key).
  if exists (select 1 from public.profiles p where p.member_id = v_base and p.id <> new.id)
     or exists (select 1 from public.team_members t where t.id = v_base and t.tenant_id is distinct from v_tenant) then
    v_member_id := v_base || '-' || left(new.id::text, 8);
  end if;

  insert into public.team_members (id, name, full_name, email, color, tenant_id)
  values (v_member_id, split_part(v_full_name, ' ', 1), v_full_name, new.email,
          '#' || substr(md5(new.email), 1, 6), v_tenant)
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email
  where public.team_members.tenant_id = excluded.tenant_id;

  insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id, tenant_id)
  values (new.id, new.email, v_full_name, false, 'worker', false, v_member_id, v_tenant)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    member_id = excluded.member_id,
    tenant_id = coalesce(public.profiles.tenant_id, excluded.tenant_id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

commit;

-- Verify Task 8: tools/dev-rehearse.sh creates users through BOTH paths (with and
-- without app_metadata.tenant_id) and asserts the results, a forged user_metadata
-- tenant is ignored, and a malformed / unknown tenant id aborts the signup.
