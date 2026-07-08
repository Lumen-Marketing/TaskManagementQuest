import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { POLICY, planCommit } = require('../../js/UiStatePolicy.js');

// Mirror of AppController's uiState fields that the policy governs.
const base = () => ({
  view: 'all', scope: 'all', layout: 'table',
  calendarMode: 'month', calendarAnchor: null, calendarSelectedDay: null,
  sortBy: 'priority', sortDir: 'asc', groupBy: 'due',
  collapsedGroups: new Set(), searchQuery: '', selectedTaskId: null,
  filters: { assignees: [], dueRange: 'all' }, filtersOpen: false,
});

test('no-op patch: same values → not dirty, no events, no persist/route', () => {
  const plan = planCommit(base(), { view: 'all', selectedTaskId: null });
  assert.equal(plan.dirty, false);
  assert.deepEqual(plan.events, []);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, false);
});

test('view change → payload event + persist + route', () => {
  const plan = planCommit(base(), { view: 'home' });
  assert.equal(plan.dirty, true);
  assert.deepEqual(plan.changed, { view: 'home' });
  assert.deepEqual(plan.events, [{ name: 'view:changed', payload: 'home' }]);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, true);
});

test('sortBy + sortDir in one patch → ONE sort:changed', () => {
  const plan = planCommit(base(), { sortBy: 'due', sortDir: 'desc' });
  assert.deepEqual(plan.events, [{ name: 'sort:changed', payload: undefined }]);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, false);
});

test('calendar trio shares ONE calendar:changed; only selected day routes', () => {
  let plan = planCommit(base(), { calendarMode: 'week', calendarAnchor: '2026-07-01' });
  assert.deepEqual(plan.events, [{ name: 'calendar:changed', payload: undefined }]);
  assert.equal(plan.route, false);
  plan = planCommit(base(), { calendarSelectedDay: '2026-07-09' });
  assert.equal(plan.route, true);
  assert.equal(plan.persist, false);
});

test('searchQuery: payload event, no persist, no route', () => {
  const plan = planCommit(base(), { searchQuery: 'roof' });
  assert.deepEqual(plan.events, [{ name: 'search:changed', payload: 'roof' }]);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, false);
});

test('selection: no payload, routes, does not persist', () => {
  const plan = planCommit(base(), { selectedTaskId: 't-1' });
  assert.deepEqual(plan.events, [{ name: 'selection:changed', payload: undefined }]);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, true);
});

test('unknown field throws (typo guard)', () => {
  assert.throws(() => planCommit(base(), { vieww: 'home' }), /unknown field/);
});

test('object fields diff by reference: same ref clean, fresh ref dirty', () => {
  const prev = base();
  assert.equal(planCommit(prev, { filters: prev.filters }).dirty, false);
  const plan = planCommit(prev, { filters: { ...prev.filters } });
  assert.equal(plan.dirty, true);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, true);
});

test('emit order = POLICY declaration order, not patch key order', () => {
  const plan = planCommit(base(), { sortBy: 'due', view: 'home', layout: 'kanban' });
  assert.deepEqual(plan.events.map(e => e.name),
    ['view:changed', 'layout:changed', 'sort:changed']);
});

test('every POLICY entry has the full shape', () => {
  for (const [k, p] of Object.entries(POLICY)) {
    assert.equal(typeof p.event, 'string', k);
    assert.equal(typeof p.payload, 'boolean', k);
    assert.equal(typeof p.persisted, 'boolean', k);
    assert.equal(typeof p.routed, 'boolean', k);
  }
});
