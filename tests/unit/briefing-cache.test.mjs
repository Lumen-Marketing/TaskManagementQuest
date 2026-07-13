// tests/unit/briefing-cache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = { utils: { todayISO: () => '2026-07-14' } };
require('../../js/services/BriefingClient.js');
const BC = global.App.BriefingClient;

// Minimal localStorage stand-in.
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('cacheKey is namespaced by user + date', () => {
  assert.equal(BC.cacheKey('u1', '2026-07-14'), 'qhq.briefing.u1.2026-07-14');
});

test('write then read round-trips the briefing', () => {
  const s = memStore();
  const b = { text: 'hi', bullets: [], source: 'model' };
  BC.writeCache(s, 'u1', '2026-07-14', b);
  assert.deepEqual(BC.readCache(s, 'u1', '2026-07-14'), b);
});

test('read returns null on miss and on malformed JSON', () => {
  const s = memStore();
  assert.equal(BC.readCache(s, 'u1', '2026-07-14'), null);
  s.setItem('qhq.briefing.u1.2026-07-14', '{not json');
  assert.equal(BC.readCache(s, 'u1', '2026-07-14'), null);
});

test('guard rejects briefings without usable text/bullets', () => {
  assert.equal(BC.guard(null), null);
  assert.equal(BC.guard({ text: '', bullets: [] }), null);
  assert.equal(BC.guard({ text: 'ok', bullets: 'nope' }), null);
  const good = { text: 'ok', bullets: [] };
  assert.equal(BC.guard(good), good);
});
