// tests/unit/underwriting-trace.test.mjs
//
// The Estimate Breakdown must show, for every calculated figure, its inputs,
// formula, worked calculation, result, rounding and source — and must never
// fabricate a source. The trace is built only from the SAVED record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/models/UnderwritingCalc.js');
require('../../js/models/UnderwritingTrace.js');

const saved = {
  roofAreaSqft: '2500.00', wastePercent: '10.00', materialCost: '8000.00',
  laborCost: '6000.00', otherCost: '1000.00', targetMarginPercent: '35.00',
  adjustedRoofAreaSqft: '2750.00', squares: '27.50',
  totalEstimatedCost: '15000.00', recommendedSalePrice: '23076.92',
};
const never = {
  roofAreaSqft: null, wastePercent: '0.00', materialCost: '0.00', laborCost: '0.00',
  otherCost: '0.00', targetMarginPercent: null, adjustedRoofAreaSqft: null,
  squares: null, totalEstimatedCost: '0.00', recommendedSalePrice: null,
};
const byKey = (steps) => Object.fromEntries(steps.map(s => [s.key, s]));

test('exposes every required line, in order', () => {
  const keys = App.UnderwritingTrace.build(saved).map(s => s.key);
  assert.deepEqual(keys, [
    'base_roof_area', 'waste_percent', 'waste_added_area', 'adjusted_roof_area', 'squares',
    'material_cost', 'labor_cost', 'other_cost', 'total_estimated_cost',
    'target_margin_percent', 'recommended_sale_price', 'gross_profit',
    'achieved_margin_verification',
  ]);
});

test('adjusted roof area: inputs, formula, worked calculation, result, rounding, source', () => {
  const s = byKey(App.UnderwritingTrace.build(saved)).adjusted_roof_area;
  assert.deepEqual(s.inputs, [
    { label: 'Base roof area', value: '2500.00 sqft' },
    { label: 'Waste %', value: '10.00%' },
  ]);
  assert.equal(s.formula, 'Adjusted Roof Area = Base Roof Area × (1 + Waste % / 100)');
  assert.deepEqual(s.calculationLines, ['2500.00 sqft × (1 + 10.00 / 100)', '= 2750.00 sqft']);
  assert.equal(s.result, '2750.00 sqft');
  assert.match(s.roundingNote, /half-up/);
  assert.equal(s.source, 'calculated');
});

test('waste-added area reconciles exactly: base + added = adjusted', () => {
  const s = byKey(App.UnderwritingTrace.build(saved)).waste_added_area;
  assert.equal(s.result, '250.00 sqft');
  assert.equal(s.source, 'calculated');
});

test('recommended sale price shows the margin as a fraction, built without floats', () => {
  const s = byKey(App.UnderwritingTrace.build(saved)).recommended_sale_price;
  assert.equal(s.formula, 'Sale Price = Cost / (1 − Margin)');
  assert.deepEqual(s.calculationLines, [
    '$15000.00 / (1 − 0.3500)', '= $15000.00 / 0.6500', '= $23076.92',
  ]);
  assert.match(s.roundingNote, /cent, half-up/);
});

test('small margins render a leading zero (5.00% -> 0.0500)', () => {
  const u = { ...saved, targetMarginPercent: '5.00', recommendedSalePrice: '15789.47' };
  const s = byKey(App.UnderwritingTrace.build(u)).recommended_sale_price;
  assert.equal(s.calculationLines[0], '$15000.00 / (1 − 0.0500)');
  assert.equal(s.calculationLines[1], '= $15000.00 / 0.9500');
});

test('gross profit and achieved-margin verification', () => {
  const t = byKey(App.UnderwritingTrace.build(saved));
  assert.equal(t.gross_profit.result, '$8076.92');
  const v = t.achieved_margin_verification;
  assert.equal(v.verified, true);
  assert.match(v.result, /35\.00% achieved \(target 35\.00%\) — Verified ✓/);
});

test('a stored price that the formula would not produce is flagged, not hidden', () => {
  const t = byKey(App.UnderwritingTrace.build({ ...saved, recommendedSalePrice: '24000.00' }));
  assert.equal(t.achieved_margin_verification.verified, false);
  assert.match(t.achieved_margin_verification.result, /Mismatch ✗/);
});

test('inputs are labelled "manual" only after a real calculation save', () => {
  const t = byKey(App.UnderwritingTrace.build(saved));
  for (const k of ['base_roof_area', 'waste_percent', 'material_cost', 'labor_cost', 'other_cost', 'target_margin_percent']) {
    assert.equal(t[k].source, 'manual', k);
  }
});

test('never fabricates a source: untouched column defaults are "not_entered", not "manual"', () => {
  const steps = App.UnderwritingTrace.build(never);
  for (const s of steps) {
    assert.equal(s.source, 'not_entered', s.key);
    assert.equal(s.result, 'Not entered', s.key);
  }
});

test('V1 source labels are available while legacy records still use only their real sources)', () => {
  assert.deepEqual(Object.keys(App.UnderwritingTrace.SOURCE_LABELS).sort(),
    ['calculated', 'gaf_report', 'manual', 'not_entered', 'underwriter_override']);
  const used = new Set(App.UnderwritingTrace.build(saved).map(s => s.source));
  for (const s of used) assert.ok(['manual', 'calculated', 'not_entered'].includes(s));
});

test('no roof area: area steps read "Not entered" but the cost chain still derives', () => {
  const t = byKey(App.UnderwritingTrace.build({
    ...saved, roofAreaSqft: null, adjustedRoofAreaSqft: null, squares: null,
  }));
  assert.equal(t.adjusted_roof_area.result, 'Not entered');
  assert.equal(t.squares.result, 'Not entered');
  assert.equal(t.total_estimated_cost.source, 'calculated');
  assert.equal(t.recommended_sale_price.result, '$23076.92');
});

test('a $0 sale price reports n/a rather than dividing by zero', () => {
  const u = { ...saved, materialCost: '0.00', laborCost: '0.00', otherCost: '0.00',
    totalEstimatedCost: '0.00', recommendedSalePrice: '0.00' };
  const v = byKey(App.UnderwritingTrace.build(u)).achieved_margin_verification;
  assert.match(v.result, /n\/a/);
});
