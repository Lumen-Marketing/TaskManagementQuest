import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal browser globals mock so Directory.js can load in Node.js
globalThis.window = globalThis;
globalThis.App = {};
const { personFallback, companyFallback } = require('../../js/Directory.js');

test('personFallback: known id — uses id as name', () => {
  const p = personFallback('user-99');
  assert.equal(p.id, 'user-99');
  assert.equal(p.name, 'user-99');
  assert.equal(p.full, 'user-99');
  assert.equal(p.color, '#E8A03A');
});

test('personFallback: null id — Unassigned', () => {
  const p = personFallback(null);
  assert.equal(p.name, 'Unassigned');
  assert.equal(p.full, 'Unassigned');
});

test('personFallback: undefined id — Unassigned', () => {
  const p = personFallback(undefined);
  assert.equal(p.name, 'Unassigned');
  assert.equal(p.full, 'Unassigned');
});

test('companyFallback: known id — uses id as label', () => {
  const c = companyFallback('roofing');
  assert.equal(c.id, 'roofing');
  assert.equal(c.label, 'roofing');
  assert.equal(c.color, 'var(--ink-3)');
});

test('companyFallback: null id — Unknown', () => {
  const c = companyFallback(null);
  assert.equal(c.label, 'Unknown');
  assert.equal(c.color, 'var(--ink-3)');
});
