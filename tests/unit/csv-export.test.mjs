import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// The module reads the App dictionaries at call time — give it minimal ones.
globalThis.App = {
  TASK_TYPES: { admin: { label: 'Admin' } },
  TASK_LABELS: { roof: { label: 'Roof' }, none: { label: 'No label' } },
  PRIORITIES: { high: { label: 'High' } },
  STATUSES: { todo: { label: 'To do' } },
  directory: {
    person: (id) => ({ abe: { full: 'Abraham Q.' }, kris: { name: 'Kristin' } }[id] || null),
    company: (id) => (id === 'roofing' ? { label: 'Quest Roofing' } : null),
  },
  utils: { toISODate: (d) => d.toISOString().slice(0, 10) },
};
const { tasksRows, timeRows, personName } = require('../../js/services/CsvExport.js');

test('personName: full > name > raw id > empty', () => {
  assert.equal(personName('abe'), 'Abraham Q.');
  assert.equal(personName('kris'), 'Kristin');
  assert.equal(personName('ghost'), 'ghost');
  assert.equal(personName(null), '');
});

test('tasksRows: header + resolved labels + subtask fraction + fallbacks', () => {
  const rows = tasksRows([{
    id: 't1', title: 'Fix roof', type: 'admin', label: 'roof', company: 'roofing',
    assignee: 'abe', creator: 'ghost', priority: 'high', status: 'todo', due: '2026-07-09',
    subtasks: [{ t: 'a', d: true }, { t: 'b', d: false }], description: 'desc',
  }, {
    id: 't2', title: 'Mystery', type: 'weird', label: 'none', company: 'unknownco',
    priority: 'nope', status: 'nope', subtasks: [],
  }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].slice(0, 3), ['Title', 'Type', 'Label']);
  assert.deepEqual(rows[1], ['Fix roof', 'Admin', 'Roof', 'Quest Roofing', 'Abraham Q.', 'High', 'To do', '2026-07-09', 'ghost', '1/2', 'desc']);
  // unknown dict keys fall back to the raw values; empty subtasks -> ''
  assert.equal(rows[2][1], 'weird');
  assert.equal(rows[2][3], 'unknownco');
  assert.equal(rows[2][9], '');
});

test('timeRows: filters to visible tasks, sorts by start, 2-decimal hours, snapshot-title fallback', () => {
  const tasks = [{ id: 't1', title: 'Fix roof', company: 'roofing' }];
  const rows = timeRows(tasks, [
    { taskId: 't1', userId: 'abe', start: Date.UTC(2026, 6, 8, 12), durationMs: 5400000, note: 'later' },
    { taskId: 'hidden', userId: 'abe', start: 1, durationMs: 1 },
    { taskId: 't1', userId: 'kris', start: Date.UTC(2026, 6, 7, 12), durationMs: 900000 },
  ]);
  assert.equal(rows.length, 3); // header + 2 visible (hidden task filtered)
  assert.equal(rows[1][1], 'Kristin'); // earlier start sorts first
  assert.equal(rows[1][4], '0.25');
  assert.equal(rows[2][4], '1.50');
  // snapshot fallback when the task row is gone
  const rows2 = timeRows([{ id: 'x' }], [{ taskId: 'x', taskTitle: 'Snapshot name', durationMs: 0 }]);
  assert.equal(rows2[1][2], 'Snapshot name');
});
