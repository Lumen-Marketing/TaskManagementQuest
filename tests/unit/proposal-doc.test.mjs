// tests/unit/proposal-doc.test.mjs
//
// The customer proposal renders from a PROPOSAL row only. For the sprint scenario
// (roof 2000, waste 10%, material 8000, labor 4000, other 1000, margin 30% ->
// approved price 18,571.43) it must show the price and NONE of the internal figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/models/UnderwritingCalc.js');
require('../../js/models/ProposalDoc.js');

const D = App.ProposalDoc;
const proposal = {
  number: 7, companyName: 'Roofing', clientName: 'CNL Properties', projectName: 'Paradise Valley re-roof',
  jobAddress: '1 Main St, Phoenix AZ', title: 'Re-roof proposal', scopeOfWork: 'Tear off & replace <b>all</b> shingles.',
  terms: 'Net 15', total: '18571.43', createdAt: '2026-10-01T12:00:00Z',
};

test('sprint scenario: engine price is what the proposal shows', () => {
  const r = App.UnderwritingCalc.calculate({
    roofAreaSqft: '2000.00', wastePercent: '10.00', materialCost: '8000.00', laborCost: '4000.00',
    otherCost: '1000.00', targetMarginPercent: '30.00',
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.recommendedSalePrice, '18571.43');
  assert.equal(D.money(r.data.recommendedSalePrice), '$18,571.43');
});

test('document shows number, price, client, job and signature lines', () => {
  const h = D.documentHtml(proposal);
  for (const s of ['PRO-0007', '$18,571.43', 'CNL Properties', 'Paradise Valley re-roof', '1 Main St, Phoenix AZ',
    'Re-roof proposal', 'Net 15', 'Customer signature']) assert.ok(h.includes(s), 'missing ' + s);
});

test('document exposes no internal cost or margin detail', () => {
  const h = D.documentHtml(proposal);
  assert.doesNotMatch(h, /13,?000|8,?000|4,?000|1,?000\.|margin|markup|cost|labor cost|material cost|30%|underwriting/i);
});

test('user text is escaped', () => {
  const h = D.documentHtml(proposal);
  assert.ok(!h.includes('<b>all</b>'));
  assert.ok(h.includes('&lt;b&gt;all&lt;/b&gt;'));
});

test('helpers', () => {
  assert.equal(D.numberLabel(1), 'PRO-0001');
  assert.equal(D.numberLabel(12345), 'PRO-12345');
  assert.equal(D.money('1234567.5'), '$1,234,567.5');
  assert.equal(D.money(null), '—');
  const d = D.defaults({ projectName: 'X', jobAddress: 'Y' });
  assert.equal(d.title, 'Proposal — X');
  assert.match(d.scopeOfWork, /at Y/);
});
