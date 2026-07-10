// tests/unit/utils-upper.test.mjs
// Covers App.utils.upper — the auto-caps helper applied at the task/project
// save seams (createTask, updateTaskDetails, updateTaskField, addTaskComment,
// createProject). See js/utils.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal browser-global stub so utils.js can load under node.
global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const { upper } = global.App.utils;

test('uppercases lowercase text', () => {
  assert.equal(upper('fix the sink'), 'FIX THE SINK');
});

test('leaves already-uppercased text unchanged (idempotent)', () => {
  assert.equal(upper('FIX THE SINK'), 'FIX THE SINK');
  assert.equal(upper(upper('mixed Case')), 'MIXED CASE');
});

test('preserves numbers, punctuation and spacing', () => {
  assert.equal(upper('  q3 reroof — maple st #12  '), '  Q3 REROOF — MAPLE ST #12  ');
});

test('empty string stays empty', () => {
  assert.equal(upper(''), '');
});

test('non-strings pass through untouched', () => {
  assert.equal(upper(null), null);
  assert.equal(upper(undefined), undefined);
  assert.equal(upper(42), 42);
});
