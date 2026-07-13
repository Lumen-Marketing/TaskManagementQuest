// tests/unit/digest-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/DigestClient.js');
const DC = global.App.DigestClient;

test('weekKey returns the Monday of the week for any weekday', () => {
  assert.equal(DC.weekKey('2026-07-15'), '2026-07-13'); // Wed → Mon
  assert.equal(DC.weekKey('2026-07-13'), '2026-07-13'); // Mon → itself
  assert.equal(DC.weekKey('2026-07-19'), '2026-07-13'); // Sun → same Mon
  assert.equal(DC.weekKey('2026-07-20'), '2026-07-20'); // next Mon
});

test('guard rejects empty text / non-array bullets', () => {
  assert.equal(DC.guard(null), null);
  assert.equal(DC.guard({ text: '', bullets: [] }), null);
  assert.equal(DC.guard({ text: 'hi', bullets: 'no' }), null);
  assert.deepEqual(DC.guard({ text: 'hi', bullets: [] }), { text: 'hi', bullets: [] });
});

test('cacheKey namespaces per user per week', () => {
  assert.equal(DC.cacheKey('shan', '2026-07-13'), 'qhq.digest.shan.2026-07-13');
});
