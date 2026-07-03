// tests/unit/validate-newtask.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal browser-global stubs so validate.js's IIFE can load under node.
global.window = global.window || {};
global.App = global.window.App = {
  errors: { ValidationError: class ValidationError extends Error {
    constructor(msg, opts = {}) { super(msg); this.field = opts.field; } } },
  PEOPLE: { abraham: { name: 'Abraham' }, alkeith: { name: 'Alkeith' }, andres: { name: 'Andres' } },
  TASK_TYPES: { admin: {}, bid: {} },
  TASK_LABELS: { none: {}, roof: {} },
  COMPANIES: { roofing: {}, drafting: {} },
  PRIORITIES: { high: {}, medium: {}, low: {} },
  STATUSES: { todo: {}, done: {} },
};
require('../../js/validate.js');
const { newTask } = global.App.validate;

const base = { title: 'Fix roof', company: 'roofing', due: '2026-07-05' };

test('whos[] maps to ordered assignee_ids with lead first', () => {
  const r = newTask({ ...base, whos: ['alkeith', 'andres'] });
  assert.deepEqual(r.assigneeIds, ['alkeith', 'andres']);
  assert.equal(r.assignee, 'alkeith'); // lead = index 0
});

test('legacy single assignee still works', () => {
  const r = newTask({ ...base, assignee: 'abraham' });
  assert.deepEqual(r.assigneeIds, ['abraham']);
  assert.equal(r.assignee, 'abraham');
});

test('duplicate assignees are deduped, order preserved', () => {
  const r = newTask({ ...base, whos: ['andres', 'alkeith', 'andres'] });
  assert.deepEqual(r.assigneeIds, ['andres', 'alkeith']);
});

test('empty whos throws on the assignee field', () => {
  assert.throws(() => newTask({ ...base, whos: [] }), (e) => e.field === 'assignee');
});

test('unknown assignee throws', () => {
  assert.throws(() => newTask({ ...base, whos: ['ghost'] }), (e) => e.field === 'assignee');
});
