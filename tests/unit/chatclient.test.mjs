// tests/unit/chatclient.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/ChatClient.js');
const CC = global.App.ChatClient;

const mk = (o) => ({ title: 'T', company: 'Lumen', assignee: 'josh', priority: 'medium', status: 'todo', due: null, completedAt: null, done: false, ...o });

test('buildSnapshot mirrors the function-side format and ordering', () => {
  const { lines, truncated } = CC.buildSnapshot([
    mk({ title: 'done1', done: true, status: 'done', completedAt: '2026-06-01' }),
    mk({ title: 'over1', due: '2026-07-01' }),
  ], { today: '2026-07-14' });
  assert.equal(truncated, false);
  assert.equal(lines[0], 'OVERDUE · over1 · Lumen · josh · due 2026-07-01');
  assert.equal(lines[1], 'DONE · done1 · Lumen · josh · no due date · completed 2026-06-01');
});

test('buildSnapshot caps and flags truncation', () => {
  const many = Array.from({ length: 4 }, (_, i) => mk({ title: 't' + i, due: '2026-07-1' + i }));
  const { lines, truncated } = CC.buildSnapshot(many, { today: '2026-07-14', max: 2 });
  assert.equal(lines.length, 2);
  assert.equal(truncated, true);
});

test('trimHistory keeps the last N valid turns and drops non user/assistant roles', () => {
  const msgs = [
    { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' },
    { role: 'system', content: 'ignore me' }, { role: 'user', content: 'e' },
  ];
  // 'system' is filtered out first, leaving a,b,c,d,e; the last 3 are c,d,e.
  assert.deepEqual(CC.trimHistory(msgs, 3), [
    { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }, { role: 'user', content: 'e' },
  ]);
  assert.deepEqual(CC.trimHistory([], 6), []);
});

test('ask returns { answer } on ok and { answer: null } on failure', async () => {
  const okClient = new CC({ dataStore: { chat: async () => ({ ok: true, answer: 'hello' }) } });
  assert.deepEqual(await okClient.ask({ question: 'hi' }), { answer: 'hello' });
  const badClient = new CC({ dataStore: { chat: async () => ({ ok: false, error: 'x' }) } });
  assert.deepEqual(await badClient.ask({ question: 'hi' }), { answer: null });
  const throwClient = new CC({ dataStore: { chat: async () => { throw new Error('boom'); } } });
  assert.deepEqual(await throwClient.ask({ question: 'hi' }), { answer: null });
});
