// tests/unit/checkin-stalled.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskAssignees, stalledByPerson } from '../../supabase/functions/checkins/lib/stalled.mjs';

const NOW = Date.UTC(2026, 6, 15, 18, 0);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

test('taskAssignees prefers assignee_ids, falls back to the single lead', () => {
  assert.deepEqual(taskAssignees({ assignee_id: 'abe', assignee_ids: ['abe', 'shan'] }), ['abe', 'shan']);
  assert.deepEqual(taskAssignees({ assignee_id: 'abe', assignee_ids: [] }), ['abe']);
  assert.deepEqual(taskAssignees({ assignee_id: null, assignee_ids: null }), []);
});

test('stalledByPerson groups open, old tasks by every assignee', () => {
  const tasks = [
    { id: 't1', title: 'Old shared', status: 'todo', updated_at: daysAgo(5), assignee_id: 'abe', assignee_ids: ['abe', 'shan'] },
    { id: 't2', title: 'Fresh',      status: 'todo', updated_at: daysAgo(1), assignee_id: 'abe', assignee_ids: ['abe'] },
    { id: 't3', title: 'Old done',   status: 'done', updated_at: daysAgo(9), assignee_id: 'abe', assignee_ids: ['abe'] },
  ];
  const map = stalledByPerson(tasks, { nowMs: NOW, stalledDays: 3 });
  assert.deepEqual(map.get('abe'), [{ id: 't1', title: 'Old shared' }]); // t2 fresh, t3 done
  assert.deepEqual(map.get('shan'), [{ id: 't1', title: 'Old shared' }]); // co-assignee sees it too
});

test('nobody stalled yields an empty map', () => {
  const tasks = [{ id: 't1', title: 'Fresh', status: 'todo', updated_at: daysAgo(1), assignee_id: 'abe', assignee_ids: ['abe'] }];
  assert.equal(stalledByPerson(tasks, { nowMs: NOW, stalledDays: 3 }).size, 0);
});
