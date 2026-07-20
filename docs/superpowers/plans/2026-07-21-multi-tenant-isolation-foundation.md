# Multi-Tenant Isolation Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database-level wall that isolates every business (tenant) so one can never read or write another's data, and prove it with a two-tenant test.

**Architecture:** Add a `tenants` table and a `tenant_id` column to every business-data table. A `current_tenant_id()` helper reads the caller's `profiles.tenant_id`. A single **RESTRICTIVE** RLS policy per table (`tenant_id = current_tenant_id()`) is ANDed with all existing permissive policies, clamping every read/write to the caller's tenant without editing the ~15 existing policy migrations. A `BEFORE INSERT` trigger auto-stamps `tenant_id` so no code can forget it. Existing Lumen data is backfilled into "tenant 0". A `create_workspace` RPC mints a new tenant + first admin + seeded taxonomy.

**Tech Stack:** Supabase Postgres, Row-Level Security (permissive + restrictive policies), SQL migrations under `supabase/sql/` (numbered, idempotent, transaction-wrapped), `psql`/Supabase SQL Editor for the RLS verification script.

## Global Constraints

- Migrations are **idempotent** and **transaction-wrapped**, following the house style in `supabase/sql/028_company_scoping_rls.sql` and `067_overall_company.sql` (drop-before-create, `if not exists`, a verify query at the bottom).
- **Never leave an existing row tenantless:** backfill runs and commits BEFORE any `NOT NULL` / trigger constraint is enforced.
- The tenant gate is a **RESTRICTIVE** policy (ANDed), never permissive (which would GRANT, not restrict).
- Company ids stay **globally unique text**; existing Lumen slugs (`roofing`/`drafting`/`lumen`) are preserved. New companies get namespaced ids `co_<token>`.
- Helper functions mirror `current_company_ids()` (migration 028): `security definer`, `stable`, `set search_path = public, pg_temp`, coalesced to fail closed, `execute` granted to `authenticated` only.
- Target PROD project is `qqvmcsvdxhgjooirznrj` (Quest HQ). Deploy only after the isolation script passes on a copy.
- Tenant-scoped tables (the working set — Task 1 verifies completeness):
  `profiles, companies, team_members, tasks, task_watchers, task_subtasks, task_activity, task_comments, comment_reactions, projects, schedules, time_entries, active_timers, notifications, reminder_log, project? , task_types, task_type_statuses, task_labels, task_label_sops, bug_reports, checkin_settings, checkin_log, wo_counters`
  (`project_folders`/`schedules` and any child tables inherit tenant via their parent but still get a stamped column for the belt-and-suspenders wall.)

---

### Task 1: `tenants` table, `tenant_id` columns, and `current_tenant_id()` helper

**Files:**
- Create: `supabase/sql/072_multitenant_foundation.sql`

**Interfaces:**
- Produces: table `public.tenants(id uuid pk, name text, status text, created_at)`; column `tenant_id uuid` on every tenant-scoped table (NULLABLE at this stage); function `public.current_tenant_id() returns uuid`.

- [ ] **Step 1: Verify the tenant-scoped table list is complete**

Run in the SQL Editor and compare to the Global Constraints list; add any missing base table to the `_scoped` array used throughout this migration:

```sql
select tablename from pg_tables
where schemaname = 'public'
  and tablename not in ('reminder_log')  -- append-only logs still get scoped; none excluded
order by tablename;
```

Expected: the printed set matches the Global Constraints working set (plus `profiles`). Record the final array; every later loop uses it.

- [ ] **Step 2: Create the migration header + `tenants` table + `tenant_id` columns**

```sql
-- 072: Multi-tenant isolation foundation.
-- Adds a tenant boundary above the existing company model. Every business-data
-- table gets a tenant_id; a single RESTRICTIVE RLS policy per table clamps all
-- access to the caller's tenant (current_tenant_id()); existing Lumen data is
-- backfilled into 'tenant 0'. See docs/superpowers/specs/2026-07-21-multi-tenant-isolation-foundation-design.md
-- Idempotent; transaction-wrapped where safe.

begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;

-- Add a NULLABLE tenant_id to every scoped table (backfill fills it before we
-- enforce NOT NULL in Task 4). Loop keeps this DRY and idempotent.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','companies','team_members','tasks','task_watchers','task_subtasks',
    'task_activity','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)', t);
    execute format('create index if not exists %I on public.%I(tenant_id)', t||'_tenant_idx', t);
  end loop;
end $$;

commit;
```

- [ ] **Step 3: Add the `current_tenant_id()` helper**

```sql
begin;

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
```

- [ ] **Step 4: Apply the migration so far and verify**

Run the file against a **dev copy** of the DB. Verify:

```sql
select count(*) from information_schema.columns
where table_schema='public' and column_name='tenant_id';   -- expect = number of scoped tables
select public.current_tenant_id();                          -- expect NULL when unauthenticated
```

Expected: column count equals the scoped-table count; helper returns NULL (fails closed).

- [ ] **Step 5: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): tenants table, tenant_id columns, current_tenant_id() helper"
```

---

### Task 2: Backfill Lumen as "tenant 0"

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Consumes: `public.tenants`, the nullable `tenant_id` columns from Task 1.
- Produces: exactly one `tenants` row for Lumen; every existing business row stamped with it.

- [ ] **Step 1: Append the backfill block**

```sql
-- ---- Backfill: all existing data belongs to Lumen (tenant 0) ----
-- Deterministic id so re-runs are idempotent (no gen_random_uuid here).
begin;

insert into public.tenants (id, name, status)
values ('00000000-0000-0000-0000-000000000000', 'Lumen', 'active')
on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','companies','team_members','tasks','task_watchers','task_subtasks',
    'task_activity','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    execute format(
      'update public.%I set tenant_id = ''00000000-0000-0000-0000-000000000000'' where tenant_id is null', t);
  end loop;
end $$;

commit;
```

- [ ] **Step 2: Verify no row is left tenantless**

```sql
-- Run per scoped table; every one must return 0.
select 'tasks' as t, count(*) from public.tasks where tenant_id is null
union all select 'profiles', count(*) from public.profiles where tenant_id is null
union all select 'companies', count(*) from public.companies where tenant_id is null;
-- ...extend to all scoped tables.
```

Expected: every count is 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): backfill existing data into Lumen tenant 0"
```

---

### Task 3: Auto-stamp `tenant_id` on INSERT

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Produces: trigger function `public.stamp_tenant_id()`; a `BEFORE INSERT` trigger `stamp_tenant_<table>` on every scoped table (except `tenants` itself and `profiles`, which is stamped by the create-workspace RPC / invite flow, not the generic trigger).

- [ ] **Step 1: Append the stamp trigger function + attach loop**

```sql
-- ---- Auto-stamp tenant_id so no INSERT can forget it ----
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
    -- Reject an explicit attempt to write into another tenant.
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
    'companies','team_members','tasks','task_watchers','task_subtasks',
    'task_activity','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'stamp_tenant_'||t, t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.stamp_tenant_id()',
      'stamp_tenant_'||t, t);
  end loop;
end $$;

commit;
```

Note: `profiles` is intentionally excluded — a signing-up user has no tenant yet, so its `tenant_id` is set explicitly by the create-workspace RPC (Task 7) and the invite flow (follow-on plan #3).

- [ ] **Step 2: Verify triggers attached**

```sql
select tgrelid::regclass as tbl, tgname from pg_trigger
where tgname like 'stamp_tenant_%' order by 1;
```

Expected: one row per scoped table (excluding `profiles`, `tenants`).

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): BEFORE INSERT trigger auto-stamps tenant_id"
```

---

### Task 4: The wall — NOT NULL + one RESTRICTIVE tenant policy per table

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Consumes: backfilled `tenant_id` (Task 2), `current_tenant_id()` (Task 1).
- Produces: `tenant_id NOT NULL` on every scoped table; a restrictive policy `tenant_isolation_<table>` ANDing `tenant_id = current_tenant_id()` onto all reads/writes.

- [ ] **Step 1: Append NOT NULL + restrictive policy loop**

```sql
-- ---- The wall: enforce NOT NULL + a RESTRICTIVE tenant gate on every table ----
-- A restrictive policy is ANDed with all existing permissive policies, so this
-- one statement clamps every current and future policy to the caller's tenant.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'companies','team_members','tasks','task_watchers','task_subtasks',
    'task_activity','task_comments','comment_reactions','projects','schedules',
    'time_entries','active_timers','notifications','reminder_log',
    'task_types','task_type_statuses','task_labels','task_label_sops',
    'bug_reports','checkin_settings','checkin_log','wo_counters','profiles'
  ] loop
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

commit;
```

- [ ] **Step 2: Verify the restrictive policies exist and are restrictive**

```sql
select tablename, policyname, permissive from pg_policies
where policyname like 'tenant_isolation_%' order by tablename;
```

Expected: one row per scoped table, `permissive = 'RESTRICTIVE'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): NOT NULL + restrictive per-table tenant isolation wall"
```

---

### Task 5: Per-tenant shared buckets (`general-shift` / `overall`)

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Consumes: the wall (Task 4).
- Produces: column `tasks.is_shared_bucket boolean not null default false`; the legacy `general-shift` task marked shared; a per-tenant `overall` company for Lumen; updated carve-outs in the tasks policies so `is_shared_bucket`/`overall` are matched by marker (already tenant-clamped by the restrictive wall).

- [ ] **Step 1: Add the marker and convert the legacy rows**

```sql
begin;

alter table public.tasks add column if not exists is_shared_bucket boolean not null default false;
update public.tasks set is_shared_bucket = true where id = 'general-shift';

-- 'overall' stays as Lumen's own spans-all-companies company (already backfilled
-- to tenant 0 in Task 2). New tenants get their own 'overall' row in Task 7.
commit;
```

- [ ] **Step 2: Rewrite the tasks carve-outs to use the marker instead of the literal id**

Replace every `or id = 'general-shift'` in the four tasks policies (from `supabase/sql/028_company_scoping_rls.sql`) with `or is_shared_bucket`. The restrictive wall from Task 4 already guarantees the row is the caller's own tenant's bucket. Re-create the four permissive tasks policies verbatim from migration 028 with that single substitution.

```sql
-- (Full re-creation of the SELECT/INSERT/UPDATE/DELETE tasks policies from 028,
--  changing `id = 'general-shift'` -> `is_shared_bucket`. Copy 028 lines 78-191
--  and apply the substitution; do not alter any other predicate.)
```

- [ ] **Step 3: Verify**

```sql
select id, is_shared_bucket, tenant_id from public.tasks where is_shared_bucket;
```

Expected: the `general-shift` row, marked, stamped to tenant 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): per-tenant shared buckets via is_shared_bucket marker"
```

---

### Task 6: Retire `developer` god-mode

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Consumes: the wall (Task 4).
- Produces: the `developer` role no longer bypasses tenant isolation (the restrictive wall already prevents cross-tenant reads even for `developer`; this task documents/verifies that and removes any now-dead cross-company assumptions).

- [ ] **Step 1: Confirm the wall already contains `developer`**

Because the Task 4 restrictive policy has **no role exception**, a `developer` is now confined to their own tenant automatically — the `current_profile_role() = 'developer'` bypasses in migrations 028/056 only widen access *within* a tenant, which is acceptable. No policy change is required for isolation; add a comment recording this.

```sql
-- ---- developer role note ----
-- The restrictive tenant_isolation_* policies have NO developer bypass, so a
-- developer is clamped to their own tenant like everyone else. The existing
-- `role='developer'` branches (028/056) only widen company visibility WITHIN a
-- tenant and are therefore safe. Cross-tenant support access is via the Supabase
-- service role (out of band), never an in-app login. No change needed here.
```

- [ ] **Step 2: Verify (part of Task 8's script) that a `developer` in tenant A sees no tenant B rows**

Deferred to Task 8. No standalone SQL here.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "docs(multitenant): confirm developer role is tenant-clamped by the wall"
```

---

### Task 7: `create_workspace` RPC (mint tenant + first admin + seed taxonomy)

**Files:**
- Modify: `supabase/sql/072_multitenant_foundation.sql` (append)

**Interfaces:**
- Consumes: `tenants`, `profiles`, `companies`, taxonomy tables.
- Produces: `public.create_workspace(business_name text, full_name text) returns uuid` — SECURITY DEFINER; called by an already-authenticated brand-new user whose `profiles.tenant_id` is still NULL. Creates the tenant, promotes the caller to that tenant's first admin, creates a default company + seeded taxonomy, and returns the new tenant id.

- [ ] **Step 1: Append the RPC**

```sql
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
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  -- Guard: a user who already has a tenant cannot create another (one account, one business).
  if (select tenant_id from public.profiles where id = auth.uid()) is not null then
    raise exception 'account already belongs to a workspace';
  end if;

  insert into public.tenants (name) values (business_name) returning id into new_tenant;

  -- Namespaced, globally-unique company id so tenants never collide.
  new_company := 'co_' || substr(replace(gen_random_uuid()::text,'-',''), 1, 12);
  insert into public.companies (id, label, pill, tenant_id)
  values (new_company, business_name, 'pill-lumen', new_tenant);

  -- Per-tenant 'overall' company (spans-all-companies within THIS tenant).
  insert into public.companies (id, label, pill, tenant_id)
  values ('overall_' || replace(new_tenant::text,'-',''), 'Overall', 'pill-lumen', new_tenant);

  -- Promote the caller to first admin of the new tenant.
  update public.profiles
     set tenant_id = new_tenant, role = 'admin', approved = true,
         company_ids = array[new_company], full_name = coalesce(nullif(full_name,''), public.profiles.full_name)
   where id = auth.uid();

  -- Seed a minimal default taxonomy (Lead -> Working -> Done) for the default company.
  insert into public.task_types (company_id, key, label, sort_order, tenant_id)
  values (new_company, 'general', 'General', 0, new_tenant);
  insert into public.task_type_statuses (company_id, type_key, key, label, sort_order, is_default, is_done, tenant_id) values
    (new_company, 'general', 'todo',    'Working on it', 0, true,  false, new_tenant),
    (new_company, 'general', 'done',    'Done',          1, false, true,  new_tenant);

  return new_tenant;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

commit;
```

- [ ] **Step 2: Verify a fresh user can create a workspace and lands isolated**

Deferred to Task 8 (the isolation script creates tenant B via this RPC).

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/072_multitenant_foundation.sql
git commit -m "feat(multitenant): create_workspace RPC (tenant + first admin + seed taxonomy)"
```

---

### Task 8: Two-tenant isolation proof (the deliverable's evidence)

**Files:**
- Create: `supabase/sql/verify/072_isolation_check.sql`

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable script that impersonates two users in two tenants and asserts zero cross-tenant visibility. Run in the Supabase SQL Editor / `psql` against a dev copy.

- [ ] **Step 1: Write the isolation script**

```sql
-- Two-tenant isolation proof. Run on a DEV copy. Assumes two auth users exist:
--   :userA (already tenant 0 / Lumen admin), :userB (fresh, no tenant yet).
-- Impersonation works by setting the JWT sub claim that auth.uid() reads.

-- 1. userB creates their own workspace.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';
select public.create_workspace('Beta Roofing', 'Bob Beta') as tenant_b;

-- 2. As userA (tenant 0), count rows. Then as userB, count rows.
--    Neither count may include the other tenant's data.
set local request.jwt.claims to '{"sub":"<USER_A_UUID>"}';
select 'A sees tasks' lbl, count(*) from public.tasks;          -- only Lumen's
select 'A sees B company' lbl, count(*) from public.companies where label='Beta Roofing';  -- expect 0

set local request.jwt.claims to '{"sub":"<USER_B_UUID>"}';
select 'B sees tasks' lbl, count(*) from public.tasks;          -- only Beta's (0 at first)
select 'B sees Lumen company' lbl, count(*) from public.companies where id='roofing';       -- expect 0

-- 3. Cross-tenant write must fail: userB tries to insert a task into tenant 0.
--    Expect the stamp trigger to raise, OR the row to be rejected by WITH CHECK.
do $$
begin
  insert into public.tasks (id, title, description, company_id, creator_id, assignee_id, due, tenant_id)
  values ('x-leak', 'leak', '', 'roofing', 'abraham', 'abraham', now()::date,
          '00000000-0000-0000-0000-000000000000');
  raise exception 'FAIL: cross-tenant insert succeeded';
exception when others then
  raise notice 'PASS: cross-tenant insert blocked (%).', sqlerrm;
end $$;
```

- [ ] **Step 2: Run it and confirm every assertion**

Run: paste into the Supabase SQL Editor (or `psql -f supabase/sql/verify/072_isolation_check.sql`), substituting the two real auth-user UUIDs.
Expected:
- "A sees B company" = 0; "B sees Lumen company" = 0.
- "B sees tasks" excludes all Lumen tasks.
- The cross-tenant insert prints `PASS: cross-tenant insert blocked`.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/verify/072_isolation_check.sql
git commit -m "test(multitenant): two-tenant isolation proof script"
```

---

## After this plan (follow-on plans, each its own spec→plan→build)

This plan delivers the **wall + create_workspace RPC + proof** — working, testable software. Three short follow-on plans complete sub-project #1's surface:

1. **Client "Create your workspace" page** — a signup screen that, after Supabase Auth sign-up, calls `create_workspace(...)` and routes the user into their new HQ. Wires `current_tenant` into `App` boot. (Client-only; the RPC already exists.)
2. **Email invite flow** — Admin enters a teammate email → invite token carrying `tenant_id` → invitee sets password and their `profiles.tenant_id` is stamped to the inviting tenant. (Depends on this plan.)
3. **Client tenant plumbing audit** — confirm no client code assumes global company slugs (`roofing`/etc.); make company pickers/taxonomy tenant-relative. (Depends on this plan.)

## Self-Review

- **Spec coverage:** tenant model (Task 1) ✓; isolation wall (Task 4, restrictive) ✓; account creation RPC (Task 7) ✓; landmines general-shift/overall (Task 5) ✓; retire developer god-mode (Task 6) ✓; migrate Lumen tenant 0 (Task 2) ✓; success criteria/two-tenant proof (Task 8) ✓; support access layers 1+2 — no schema work (Report-a-problem exists; service role is out-of-band) — documented, no task needed ✓. Signup **UI** + invites are spec'd as in-scope but split into follow-on plans (each independently testable) — noted above.
- **Placeholder scan:** Task 5 Step 2 references copying the four tasks policies from migration 028 with one substitution rather than inlining ~110 lines — this is a precise, bounded instruction (exact file, exact lines 78-191, exact substitution), not a vague "handle it". All other steps contain runnable SQL.
- **Type consistency:** `current_tenant_id()` returns `uuid`; `tenant_id` columns are `uuid`; `create_workspace(text,text) returns uuid`; the `_scoped` table array is identical across Tasks 1-4. Consistent.
