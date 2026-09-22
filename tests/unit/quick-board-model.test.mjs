// tests/unit/quick-board-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {
  // Mirrors js/constants.js — lower `order` sorts first.
  PRIORITIES: {
    critical: { order: 0 }, urgent: { order: 1 }, high: { order: 2 },
    medium:   { order: 3 }, low:    { order: 4 },
  },
  taxonomy: { isDone: (t) => t.status === 'done' },
};
require('../../js/views/tasklist/quickBoardModel.js');

const t = (id, over) => Object.assign(
  { id, title: id, status: 'todo', priority: 'medium', due: '2026-09-25' }, over);

test('bySegment splits open from done', () => {
  const list = [t('a'), t('b', { status: 'done' }), t('c')];
  assert.deepEqual(App.QuickBoard.bySegment(list, 'open').map(x => x.id), ['a', 'c']);
  assert.deepEqual(App.QuickBoard.bySegment(list, 'done').map(x => x.id), ['b']);
  assert.deepEqual(App.QuickBoard.bySegment(list, 'all').map(x => x.id), ['a', 'b', 'c']);
});

test('not-done sorts ahead of done regardless of priority', () => {
  const list = [
    t('doneCritical', { status: 'done', priority: 'critical' }),
    t('openLow', { priority: 'low' }),
  ];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['openLow', 'doneCritical']);
});

test('priority orders Critical to Low', () => {
  const list = [t('low', { priority: 'low' }), t('crit', { priority: 'critical' }),
                t('high', { priority: 'high' }), t('med', { priority: 'medium' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id),
    ['crit', 'high', 'med', 'low']);
});

test('equal priority falls back to due date ascending', () => {
  const list = [t('late', { due: '2026-10-05' }), t('soon', { due: '2026-09-24' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['soon', 'late']);
});

test('tasks with no due date sort after dated ones of the same priority', () => {
  const list = [t('undated', { due: '' }), t('dated', { due: '2026-12-31' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['dated', 'undated']);
});

test('sort does not mutate its input', () => {
  const list = [t('b', { priority: 'low' }), t('a', { priority: 'critical' })];
  const before = list.map(x => x.id);
  App.QuickBoard.sort(list);
  assert.deepEqual(list.map(x => x.id), before);
});

test('an unknown priority key sorts last rather than throwing', () => {
  const list = [t('weird', { priority: 'not-a-priority' }), t('low', { priority: 'low' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['low', 'weird']);
});

test('isOverdue is past-due and not done', () => {
  const today = '2026-09-23';
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '2026-09-22' }), today), true);
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: today }), today), false, 'today is not overdue');
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '2026-09-24' }), today), false);
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '' }), today), false, 'no due date is not overdue');
  assert.equal(
    App.QuickBoard.isOverdue(t('a', { due: '2026-09-22', status: 'done' }), today), false,
    'a finished task is never overdue');
});
