// tests/unit/task-assignees.test.mjs
//
// Multi-assignee visibility (migration 060). The DB stores an ORDERED
// assignee_ids[]; index 0 is the lead and is mirrored into assignee_id.
// RLS lets every assignee READ the row, so a non-lead assignee gets the
// notification and can open the task — but the client list/filter seams used
// to ask `t.assignee === me` (the LEAD only), so the task was invisible in
// My work / Home / role scope. These tests lock the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
require('../../js/models/TaskModel.js');

const U = global.App.utils;

// Minimal ambient App surface that getFiltered() touches.
App.DEFAULT_CLOCK_TASK_ID = 'general-shift';
App.taxonomy = { isDone: (t) => (t.status || 'todo') === 'done' };

const ME = 'shan';
const LEAD = 'kristin';

// A task led by Kristin with me as a SECOND assignee — the exact shape from
// the bug report: I'm notified, the detail page shows me, no list shows it.
const coAssigned = {
  id: 't1', title: 'IMPROVE UNDERWRITING CALCULATOR', company: 'lumen',
  creator: LEAD, assignee: LEAD, assigneeIds: [LEAD, ME],
  status: 'todo', priority: 'high', due: '',
};
// Legacy row (pre-060): no assigneeIds array at all, lead only.
const legacyMine = {
  id: 't2', title: 'LEGACY', company: 'lumen',
  creator: ME, assignee: ME, status: 'todo', priority: 'medium', due: '',
};
const notMine = {
  id: 't3', title: 'SOMEONE ELSE', company: 'lumen',
  creator: LEAD, assignee: LEAD, assigneeIds: [LEAD], status: 'todo', priority: 'low', due: '',
};

/* ---------- the helpers ---------- */

test('taskAssignees returns the ordered array, lead first', () => {
  assert.deepEqual(U.taskAssignees(coAssigned), [LEAD, ME]);
});

test('taskAssignees falls back to the single lead on legacy rows', () => {
  assert.deepEqual(U.taskAssignees(legacyMine), [ME]);
  assert.deepEqual(U.taskAssignees({ id: 'x' }), []);
});

test('isAssignee is true for a NON-LEAD assignee', () => {
  assert.equal(U.isAssignee(coAssigned, ME), true);    // the bug
  assert.equal(U.isAssignee(coAssigned, LEAD), true);  // lead still counts
  assert.equal(U.isAssignee(notMine, ME), false);
  assert.equal(U.isAssignee(legacyMine, ME), true);    // legacy row still works
});

/* ---------- the seams that hid the task ---------- */

const model = () => {
  const m = new App.TaskModel();
  m.hydrate([coAssigned, legacyMine, notMine]);
  return m;
};
const ids = (arr) => arr.map(t => t.id).sort();

test('"My work" scope shows tasks where I am a non-lead assignee', () => {
  const got = model().getFiltered({
    view: 'all', scope: 'mine', currentUser: ME, role: 'developer', currentCompany: 'lumen',
  });
  assert.deepEqual(ids(got), ['t1', 't2']);
});

test('the "mine" view shows tasks where I am a non-lead assignee', () => {
  const got = model().getFiltered({
    view: 'mine', scope: 'all', currentUser: ME, role: 'developer', currentCompany: 'lumen',
  });
  assert.deepEqual(ids(got), ['t1', 't2']);
});

test('worker role scope keeps a task I am a non-lead assignee on', () => {
  const got = model().getFiltered({
    view: 'all', scope: 'all', currentUser: ME, role: 'worker', currentCompany: 'lumen',
  });
  assert.deepEqual(ids(got), ['t1', 't2']);
});

test('the assignee filter matches any assignee, not just the lead', () => {
  const got = model().getFiltered({
    view: 'all', scope: 'all', currentUser: LEAD, role: 'developer', currentCompany: 'lumen',
    activeFilters: { assignees: [ME] },
  });
  assert.deepEqual(ids(got), ['t1', 't2']);
});

test('a person: view lists tasks where they are a non-lead assignee', () => {
  const got = model().getFiltered({
    view: `person:${ME}`, scope: 'all', currentUser: LEAD, role: 'developer', currentCompany: 'lumen',
  });
  assert.deepEqual(ids(got), ['t1', 't2']);
});

test('byAssignee matches any assignee', () => {
  assert.deepEqual(ids(model().byAssignee(ME)), ['t1', 't2']);
});
