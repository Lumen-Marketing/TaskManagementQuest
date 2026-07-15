// tests/unit/rollupclient.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/RollupClient.js');
const RC = global.App.RollupClient;

test('guard rejects empty text / non-array bullets', () => {
  assert.equal(RC.guard(null), null);
  assert.equal(RC.guard({ text: '', bullets: [] }), null);
  assert.equal(RC.guard({ text: 'hi', bullets: 'no' }), null);
  assert.deepEqual(RC.guard({ text: 'hi', bullets: [] }), { text: 'hi', bullets: [] });
});

test('cache set / get / clear round-trips per project id', () => {
  RC.cache.clear();
  assert.equal(RC.get('proj-a'), null);
  const entry = { rollup: { text: 'x', bullets: [] }, generatedAt: '2026-07-16T00:00:00Z' };
  RC.set('proj-a', entry);
  assert.deepEqual(RC.get('proj-a'), entry);
  assert.equal(RC.get('proj-b'), null); // isolated per id
  RC.clear('proj-a');
  assert.equal(RC.get('proj-a'), null);
});
