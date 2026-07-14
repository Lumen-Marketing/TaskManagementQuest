// tests/unit/taxonomy-overall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {
  COMPANIES: { roofing: { id: 'roofing' }, drafting: { id: 'drafting' } },
  EventBus: { emit() {} },
};
require('../../js/taxonomy.js');
const T = global.App.taxonomy;

// roofing defines type 'lead'; drafting defines type 'bid' (+ a shared 'lead'
// with a different label to prove first-wins dedup).
T.hydrate({
  types: [
    { company_id: 'roofing',  key: 'lead', label: 'Lead',        sort_order: 0 },
    { company_id: 'drafting', key: 'lead', label: 'Draft Lead',  sort_order: 0 },
    { company_id: 'drafting', key: 'bid',  label: 'Bid',         sort_order: 1 },
  ],
  statuses: [
    { company_id: 'roofing',  type_key: 'lead', key: 'todo', label: 'To do', sort_order: 0, is_default: true },
    { company_id: 'roofing',  type_key: 'lead', key: 'done', label: 'Done',  sort_order: 1, is_done: true },
    { company_id: 'drafting', type_key: 'bid',  key: 'open', label: 'Open',  sort_order: 0, is_default: true },
  ],
  labels: [
    { company_id: 'roofing',  key: 'urgent', label: 'Urgent', sort_order: 0 },
    { company_id: 'drafting', key: 'urgent', label: 'RUSH',   sort_order: 0 },
    { company_id: 'drafting', key: 'perm',   label: 'Permit', sort_order: 1 },
  ],
});

test('activeTypes(overall) unions + dedupes by key (first wins)', () => {
  const keys = T.activeTypes('overall').map(t => t.key).sort();
  assert.deepEqual(keys, ['bid', 'lead']);
  assert.equal(T.typeLabel('overall', 'lead'), 'Lead'); // roofing wins
});

test('activeLabels(overall) unions + dedupes by key', () => {
  const keys = T.activeLabels('overall').map(l => l.key).sort();
  assert.deepEqual(keys, ['perm', 'urgent']);
});

test('activeStatuses(overall, type) resolves per originating company', () => {
  assert.deepEqual(T.activeStatuses('overall', 'lead').map(s => s.key), ['todo', 'done']);
  assert.deepEqual(T.activeStatuses('overall', 'bid').map(s => s.key), ['open']);
  assert.equal(T.defaultStatus('overall', 'lead'), 'todo');
  assert.equal(T.doneStatus('overall', 'lead'), 'done');
});
