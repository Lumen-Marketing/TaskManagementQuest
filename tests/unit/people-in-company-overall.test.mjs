// tests/unit/people-in-company-overall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const U = global.App.utils;

// Three people. `c` is (contrived) tagged with 'overall' in company_ids so
// the pre-fix intersect path would return ONLY c for the 'overall' scope —
// this is what proves the early-return fix (full roster) is really wired,
// not just the empty-list fallback.
global.App.PROFILES = [
  { member_id: 'a', company_ids: ['roofing'] },
  { member_id: 'b', company_ids: ['drafting'] },
  { member_id: 'c', company_ids: ['overall'] },
];
U.activePeople = () => [
  { id: 'a', company_ids: ['roofing'] },
  { id: 'b', company_ids: ['drafting'] },
  { id: 'c', company_ids: ['overall'] },
];

test("'overall' returns the FULL roster, not just 'overall'-tagged members", () => {
  const all = U.peopleInCompany('overall').map(p => p.id).sort();
  assert.deepEqual(all, ['a', 'b', 'c']);
});

test('a real company still scopes to its members', () => {
  const roof = U.peopleInCompany('roofing').map(p => p.id);
  assert.deepEqual(roof, ['a']);
});
