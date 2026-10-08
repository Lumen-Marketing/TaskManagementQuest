window.App = window.App || {};

/* UnderwritingCalc — the estimate engine. Pure functions, no DOM, no clock, no
   time zone: it runs identically in the browser and in node (tests/unit).

   Every amount, area and percent is a `numeric(_, 2)` in the database, so all
   arithmetic is done on BigInt "hundredths" (value * 100). Chained multiply /
   divide steps (area-hundredths * percent-hundredths) therefore never pass
   through a float, and rounding is one explicit rule — half-up, in integers —
   not whatever Math.round does to an already-lossy quotient. Results are decimal
   STRINGS, which Postgres numeric accepts directly; a JS number is never
   round-tripped to the database.

   The formulas (the database CHECK constraints in migration 073 encode the same
   four equations, so a stored figure can never disagree with its stored inputs):
     adjusted_roof_area = roof_area * (1 + waste / 100)
     squares            = adjusted_roof_area / 100          (from the UNROUNDED area)
     total_cost         = material + labor + other
     sale_price         = total_cost / (1 - margin / 100)
   Ported from the novum-quest-ops reference implementation (read-only donor). */
App.UnderwritingCalc = (function () {
  const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const TEN_THOUSAND = BigInt(10000);
  const ONE_MILLION = BigInt(1000000);

  /* ---------- fixed-point helpers ---------- */

  // Throws on malformed input (wrong shape, >2 fractional digits) rather than
  // silently coercing it — callers turn the throw into a field-level error.
  function parseToHundredths(value) {
    const str = typeof value === 'number' ? String(value) : String(value).trim();
    if (!DECIMAL_PATTERN.test(str)) throw new Error('Invalid decimal value: "' + value + '"');
    const negative = str.startsWith('-');
    const unsigned = negative ? str.slice(1) : str;
    const parts = unsigned.split('.');
    const frac = ((parts[1] || '') + '00').slice(0, 2);
    const h = BigInt(parts[0]) * HUNDRED + BigInt(frac);
    return negative ? -h : h;
  }

  function hundredthsToString(h) {
    const negative = h < ZERO;
    const abs = negative ? -h : h;
    const whole = abs / HUNDRED;
    const frac = abs % HUNDRED;
    return (negative ? '-' : '') + whole.toString() + '.' + frac.toString().padStart(2, '0');
  }

  // Round a bigint ratio to the nearest integer, ties away from zero ("half-up").
  function divideRoundHalfUp(numerator, denominator) {
    if (denominator === ZERO) throw new Error('Division by zero.');
    const negative = (numerator < ZERO) !== (denominator < ZERO);
    const n = numerator < ZERO ? -numerator : numerator;
    const d = denominator < ZERO ? -denominator : denominator;
    const q = n / d;
    const r = n % d;
    const rounded = r * BigInt(2) >= d ? q + BigInt(1) : q;
    return negative ? -rounded : rounded;
  }

  // PostgREST may hand back a numeric as a JSON number or a string.
  function normalizeNumeric(value) {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'number' ? String(value) : String(value);
  }

  /* ---------- status rules ---------- */

  const STATUSES = ['draft', 'ready_for_review', 'approved', 'declined'];
  const STATUS_LABELS = {
    draft: 'Draft',
    ready_for_review: 'Ready for review',
    approved: 'Approved',
    declined: 'Declined',
  };
  const TRANSITIONS = {
    draft: ['ready_for_review'],
    ready_for_review: ['approved', 'declined', 'draft'],
    approved: [],
    declined: ['draft'],
  };

  // Inputs are editable only before a decision. Mirrors guard_underwriting_update().
  function isEditable(status) { return status === 'draft' || status === 'ready_for_review'; }
  function allowedNextStatuses(status) { return (TRANSITIONS[status] || []).slice(); }

  // Approval needs a computed, positive recommended sale price.
  function canApprove(recommendedSalePrice) {
    if (recommendedSalePrice === null || recommendedSalePrice === undefined) return false;
    try { return parseToHundredths(recommendedSalePrice) > ZERO; } catch (e) { return false; }
  }

  /* ---------- the calculation ---------- */

  /* input: { roofAreaSqft|null, wastePercent, materialCost, laborCost, otherCost,
              targetMarginPercent } — all decimal strings/numbers.
     Returns { ok: true, data: { adjustedRoofAreaSqft|null, squares|null,
              totalEstimatedCost, recommendedSalePrice } } or { ok: false, error }. */
  function calculate(input) {
    try {
      const waste = parseToHundredths(input.wastePercent);
      if (waste < ZERO) return { ok: false, error: 'Waste percent cannot be negative.' };

      const margin = parseToHundredths(input.targetMarginPercent);
      if (margin <= ZERO) return { ok: false, error: 'Target margin must be greater than 0%.' };
      if (margin >= TEN_THOUSAND) return { ok: false, error: 'Target margin must be less than 100%.' };

      const material = parseToHundredths(input.materialCost);
      const labor = parseToHundredths(input.laborCost);
      const other = parseToHundredths(input.otherCost);
      if (material < ZERO || labor < ZERO || other < ZERO) {
        return { ok: false, error: 'Costs cannot be negative.' };
      }

      let adjustedRoofAreaSqft = null;
      let squares = null;
      if (input.roofAreaSqft !== null && input.roofAreaSqft !== undefined) {
        const area = parseToHundredths(input.roofAreaSqft);
        if (area < ZERO) return { ok: false, error: 'Roof area cannot be negative.' };
        // area_h * (10000 + waste_h) is hundredths * 10^4-scaled factor.
        const numerator = area * (TEN_THOUSAND + waste);
        adjustedRoofAreaSqft = hundredthsToString(divideRoundHalfUp(numerator, TEN_THOUSAND));
        // Squares come from the UNROUNDED numerator, not the rounded area, so the
        // rounding is applied once, not compounded.
        squares = hundredthsToString(divideRoundHalfUp(numerator, ONE_MILLION));
      }

      const total = material + labor + other;
      const price = divideRoundHalfUp(total * TEN_THOUSAND, TEN_THOUSAND - margin);

      return {
        ok: true,
        data: {
          adjustedRoofAreaSqft,
          squares,
          totalEstimatedCost: hundredthsToString(total),
          recommendedSalePrice: hundredthsToString(price),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid input.' };
    }
  }

  // gross_profit = sale price - total cost (plain subtraction of two stored,
  // already-rounded amounts; introduces no rounding of its own).
  function grossProfit(recommendedSalePrice, totalEstimatedCost) {
    return hundredthsToString(parseToHundredths(recommendedSalePrice) - parseToHundredths(totalEstimatedCost));
  }

  // The margin the stored numbers actually represent, as a percent to 2dp.
  // null when the sale price is 0 — nothing to divide by.
  function achievedMarginPercent(gross, recommendedSalePrice) {
    const price = parseToHundredths(recommendedSalePrice);
    if (price <= ZERO) return null;
    return hundredthsToString(divideRoundHalfUp(parseToHundredths(gross) * TEN_THOUSAND, price));
  }

  /* Recompute the sale price from the stored inputs through calculate() — the one
     real formula — and compare with the stored value. Not a tolerance check and
     not an independent reimplementation that could drift: a mismatch means the
     stored figure is NOT what the formula yields for those inputs. */
  function verifyRecommendedSalePrice(input, storedRecommendedSalePrice) {
    const r = calculate(input);
    if (!r.ok) return { verified: false, recomputedSalePrice: null };
    let stored;
    try { stored = hundredthsToString(parseToHundredths(storedRecommendedSalePrice)); }
    catch (e) { return { verified: false, recomputedSalePrice: r.data.recommendedSalePrice }; }
    return { verified: r.data.recommendedSalePrice === stored, recomputedSalePrice: r.data.recommendedSalePrice };
  }

  const api = {
    STATUSES, STATUS_LABELS, isEditable, allowedNextStatuses, canApprove,
    parseToHundredths, hundredthsToString, divideRoundHalfUp, normalizeNumeric,
    calculate, grossProfit, achievedMarginPercent, verifyRecommendedSalePrice,
  };
  return api;
})();

/* Node test harness (tests/unit) requires this file directly. */
if (typeof module !== 'undefined' && module.exports) module.exports = { UnderwritingCalc: App.UnderwritingCalc };
