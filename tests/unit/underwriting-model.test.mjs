// tests/unit/underwriting-model.test.mjs
//
// UnderwritingModel owns each Bid task's underwriting: the saved record, the
// Estimate History, the load-once/in-flight state, and the UNSAVED draft. Like
// CommentStore it lives off the Task row (the 30s poll replaces tasks wholesale),
// emits nothing, and takes all I/O by injection — so it is testable without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/models/UnderwritingCalc.js');
require('../../js/models/UnderwritingTrace.js');
require('../../js/models/UnderwritingModel.js');

const rec = (over = {}) => ({
  id: 'u1', taskId: 't1', status: 'draft', calculatedAt: null,
  roofAreaSqft: null, wastePercent: '0.00', materialCost: '0.00', laborCost: '0.00',
  otherCost: '0.00', targetMarginPercent: null, adjustedRoofAreaSqft: null, squares: null,
  totalEstimatedCost: '0.00', recommendedSalePrice: null, ...over,
});
const calculated = (over = {}) => rec({
  calculatedAt: '2026-09-30T12:00:00Z', roofAreaSqft: '2500.00', wastePercent: '10.00',
  materialCost: '8000.00', laborCost: '6000.00', otherCost: '1000.00',
  targetMarginPercent: '35.00', adjustedRoofAreaSqft: '2750.00', squares: '27.50',
  totalEstimatedCost: '15000.00', recommendedSalePrice: '23076.92', ...over,
});
const fill = (m, id, v) => Object.entries(v).forEach(([k, x]) => m.setDraftField(id, k, x));
const good = { roofAreaSqft: '2500', wastePercent: '10', materialCost: '8000', laborCost: '6000', otherCost: '1000', targetMarginPercent: '35' };

/* ---------- loading ---------- */

test('an unknown task reads empty and unloaded', () => {
  const m = new App.UnderwritingModel({ load: async () => ({ record: null, history: [] }) });
  assert.equal(m.record('t1'), null);
  assert.deepEqual(m.history('t1'), []);
  assert.equal(m.isLoaded('t1'), false);
});

test('ensureLoaded fetches once; concurrent callers share the in-flight promise', async () => {
  let calls = 0;
  const m = new App.UnderwritingModel({ load: async () => { calls++; return { record: rec(), history: [{ id: 'h1' }] }; } });
  const [a, b] = [m.ensureLoaded('t1'), m.ensureLoaded('t1')];
  await Promise.all([a, b]);
  await m.ensureLoaded('t1');
  assert.equal(calls, 1);
  assert.equal(m.isLoaded('t1'), true);
  assert.equal(m.record('t1').id, 'u1');
  assert.equal(m.history('t1').length, 1);
});

test('a failed load never rejects, stays unloaded, and retries next time', async () => {
  let n = 0;
  const m = new App.UnderwritingModel({ load: async () => { n++; if (n === 1) throw new Error('offline'); return { record: rec(), history: [] }; } });
  await m.ensureLoaded('t1');
  assert.equal(m.isLoaded('t1'), false);
  assert.ok(m.lastError('t1'));
  await m.ensureLoaded('t1');
  assert.equal(m.isLoaded('t1'), true);
  assert.equal(m.lastError('t1'), null);
});

test('refresh reports whether anything changed, and is a no-op for an unloaded entry', async () => {
  let version = 0;
  const m = new App.UnderwritingModel({ load: async () => ({ record: rec({ notes: 'v' + version }), history: [] }) });
  assert.equal(await m.refresh('t1'), false);
  await m.ensureLoaded('t1');
  assert.equal(await m.refresh('t1'), false);
  version = 1;
  assert.equal(await m.refresh('t1'), true);
});

/* ---------- draft survives the task re-render ---------- */

test('a half-typed draft is held in the model and survives a refresh', async () => {
  const m = new App.UnderwritingModel({ load: async () => ({ record: rec(), history: [] }) });
  await m.ensureLoaded('t1');
  m.setDraftField('t1', 'materialCost', '123');
  await m.refresh('t1');
  assert.equal(m.draft('t1').materialCost, '123');
  assert.equal(m.isDirty('t1'), true);
});

test('before the first calculation the draft is blank — column defaults are not presented as typed', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: rec() });
  assert.equal(m.draft('t1').wastePercent, '');
  assert.equal(m.isDirty('t1'), false);
});

test('after a calculation the draft starts from the saved inputs and is clean', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: calculated() });
  assert.equal(m.draft('t1').materialCost, '8000.00');
  assert.equal(m.isDirty('t1'), false);
  m.setDraftField('t1', 'materialCost', '8500');
  assert.equal(m.isDirty('t1'), true);
  m.discardDraft('t1');
  assert.equal(m.isDirty('t1'), false);
});

test('a reason alone does not make the form dirty', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: calculated() });
  m.setDraftField('t1', 'reason', 'supplier quote changed');
  assert.equal(m.isDirty('t1'), false);
});

/* ---------- draft validation ---------- */

test('evaluateDraft: required fields name themselves; a blank is never silently 0', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: rec() });
  const ev = m.evaluateDraft('t1');
  assert.equal(ev.ok, false);
  for (const k of ['wastePercent', 'materialCost', 'laborCost', 'otherCost', 'targetMarginPercent']) {
    assert.match(ev.errors[k], /required/, k);
  }
  assert.equal(ev.errors.roofAreaSqft, undefined, 'roof area is optional');
});

test('evaluateDraft: field-level messages for bad numbers and out-of-range margin', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: rec() });
  fill(m, 't1', { ...good, materialCost: '12.345', targetMarginPercent: '100', laborCost: '-1' });
  const ev = m.evaluateDraft('t1');
  assert.match(ev.errors.materialCost, /at most 2 decimals/);
  assert.match(ev.errors.targetMarginPercent, /less than 100%/);
  assert.match(ev.errors.laborCost, /cannot be negative/);
});

test('evaluateDraft: a valid draft returns normalised input and derived figures', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: rec() });
  fill(m, 't1', good);
  const ev = m.evaluateDraft('t1');
  assert.equal(ev.ok, true);
  assert.equal(ev.input.materialCost, '8000.00');
  assert.equal(ev.data.recommendedSalePrice, '23076.92');
});

test('a blank roof area is allowed and means "no area", not 0', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: rec() });
  fill(m, 't1', { ...good, roofAreaSqft: '' });
  const ev = m.evaluateDraft('t1');
  assert.equal(ev.ok, true);
  assert.equal(ev.input.roofAreaSqft, null);
  assert.equal(ev.data.squares, null);
});

/* ---------- writes ---------- */

test('saveDraft persists inputs + derived snapshot with the reason, then reloads', async () => {
  const sent = [];
  let current = rec();
  const m = new App.UnderwritingModel({
    load: async () => ({ record: current, history: [] }),
    saveEstimate: async (id, payload, reason) => { sent.push({ id, payload, reason }); current = calculated(); },
  });
  await m.ensureLoaded('t1');
  fill(m, 't1', { ...good, reason: '  supplier quote  ' });
  const res = await m.saveDraft('t1');
  assert.equal(res.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 'u1');
  assert.equal(sent[0].reason, 'supplier quote');
  assert.equal(sent[0].payload.data.recommendedSalePrice, '23076.92');
  assert.equal(m.record('t1').recommendedSalePrice, '23076.92');
  assert.equal(m.isDirty('t1'), false, 'draft is cleared after a successful save');
});

test('saveDraft with an invalid draft never calls the datastore', async () => {
  let called = false;
  const m = new App.UnderwritingModel({ saveEstimate: async () => { called = true; } });
  m.hydrate('t1', { record: rec() });
  const res = await m.saveDraft('t1');
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test('an approved or declined estimate refuses edits', async () => {
  for (const status of ['approved', 'declined']) {
    let called = false;
    const m = new App.UnderwritingModel({ saveEstimate: async () => { called = true; } });
    m.hydrate('t1', { record: calculated({ status }) });
    fill(m, 't1', good);
    const res = await m.saveDraft('t1');
    assert.equal(res.ok, false, status);
    assert.equal(called, false, status);
  }
});

test('a failed save keeps the draft so nothing typed is lost', async () => {
  const m = new App.UnderwritingModel({ saveEstimate: async () => { throw new Error('boom'); } });
  m.hydrate('t1', { record: rec() });
  fill(m, 't1', good);
  await assert.rejects(() => m.saveDraft('t1'), /boom/);
  assert.equal(m.draft('t1').materialCost, '8000');
});

test('transition: only allowed moves; approval needs a positive price; unsaved edits block it', async () => {
  const moves = [];
  const m = new App.UnderwritingModel({ setStatus: async (id, s, r) => { moves.push([id, s, r]); } });

  m.hydrate('t1', { record: calculated({ status: 'draft' }) });
  assert.equal((await m.transition('t1', 'approved')).ok, false, 'draft cannot jump to approved');

  m.hydrate('t1', { record: rec({ status: 'ready_for_review' }) });
  assert.equal((await m.transition('t1', 'approved')).ok, false, 'no calculated price');

  m.hydrate('t1', { record: calculated({ status: 'ready_for_review' }) });
  m.setDraftField('t1', 'materialCost', '9000');
  assert.match((await m.transition('t1', 'approved')).error, /unsaved/);
  m.discardDraft('t1');

  const ok = await m.transition('t1', 'approved', ' looks right ');
  assert.equal(ok.ok, true);
  assert.deepEqual(moves, [['u1', 'approved', 'looks right']]);
});

test('createFor stores the new record and marks it loaded', async () => {
  const m = new App.UnderwritingModel({
    create: async (taskId) => rec({ taskId }),
    load: async () => ({ record: rec(), history: [{ id: 'h0', fieldName: 'status', newValue: 'draft' }] }),
  });
  const r = await m.createFor('t1');
  assert.equal(r.id, 'u1');
  assert.equal(m.isLoaded('t1'), true);
  assert.equal(m.history('t1').length, 1);
});

/* ---------- trace comes from the SAVED record only ---------- */

test('trace is built from the saved record, never from an unsaved draft', () => {
  const m = new App.UnderwritingModel();
  m.hydrate('t1', { record: calculated() });
  m.setDraftField('t1', 'materialCost', '99999');
  const total = m.trace('t1').find(s => s.key === 'total_estimated_cost');
  assert.equal(total.result, '$15000.00');
});
