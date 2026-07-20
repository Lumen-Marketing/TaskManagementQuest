# Organizations and Workspaces Foundation Rollout

Migration: `20260721063000_organizations_workspaces_foundation.sql`

Production project: `qqvmcsvdxhgjooirznrj`

Current status: prepared and locally verified; not applied to production.

## Safety boundary

This is an additive compatibility migration. It keeps Supabase Auth, `profiles`, `companies`, `profiles.company_ids`, every legacy `company_id`, all current RLS policies, and the current client runtime. It creates one organization around the existing Quest/Lumen account and converts each real legacy company into a workspace. `overall` is deliberately not converted because it becomes an organization-wide view later.

The migration does not seed app templates, pipelines, plugins, or connectors. New customer workspaces remain configurable rather than hardcoded.

## Required rollout order

1. Confirm a current Supabase backup or point-in-time recovery window for production.
2. Run `node --test tests\unit\organizations-workspaces-migration.test.mjs` and `npm.cmd run test:unit`.
3. Apply the migration to an isolated Supabase branch or staging project.
4. Run `supabase/tests/organizations_workspaces_rls.sql`, the unmapped-row queries below, and functional two-user JWT isolation tests in that isolated environment.
5. Run Supabase security and performance advisors and resolve every finding introduced by this migration.
6. Record row counts for organizations, workspaces, memberships, tasks, projects, and taxonomy before promotion.
7. Promote or apply during a monitored window.
8. Re-run counts, the SQL verification script, and functional two-user isolation tests.
9. Roll back only by removing the new additive objects if the runtime has not begun using them. Never modify or delete legacy rows during rollback.

Do not apply the migration directly from an unlinked local checkout. Confirm the project reference before every remote command.

## Preflight commands

```powershell
npx.cmd --yes supabase --version
Get-ChildItem supabase\migrations -Filter '*.sql' | Sort-Object Name | Select-Object -ExpandProperty Name
node --test tests\unit\organizations-workspaces-migration.test.mjs
npm.cmd run test:unit
git diff --check
git status -sb
```

## Backfill verification

Only `company_id = 'overall'` may remain intentionally unmapped.

```sql
select company_id, count(*) from public.tasks where workspace_id is null group by company_id;
select company_id, count(*) from public.projects where workspace_id is null group by company_id;
select company_id, count(*) from public.task_types where workspace_id is null group by company_id;
select count(*) from public.profiles p
where p.approved is distinct from false
  and exists (select 1 from unnest(p.company_ids) c where c <> 'overall')
  and not exists (select 1 from public.workspace_memberships wm where wm.user_id = p.id);
```

Expected results:

- The first three queries return no rows, or only an `overall` row.
- The final query returns `0`.
- `supabase/tests/organizations_workspaces_rls.sql` completes without an exception.

## Count snapshot

Record the output before and after promotion. Counts must not decrease.

```sql
select 'organizations' as entity, count(*) from public.organizations
union all select 'organization_memberships', count(*) from public.organization_memberships
union all select 'workspaces', count(*) from public.workspaces
union all select 'workspace_memberships', count(*) from public.workspace_memberships
union all select 'tasks', count(*) from public.tasks
union all select 'projects', count(*) from public.projects
union all select 'task_types', count(*) from public.task_types
union all select 'task_type_statuses', count(*) from public.task_type_statuses
union all select 'task_labels', count(*) from public.task_labels;
```

## Functional isolation gate

In the isolated environment, create two disposable auth users and two organizations. Give each user membership in only their own organization and workspace. Using each user's real access token, prove:

- User A sees only organization A and workspace A.
- User B sees only organization B and workspace B.
- User A cannot insert a workspace into organization B.
- User A cannot read or change organization B memberships.
- User A cannot add a workspace member who is not already active in organization A.
- Neither user can call private helper functions through the Data API.
- Anonymous requests cannot read or write any new tenant table.

Delete the disposable users and rows after the transaction or reset the isolated branch. Never run this fixture against production.

## Rollback boundary

Before the runtime reads the new model, rollback can remove the new triggers, helper functions, nullable ownership columns, indexes, mapping table, workspace tables, membership tables, and organization table. Because the migration does not delete or rewrite legacy ownership, the existing UI remains usable.

After any runtime release begins writing organization/workspace-native data, do not use that rollback. Restore the prior deployment, stop writes, export new-model rows, and execute a reviewed data-preserving rollback plan.

## Advisor record

Read-only production baseline captured on 2026-07-21 before this migration was applied:

- Security advisor: 16 existing notices — 3 RLS-without-policy informational notices, 1 mutable function search path, 1 extension in `public`, 1 public bucket listing warning, 9 exposed security-definer warnings, and leaked-password protection disabled.
- Performance advisor: 27 existing notices — 4 unindexed foreign keys, 5 auth RLS initialization-plan warnings, 2 backup tables without primary keys, 9 unused indexes, and 7 multiple-permissive-policy warnings.
- New findings attributable to this migration: none; the remote migration list and live schema confirm the migration has not been applied.
- Reference: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

The migration uses a non-exposed `private` schema for new security-definer helpers, locks each helper's `search_path`, removes anonymous access, uses one permissive policy per role/action, and adds covering indexes for every new foreign key. Re-run both advisors after staging application and compare against the counts above.

## Live compatibility snapshot

Read-only production audit captured on 2026-07-21:

- Project health: `ACTIVE_HEALTHY`, PostgreSQL 17.
- Real legacy companies: `drafting`, `lumen`, and `roofing`; all IDs are valid workspace slugs.
- Organization-wide pseudo-company: `overall`; intentionally excluded from workspace backfill.
- Approved profiles available for deterministic ownership backfill: 16, including 4 developers and 3 admins.
- Source rows: 77 tasks, 11 projects, 21 task types, 117 task statuses, and 9 task labels.
- Every required legacy source column exists.
- All five new tenant tables are absent, confirming no production DDL occurred.
