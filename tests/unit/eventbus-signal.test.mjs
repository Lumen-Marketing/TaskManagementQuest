import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeEventBus } = require('../../js/EventBus.js');

test('on() without signal: handler fires on emit', () => {
  const bus = makeEventBus();
  const calls = [];
  bus.on('x', v => calls.push(v));
  bus.emit('x', 1);
  assert.deepEqual(calls, [1]);
});

test('on() with signal: handler fires before abort', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  bus.emit('x', 1);
  assert.deepEqual(calls, [1]);
});

test('on() with signal: handler does NOT fire after abort', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  ac.abort();
  bus.emit('x', 2);
  assert.deepEqual(calls, []);
});

test('on() with signal: aborting one controller does not remove other listeners', () => {
  const bus = makeEventBus();
  const ac1 = new AbortController();
  const calls1 = [], calls2 = [];
  bus.on('x', v => calls1.push(v), { signal: ac1.signal });
  bus.on('x', v => calls2.push(v));
  ac1.abort();
  bus.emit('x', 3);
  assert.deepEqual(calls1, []);
  assert.deepEqual(calls2, [3]);
});

test('on() with already-aborted signal: handler never fires', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  ac.abort();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  bus.emit('x', 4);
  assert.deepEqual(calls, []);
});

test('return value is still an unsub function when signal is passed', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  const unsub = bus.on('x', v => calls.push(v), { signal: ac.signal });
  unsub();
  bus.emit('x', 5);
  assert.deepEqual(calls, []);
});
