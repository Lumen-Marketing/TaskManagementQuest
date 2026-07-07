import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PersistenceEngine } = require('../../js/services/PersistenceEngine.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* Fake adapter: the seam's second adapter. Records every write's snapshot and
   lets each test resolve/reject writes manually, in order. */
function makeFake() {
  const writes = [];   // { snapshot, resolve, reject, settled }
  const write = (snapshot) => new Promise((resolve, reject) => {
    const w = { snapshot, settled: false };
    w.resolve = (v) => { w.settled = true; resolve(v); };
    w.reject = (e) => { w.settled = true; reject(e); };
    writes.push(w);
  });
  return { writes, write };
}

function makeEngine(fake, overrides = {}) {
  const events = [];
  const engine = new PersistenceEngine({
    debounceMs: 5,
    takeSnapshot: () => ({ n: events.length }),
    write: fake.write,
    onSuccess: (r) => events.push(['success', r]),
    onFailure: (e, s) => events.push(['failure', e, s]),
    ...overrides,
  });
  return { engine, events };
}

test('debounce: N schedule() calls coalesce into one write', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.schedule(); engine.schedule(); engine.schedule();
  await tick(20);
  assert.equal(fake.writes.length, 1);
  fake.writes[0].resolve({});
  await tick(1);
});

test('single-flight: requests during an in-flight save collapse into ONE re-run', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.flush();                    // write 1 starts, unresolved
  await tick(1);
  engine.flush(); engine.flush();    // both while in flight
  await tick(1);
  assert.equal(fake.writes.length, 1, 'no overlap while in flight');
  fake.writes[0].resolve({});
  await tick(5);
  assert.equal(fake.writes.length, 2, 'exactly one coalesced re-run');
  fake.writes[1].resolve({});
  await tick(1);
});

test('REGRESSION (worker-notify race): saveNow resolves only after a save that snapshotted the edit', async () => {
  const fake = makeFake();
  let data = 'old';
  const { engine } = makeEngine(fake, { takeSnapshot: () => ({ data }) });
  engine.flush();                    // write 1 snapshots 'old', unresolved
  await tick(1);
  data = 'new-task';                 // the edit createTask just made
  let saveNowDone = false;
  const p = engine.saveNow().then((ok) => { saveNowDone = true; return ok; });
  await tick(5);
  assert.equal(saveNowDone, false, 'must NOT resolve on the stale in-flight save');
  fake.writes[0].resolve({});        // stale save settles
  await tick(5);
  assert.equal(fake.writes.length, 2, 'barrier forced a re-run');
  assert.equal(fake.writes[1].snapshot.data, 'new-task', 're-run snapshotted the edit');
  fake.writes[1].resolve({});
  assert.equal(await p, true, 'resolves true once the qualifying save lands');
});

test('saveNow when idle: starts a save immediately and resolves with its outcome', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  const p = engine.saveNow();
  await tick(1);
  assert.equal(fake.writes.length, 1);
  fake.writes[0].resolve({});
  assert.equal(await p, true);
});

test('failure: onFailure gets (err, snapshot); saveNow resolves false; next flush retries', async () => {
  const fake = makeFake();
  const { engine, events } = makeEngine(fake, { takeSnapshot: () => ({ rows: [1] }) });
  const p = engine.saveNow();
  await tick(1);
  fake.writes[0].reject(new Error('boom'));
  assert.equal(await p, false);
  const failure = events.find((e) => e[0] === 'failure');
  assert.ok(failure, 'onFailure called');
  assert.deepEqual(failure[2], { rows: [1] }, 'failure handler receives the snapshot for re-flagging');
  engine.flush();
  await tick(1);
  assert.equal(fake.writes.length, 2, 'engine is not wedged after a failure');
  fake.writes[1].resolve({});
  await tick(1);
});

test('success: onSuccess receives the adapter result (conflicts flow through)', async () => {
  const fake = makeFake();
  const { engine, events } = makeEngine(fake);
  engine.flush();
  await tick(1);
  fake.writes[0].resolve({ conflicts: [{ id: 't1' }] });
  await tick(1);
  const success = events.find((e) => e[0] === 'success');
  assert.deepEqual(success[1], { conflicts: [{ id: 't1' }] });
});

test('cancelPending: a scheduled save is dropped', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.schedule();
  engine.cancelPending();
  await tick(20);
  assert.equal(fake.writes.length, 0);
});
