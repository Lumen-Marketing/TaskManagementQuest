# Organizations and Workspaces Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tenant-safe organization/workspace schema, migrate the existing company relationships without deleting legacy data, and prove the migration's safety contract before any runtime UI switches to the new model.

**Architecture:** Introduce organizations, organization memberships, workspaces, workspace memberships, and a legacy company-to-workspace map in a standard Supabase migration. Add nullable organization/workspace ownership to direct tenant roots, backfill from the map, and protect the new tables with membership-based RLS while leaving all current company columns and policies operational.

**Tech Stack:** PostgreSQL 17, Supabase Auth/Data API/RLS, Supabase CLI 2.109.1, Node.js 20+ `node:test`, static zero-build JavaScript application.

## Global Constraints

- Preserve Supabase Auth, `profiles`, all existing records, and every current login flow.
- Workspaces start blank; do not seed role-specific templates, apps, pipelines, plugins, or connectors.
- Do not remove `profiles.company_ids`, legacy `company_id` columns, `public.companies`, `App.COMPANIES`, or Overall-company compatibility in this slice.
- Every new exposed table must have RLS enabled and explicit minimum Data API grants.
- Authorization must use database memberships and `(select auth.uid())`, never user-editable metadata.
- Any security-definer helper must live outside the exposed `public` schema, lock `search_path`, verify the authenticated user, revoke `PUBLIC`, and receive only explicit execution grants.
- The migration must be idempotent, transaction-wrapped, and safe to dry-run with a final rollback.
- No production migration is applied until dry-run validation, advisor review, backup confirmation, and an explicit deployment checkpoint.

---

### Task 1: Lock the additive migration safety contract

**Files:**
- Create: `tests/unit/organizations-workspaces-migration.test.mjs`
- Test: `tests/unit/organizations-workspaces-migration.test.mjs`

**Interfaces:**
- Consumes: the planned migration path `supabase/migrations/20260721063000_organizations_workspaces_foundation.sql`
- Produces: a static contract that rejects missing tables, missing RLS/grants, destructive cleanup, Overall-as-workspace backfill, and incomplete ownership backfill

- [ ] **Step 1: Write the failing migration contract test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260721063000_organizations_workspaces_foundation.sql',
  import.meta.url
);
const sql = await readFile(migrationUrl, 'utf8').catch(() => '');

test('foundation migration creates the tenant hierarchy and access tables', () => {
  for (const table of [
    'organizations',
    'organization_memberships',
    'workspaces',
    'workspace_memberships',
    'legacy_company_workspace_map'
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
});

test('foundation migration is additive and preserves legacy authorization', () => {
  assert.doesNotMatch(sql, /drop\s+(table|column)\b/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.profiles\s+drop/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.companies/i);
  assert.doesNotMatch(sql, /where\s+c\.id\s*=\s*'overall'/i);
  assert.match(sql, /where\s+c\.id\s*<>\s*'overall'/i);
});

test('foundation migration backfills direct tenant roots', () => {
  for (const table of ['tasks', 'projects', 'task_types', 'task_type_statuses', 'task_labels']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}[\\s\\S]+add column if not exists organization_id`, 'i'));
    assert.match(sql, new RegExp(`update public\\.${table}[^;]+legacy_company_workspace_map`, 'i'));
  }
});

test('foundation migration explicitly grants Data API access behind RLS', () => {
  assert.match(sql, /grant select on public\.organizations to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.workspaces to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.workspace_memberships to authenticated/i);
  assert.doesNotMatch(sql, /grant [^;]+ to anon/i);
});
```

- [ ] **Step 2: Run the test and confirm it fails because the migration does not exist**

Run: `node --test tests/unit/organizations-workspaces-migration.test.mjs`

Expected: FAIL on the first required `create table` assertion.

- [ ] **Step 3: Commit the red test**

```powershell
git add -- tests/unit/organizations-workspaces-migration.test.mjs
git commit -m "test: define workspace foundation migration contract"
```

### Task 2: Create the organization/workspace migration

**Files:**
- Create with Supabase CLI, then normalize to: `supabase/migrations/20260721063000_organizations_workspaces_foundation.sql`
- Modify: `tests/unit/organizations-workspaces-migration.test.mjs` only if the generated filename differs before normalization

**Interfaces:**
- Consumes: `auth.users`, `public.profiles`, `public.companies`, and legacy `company_id`/`company_ids` relationships
- Produces: `public.organizations`, `public.organization_memberships`, `public.workspaces`, `public.workspace_memberships`, `public.legacy_company_workspace_map`, and membership-policy helpers in the non-exposed `private` schema

- [ ] **Step 1: Generate the migration through the current Supabase CLI**

Run:

```powershell
npx.cmd --yes supabase migration new organizations_workspaces_foundation
```

Expected: the CLI prints a new file under `supabase/migrations/`.

Rename only that generated empty file to the plan's stable path:

```powershell
$generated = Get-ChildItem supabase\migrations -Filter '*_organizations_workspaces_foundation.sql' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Move-Item -LiteralPath $generated.FullName -Destination 'supabase\migrations\20260721063000_organizations_workspaces_foundation.sql'
```

- [ ] **Step 2: Implement the additive tenant schema and indexes**

Write the following transaction into the migration, retaining the exact table and constraint names used by the contract test:

```sql
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','pending_deletion')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  icon text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order double precision not null default 0,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('workspace_admin','supervisor','member')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.legacy_company_workspace_map (
  company_id text primary key references public.companies(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, organization_id) where status = 'active';
create index if not exists workspaces_organization_idx
  on public.workspaces (organization_id, sort_order) where archived_at is null;
create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships (user_id, workspace_id) where status = 'active';

commit;
```

- [ ] **Step 3: Add deterministic legacy backfill inside the same transaction**

Before `commit`, add an idempotent block that:

```sql
do $$
declare
  legacy_owner uuid;
  legacy_org uuid;
begin
  select p.id into legacy_owner
  from public.profiles p
  where p.approved is distinct from false
  order by case when p.role = 'developer' then 0 when p.role = 'admin' then 1 else 2 end,
           p.created_at nulls last,
           p.id
  limit 1;

  if legacy_owner is null then
    raise exception 'workspace foundation requires one approved legacy profile';
  end if;

  insert into public.organizations (name, slug, owner_user_id)
  values ('Quest Lumen', 'quest-lumen', legacy_owner)
  on conflict (slug) do update set name = excluded.name
  returning id into legacy_org;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  select legacy_org, p.id,
         case when p.id = legacy_owner then 'owner'
              when p.role in ('developer','admin') then 'admin'
              else 'member' end,
         'active'
  from public.profiles p
  where p.approved is distinct from false
  on conflict (organization_id, user_id) do update
    set role = excluded.role, status = excluded.status;

  insert into public.workspaces (organization_id, name, slug, sort_order)
  select legacy_org, c.label, c.id,
         row_number() over (order by c.created_at, c.id)::double precision
  from public.companies c
  where c.id <> 'overall'
  on conflict (organization_id, slug) do update set name = excluded.name;

  insert into public.legacy_company_workspace_map (company_id, organization_id, workspace_id)
  select c.id, legacy_org, w.id
  from public.companies c
  join public.workspaces w on w.organization_id = legacy_org and w.slug = c.id
  where c.id <> 'overall'
  on conflict (company_id) do update
    set organization_id = excluded.organization_id, workspace_id = excluded.workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status)
  select m.workspace_id, p.id,
         case when p.role in ('developer','admin') then 'workspace_admin'
              when p.role in ('supervisor','construction_supervisor') then 'supervisor'
              else 'member' end,
         'active'
  from public.profiles p
  join public.legacy_company_workspace_map m on m.company_id = any(p.company_ids)
  where p.approved is distinct from false
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = excluded.status;
end;
$$;
```

- [ ] **Step 4: Add and backfill ownership columns without changing legacy nullability**

```sql
alter table public.tasks add column if not exists organization_id uuid references public.organizations(id);
alter table public.tasks add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.projects add column if not exists organization_id uuid references public.organizations(id);
alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_types add column if not exists organization_id uuid references public.organizations(id);
alter table public.task_types add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_type_statuses add column if not exists organization_id uuid references public.organizations(id);
alter table public.task_type_statuses add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_labels add column if not exists organization_id uuid references public.organizations(id);
alter table public.task_labels add column if not exists workspace_id uuid references public.workspaces(id);

update public.tasks t set organization_id = m.organization_id, workspace_id = m.workspace_id
from public.legacy_company_workspace_map m where t.company_id = m.company_id;
update public.projects p set organization_id = m.organization_id, workspace_id = m.workspace_id
from public.legacy_company_workspace_map m where p.company_id = m.company_id;
update public.task_types x set organization_id = m.organization_id, workspace_id = m.workspace_id
from public.legacy_company_workspace_map m where x.company_id = m.company_id;
update public.task_type_statuses x set organization_id = m.organization_id, workspace_id = m.workspace_id
from public.legacy_company_workspace_map m where x.company_id = m.company_id;
update public.task_labels x set organization_id = m.organization_id, workspace_id = m.workspace_id
from public.legacy_company_workspace_map m where x.company_id = m.company_id;

create index if not exists tasks_workspace_idx on public.tasks (workspace_id);
create index if not exists projects_workspace_idx on public.projects (workspace_id);
create index if not exists task_types_workspace_idx on public.task_types (workspace_id);
create index if not exists task_type_statuses_workspace_idx on public.task_type_statuses (workspace_id, type_key);
create index if not exists task_labels_workspace_idx on public.task_labels (workspace_id);
```

`overall` rows intentionally remain null in the new workspace columns during compatibility because Overall becomes an organization-wide view in a later runtime slice.

- [ ] **Step 5: Add membership helpers, RLS, and explicit grants**

Create these stable SQL security-definer helpers with `set search_path = pg_catalog, public, private`:

- `private.is_organization_member(uuid)` checks an active `organization_memberships` row for `(select auth.uid())`.
- `private.is_organization_admin(uuid)` checks an active `owner` or `admin` row for `(select auth.uid())`.
- `private.is_workspace_member(uuid)` checks an active `workspace_memberships` row for `(select auth.uid())`.
- `private.is_workspace_admin(uuid)` checks an active `workspace_admin` row for `(select auth.uid())`.
- `private.user_is_organization_member(uuid, uuid)` checks that a proposed workspace member is already an active member of the parent organization.

Each function body must reject a null `(select auth.uid())`. Revoke execution from `PUBLIC`, `anon`, and `authenticated`, then grant execution only to `authenticated`. The `private` schema remains outside the Data API's exposed schemas, so these helpers can support policies without becoming public RPC endpoints.

Enable RLS on all five new tables. Add policies with these exact rules:

- organizations SELECT: active organization member;
- organization memberships SELECT: same organization member;
- organization memberships INSERT/UPDATE/DELETE: active organization owner/admin, with owner deletion forbidden;
- workspaces SELECT: active organization member plus workspace membership, or organization owner/admin;
- workspaces INSERT/UPDATE/DELETE: organization owner/admin, with delete represented by `archived_at` in application behavior;
- workspace memberships SELECT: organization owner/admin or member of the same workspace;
- workspace memberships INSERT/UPDATE/DELETE: organization owner/admin or workspace admin, and the target user must already be an active organization member;
- legacy mapping SELECT: organization owner/admin only; no client INSERT/UPDATE/DELETE policies.

Add explicit grants:

```sql
grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_memberships to authenticated;
grant select on public.legacy_company_workspace_map to authenticated;
revoke all on public.organizations, public.organization_memberships, public.workspaces,
  public.workspace_memberships, public.legacy_company_workspace_map from anon;
```

- [ ] **Step 6: Run the migration contract and full unit suite**

Run:

```powershell
node --test tests\unit\organizations-workspaces-migration.test.mjs
npm.cmd run test:unit
```

Expected: the migration contract passes and the existing unit suite has zero failures.

- [ ] **Step 7: Commit the green migration**

```powershell
git add -- supabase/migrations/20260721063000_organizations_workspaces_foundation.sql tests/unit/organizations-workspaces-migration.test.mjs
git commit -m "feat: add organization workspace foundation migration"
```

### Task 3: Add executable schema and rollout verification

**Files:**
- Create: `supabase/tests/organizations_workspaces_rls.sql`
- Create: `docs/runbooks/organizations-workspaces-foundation-rollout.md`

**Interfaces:**
- Consumes: the tables and policies created by Task 2
- Produces: a repeatable database verification suite and a no-guesswork rollout/rollback checklist; functional cross-tenant JWT tests remain a mandatory isolated-branch promotion gate

- [ ] **Step 1: Add the SQL schema verification script**

Create a transaction-wrapped `DO` block that raises an exception unless all five tenant tables have RLS enabled, all required policies exist, `anon` has no privileges, the legacy columns still exist, no `overall` workspace exists, and no non-Overall direct tenant rows remain unmapped. Use `to_regclass`, `pg_class`, `pg_policies`, `has_table_privilege`, and `information_schema.columns` so the script is executable without pgTAP or test users. End with `rollback` so verification cannot mutate data.

The script must explicitly assert policy coverage for:

```sql
values
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
```

Functional user-A/user-B JWT isolation tests are run after this migration reaches an isolated Supabase branch or staging project, where disposable auth users can be created safely; they are not simulated against production.

- [ ] **Step 2: Write the rollout runbook**

The runbook must contain the exact order:

1. Confirm a current Supabase backup or point-in-time recovery window.
2. Run the Node migration contract and full unit suite.
3. Apply the migration to an isolated Supabase branch or staging project.
4. Run the SQL isolation test and the unmapped-row queries.
5. Run Supabase security and performance advisors and resolve every new finding.
6. Record row counts for organizations, workspaces, memberships, tasks, projects, and taxonomy before promotion.
7. Promote/apply during a monitored window.
8. Re-run counts and isolation tests.
9. Roll back only by removing new additive objects if the runtime has not begun using them; never modify legacy rows during rollback.

Include these verification queries verbatim:

```sql
select company_id, count(*) from public.tasks where workspace_id is null group by company_id;
select company_id, count(*) from public.projects where workspace_id is null group by company_id;
select company_id, count(*) from public.task_types where workspace_id is null group by company_id;
select count(*) from public.profiles p
where p.approved is distinct from false
  and exists (select 1 from unnest(p.company_ids) c where c <> 'overall')
  and not exists (select 1 from public.workspace_memberships wm where wm.user_id = p.id);
```

Only `company_id = 'overall'` may remain intentionally unmapped.

- [ ] **Step 3: Run repository verification**

Run:

```powershell
npm.cmd run test:unit
git diff --check
git status --short
```

Expected: all unit tests pass, `git diff --check` reports no errors, and only the SQL isolation test plus runbook are uncommitted.

- [ ] **Step 4: Commit the verification assets**

```powershell
git add -- supabase/tests/organizations_workspaces_rls.sql docs/runbooks/organizations-workspaces-foundation-rollout.md
git commit -m "test: add workspace tenant isolation rollout checks"
```

### Task 4: Validate without touching production data

**Files:**
- Modify only if validation finds defects: `supabase/migrations/20260721063000_organizations_workspaces_foundation.sql`
- Modify only if assertions are incomplete: `supabase/tests/organizations_workspaces_rls.sql`
- Modify if commands or findings change: `docs/runbooks/organizations-workspaces-foundation-rollout.md`

**Interfaces:**
- Consumes: Tasks 1-3 plus Supabase project metadata
- Produces: evidence that the migration is ready for an isolated database deployment checkpoint

- [ ] **Step 1: Confirm CLI and linked-project state without applying anything**

Run:

```powershell
npx.cmd --yes supabase --version
Get-ChildItem supabase\migrations -Filter '*.sql' | Sort-Object Name | Select-Object -ExpandProperty Name
```

Expected: CLI 2.109.1 or newer and the new migration listed locally. Docker is not required for this check. If the repository is not linked, stop before any remote CLI command; do not guess a project reference.

- [ ] **Step 2: Run read-only Supabase advisors against the known Job Center project**

Use project `qqvmcsvdxhgjooirznrj` and request both security and performance advisors. Record only findings relevant to the new migration in the runbook; do not change unrelated production objects.

- [ ] **Step 3: Verify no production DDL occurred**

Read the remote migration list and confirm `20260721063000` is absent. Confirm the local repository remains ahead only by the intended commits.

- [ ] **Step 4: Run the final local verification gate**

Run:

```powershell
node --test tests\unit\organizations-workspaces-migration.test.mjs
npm.cmd run test:unit
git diff --check
git status -sb
```

Expected: all tests pass, the worktree is clean, and no production schema change has been applied. The next checkpoint is an isolated Supabase branch/staging deployment or an explicitly approved monitored production migration.
