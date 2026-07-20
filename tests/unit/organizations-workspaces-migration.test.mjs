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
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table}[\\s\\S]+add column if not exists organization_id`, 'i')
    );
    assert.match(sql, new RegExp(`update public\\.${table}[^;]+legacy_company_workspace_map`, 'i'));
  }
});

test('foundation migration explicitly grants Data API access behind RLS', () => {
  assert.match(sql, /grant select on public\.organizations to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.workspaces to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.workspace_memberships to authenticated/i);
  assert.doesNotMatch(sql, /grant [^;]+ to anon/i);
});
