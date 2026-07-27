// tests/unit/sequence-order.test.mjs
// Pure ordering/grouping for the Category Sequence Board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/tasklist/sequenceOrder.js');
const S = global.App.sequenceOrder;

const T = (id, over = {}) => ({ id, type: 'invoicing', focusSeq: null, due: null, priority: 'medium', ...over });

test('orderTasks: focusSeq-ranked ascending come before null-seq tail', () => {
  const a = T('a', { focusSeq: 5 });
  const b = T('b', { focusSeq: 1 });
  const c = T('c', { focusSeq: null, due: '2026-08-01', priority: 'high' });
  const d = T('d', { focusSeq: null, due: '2026-07-30', priority: 'low' });
  assert.deepEqual(S.orderTasks([a, b, c, d]).map(t => t.id), ['b', 'a', 'd', 'c']);
});

test('seqTailCompare: soonest due first, then higher priority on a tie', () => {
  const early = T('e', { due: '2026-07-28' });
  const late = T('l', { due: '2026-08-10' });
  assert.ok(S.seqTailCompare(early, late) < 0);
  const hi = T('h', { due: '2026-08-01', priority: 'critical' });
  const lo = T('o', { due: '2026-08-01', priority: 'low' });
  assert.ok(S.seqTailCompare(hi, lo) < 0);
});

test('sequenceGroups: buckets by type in the given order, omits empty groups', () => {
  const tasks = [
    T('a', { type: 'admin' }),
    T('b', { type: 'invoicing' }),
    T('c', { type: 'invoicing', focusSeq: 2 }),
  ];
  const groups = S.sequenceGroups(tasks, { order: ['invoicing', 'admin', 'quotes'] });
  assert.deepEqual(groups.map(g => g.key), ['invoicing', 'admin']); // quotes empty -> omitted
  assert.deepEqual(groups[0].tasks.map(t => t.id), ['c', 'b']); // c has focusSeq, ranks first
});

test('sequenceGroups: unknown group keys are appended after the ordered ones', () => {
  const tasks = [T('a', { type: 'weird' }), T('b', { type: 'admin' })];
  const groups = S.sequenceGroups(tasks, { order: ['admin'] });
  assert.deepEqual(groups.map(g => g.key), ['admin', 'weird']);
});

test('positionsFor: assigns 1-based sequential seq in id order', () => {
  assert.deepEqual(S.positionsFor(['x', 'y', 'z']), [
    { id: 'x', seq: 1 }, { id: 'y', seq: 2 }, { id: 'z', seq: 3 },
  ]);
});
