// tests/unit/taskdraft-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/TaskDraftClient.js');
const TDC = global.App.TaskDraftClient;

test('shouldRequest respects min length and word count', () => {
  assert.equal(TDC.shouldRequest('fix', null, {}), false);          // too short
  assert.equal(TDC.shouldRequest('fix the thing', null, {}), true); // >=12 chars, 3 words
  assert.equal(TDC.shouldRequest('a b c d e', null, {}), false);    // 9 chars < 12
});

test('shouldRequest dedups identical text', () => {
  const t = 'request report from josh';
  assert.equal(TDC.shouldRequest(t, t, {}), false);
  assert.equal(TDC.shouldRequest(t, 'something else', {}), true);
});

test('mergeDraftIntoState applies only non-null, unlocked keys', () => {
  const draft = { assignees: ['josh', 'shan'], company: 'lumen', priority: null, due: '2026-07-17', dueTime: null };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, new Set(['company']));
  assert.deepEqual(apply, { assignees: ['josh', 'shan'], due: '2026-07-17' }); // company locked, nulls skipped
  assert.deepEqual(aiFilled.sort(), ['assignees', 'due']);
});

test('mergeDraftIntoState applies type/label/project when present', () => {
  const draft = { assignees: [], company: null, priority: null, due: null, dueTime: null, type: 'lead', label: 'urgent', project: 'p1' };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, new Set());
  assert.deepEqual(apply, { type: 'lead', label: 'urgent', project: 'p1' });
  assert.deepEqual(aiFilled.sort(), ['label', 'project', 'type']);
});

test('mergeDraftIntoState skips an empty assignees array', () => {
  const draft = { assignees: [], company: 'lumen', priority: null, due: null, dueTime: null };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, new Set());
  assert.deepEqual(apply, { company: 'lumen' });
  assert.deepEqual(aiFilled, ['company']);
});

test('mergeDraftIntoState with everything locked applies nothing', () => {
  const draft = { assignees: ['josh'], company: 'lumen', priority: 'high', due: null, dueTime: null };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, ['assignees', 'company', 'priority', 'due', 'dueTime']);
  assert.deepEqual(apply, {});
  assert.deepEqual(aiFilled, []);
});
