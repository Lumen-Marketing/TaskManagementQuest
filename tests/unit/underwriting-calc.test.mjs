// tests/unit/underwriting-calc.test.mjs
//
// UnderwritingCalc is the estimate engine: BigInt "hundredths" arithmetic with
// one explicit half-up rounding rule. These pin the four formulas, the rounding
// edges, and the validation. The same equations are enforced by CHECK
// constraints in migration 073, so a drift here is a drift against the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/models/UnderwritingCalc.js');
const C = App.UnderwritingCalc;

const base = {
  roofAreaSqft: '2500', wastePercent: '10', materialCost: '8000',
  laborCost: '6000', otherCost: '1000', targetMarginPercent: '35',
};

/* ---------- fixed-point helpers ---------- */

test('parseToHundredths / hundredthsToString round-trip and pad', () => {
  assert.equal(C.parseToHundredths('12.3'), BigInt(1230));
  assert.equal(C.parseToHundredths(5), BigInt(500));
  assert.equal(C.parseToHundredths('-0.05'), BigInt(-5));
  assert.equal(C.hundredthsToString(BigInt(5)), '0.05');
  assert.equal(C.hundredthsToString(BigInt(-1205)), '-12.05');
});

test('parseToHundredths rejects malformed input instead of coercing it', () => {
  for (const bad of ['', 'abc', '1.234', '1,000', '1e3', ' ', '--1']) {
    assert.throws(() => C.parseToHundredths(bad), /Invalid decimal/, JSON.stringify(bad));
  }
});

test('divideRoundHalfUp rounds ties away from zero, in integers', () => {
  assert.equal(C.divideRoundHalfUp(BigInt(5), BigInt(2)), BigInt(3));
  assert.equal(C.divideRoundHalfUp(BigInt(-5), BigInt(2)), BigInt(-3));
  assert.equal(C.divideRoundHalfUp(BigInt(4), BigInt(3)), BigInt(1));
  assert.equal(C.divideRoundHalfUp(BigInt(2), BigInt(3)), BigInt(1));
  assert.throws(() => C.divideRoundHalfUp(BigInt(1), BigInt(0)), /Division by zero/);
});

/* ---------- the calculation ---------- */

test('golden case: every derived figure', () => {
  const r = C.calculate(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, {
    adjustedRoofAreaSqft: '2750.00',
    squares: '27.50',
    totalEstimatedCost: '15000.00',
    recommendedSalePrice: '23076.92', // 15000 / 0.65 = 23076.923…
  });
});

test('gross profit and achieved margin follow from the stored figures', () => {
  const gp = C.grossProfit('23076.92', '15000.00');
  assert.equal(gp, '8076.92');
  assert.equal(C.achievedMarginPercent(gp, '23076.92'), '35.00');
});

test('roof area is optional: no area -> no adjusted area / squares, price still computed', () => {
  const r = C.calculate({ ...base, roofAreaSqft: null });
  assert.equal(r.ok, true);
  assert.equal(r.data.adjustedRoofAreaSqft, null);
  assert.equal(r.data.squares, null);
  assert.equal(r.data.recommendedSalePrice, '23076.92');
});

test('area rounding is half-up, and squares come from the UNROUNDED area', () => {
  // 0.01 sqft at 50% waste = 0.015 sqft exactly -> tie -> 0.02; squares 0.00015 -> 0.00
  let r = C.calculate({ ...base, roofAreaSqft: '0.01', wastePercent: '50' });
  assert.equal(r.data.adjustedRoofAreaSqft, '0.02');
  assert.equal(r.data.squares, '0.00');
  // 1234.56 sqft at 7.25% waste: adjusted = 1324.0656 -> 1324.07; squares = 13.240656 -> 13.24
  r = C.calculate({ ...base, roofAreaSqft: '1234.56', wastePercent: '7.25' });
  assert.equal(r.data.adjustedRoofAreaSqft, '1324.07');
  assert.equal(r.data.squares, '13.24');
  // 49.50 sqft, 0% waste -> 49.50 / 100 = 0.495 -> tie -> 0.50
  r = C.calculate({ ...base, roofAreaSqft: '49.50', wastePercent: '0' });
  assert.equal(r.data.squares, '0.50');
});

test('sale price rounds half-up to the cent (exact tie: $0.01 at 60% -> $0.025 -> $0.03)', () => {
  const r = C.calculate({ ...base, materialCost: '0.01', laborCost: '0', otherCost: '0', targetMarginPercent: '60' });
  assert.equal(r.data.totalEstimatedCost, '0.01');
  assert.equal(r.data.recommendedSalePrice, '0.03');
});

test('large values stay exact (no float round-trip)', () => {
  const r = C.calculate({ ...base, roofAreaSqft: '99999999.99', wastePercent: '9999.99',
    materialCost: '9999999999.99', laborCost: '0', otherCost: '0', targetMarginPercent: '99.99' });
  assert.equal(r.ok, true);
  assert.equal(r.data.totalEstimatedCost, '9999999999.99');
  // 9999999999.99 / 0.0001 = 99999999999900.00 exactly
  assert.equal(r.data.recommendedSalePrice, '99999999999900.00');
});

test('validation: margin bounds, negatives, malformed', () => {
  assert.match(C.calculate({ ...base, targetMarginPercent: '0' }).error, /greater than 0%/);
  assert.match(C.calculate({ ...base, targetMarginPercent: '100' }).error, /less than 100%/);
  assert.match(C.calculate({ ...base, wastePercent: '-1' }).error, /Waste percent cannot be negative/);
  assert.match(C.calculate({ ...base, laborCost: '-5' }).error, /Costs cannot be negative/);
  assert.match(C.calculate({ ...base, roofAreaSqft: '-1' }).error, /Roof area cannot be negative/);
  assert.equal(C.calculate({ ...base, materialCost: '12.345' }).ok, false);
});

test('verifyRecommendedSalePrice recomputes through the one real formula', () => {
  assert.deepEqual(C.verifyRecommendedSalePrice(base, '23076.92'),
    { verified: true, recomputedSalePrice: '23076.92' });
  assert.deepEqual(C.verifyRecommendedSalePrice(base, '23076.93'),
    { verified: false, recomputedSalePrice: '23076.92' });
  // numeric normalisation: "23076.9200" / number forms still verify
  assert.equal(C.verifyRecommendedSalePrice(base, 23076.92).verified, true);
});

test('achieved margin is null (not NaN / Infinity) when the sale price is $0', () => {
  assert.equal(C.achievedMarginPercent('0.00', '0.00'), null);
});

/* ---------- status rules ---------- */

test('status transitions match the database trigger', () => {
  assert.deepEqual(C.allowedNextStatuses('draft'), ['ready_for_review']);
  assert.deepEqual(C.allowedNextStatuses('ready_for_review'), ['approved', 'declined', 'draft']);
  assert.deepEqual(C.allowedNextStatuses('approved'), []);
  assert.deepEqual(C.allowedNextStatuses('declined'), ['draft']);
});

test('only draft / ready_for_review are editable', () => {
  assert.equal(C.isEditable('draft'), true);
  assert.equal(C.isEditable('ready_for_review'), true);
  assert.equal(C.isEditable('approved'), false);
  assert.equal(C.isEditable('declined'), false);
});

test('approval needs a positive calculated price', () => {
  assert.equal(C.canApprove(null), false);
  assert.equal(C.canApprove('0.00'), false);
  assert.equal(C.canApprove('0.01'), true);
  assert.equal(C.canApprove('junk'), false);
});
