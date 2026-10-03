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

  // Whole-report/order figures are deliberately separate from migration 073's
  // decimal adjusted area and fractional squares. Never repurpose those columns.
  function orderQuantity(area, waste) {
    const a = parseToHundredths(area), w = parseToHundredths(waste);
    if (a <= ZERO || w < ZERO) throw new Error('Positive roof area and nonnegative waste are required.');
    const numerator = a * (TEN_THOUSAND + w);
    return { adjustedAreaSqft: divideRoundHalfUp(numerator, BigInt(1000000)).toString(),
      orderSquares: ((numerator + BigInt(99999999)) / BigInt(100000000)).toString() };
  }

  function calculateWorkflow(workflow, selectedWaste) {
    const importedRoof = App.RoofMeasurement.normalize(workflow.measurement);
    const roof = workflow.measurementOverrides?.roofAreaSqft != null
      ? App.RoofMeasurement.normalize({ ...importedRoof, roofAreaSqft: workflow.measurementOverrides.roofAreaSqft }) : importedRoof;
    const waste = parseToHundredths(selectedWaste);
    const calculatedOrder = orderQuantity(roof.roofAreaSqft, selectedWaste);
    const reportOrder = !workflow.measurementOverrides?.roofAreaSqft
      && roof.reportWasteTable.find(row => parseToHundredths(row.wastePercent) === waste);
    // PDF summary values were rounded by the report provider before import.
    // Preserve its printed waste table; rounded base SF cannot recover hidden precision.
    const order = reportOrder ? { adjustedAreaSqft: (parseToHundredths(reportOrder.adjustedAreaSqft) / HUNDRED).toString(),
      orderSquares: (parseToHundredths(reportOrder.orderSquares) / HUNDRED).toString() } : calculatedOrder;
    const scope = App.RoofMeasurement.pitchScope(roof);
    const formulas = App.RoofMeasurement.geometry(roof);
    const length = k => roof.reportedAccessories[k] ?? formulas[k];
    const ceilCoverage = (area, coverage, applyWaste = true) => {
      if (area == null) return null;
      const n = parseToHundredths(area) * (applyWaste ? TEN_THOUSAND + waste : TEN_THOUSAND);
      const d = parseToHundredths(coverage) * TEN_THOUSAND;
      return ((n + d - 1n) / d).toString();
    };
    const derived = {
      shingles: ceilCoverage(scope.shingleSqft, '32.80'),
      deckProtection: ceilCoverage(roof.roofAreaSqft, '1000'),
      starter: ceilCoverage(length('starter'), '120'),
      ridgeCap: ceilCoverage(length('ridgeCap'), '25'),
      dripEdge: ceilCoverage(length('dripEdge'), '10'),
      leakBarrier: length('leakBarrier') == null ? null : ceilCoverage(
        hundredthsToString(parseToHundredths(length('leakBarrier')) * 3n), '200'),
      lowSlopeBase: ceilCoverage(scope.lowSlopeSqft, '200'),
      lowSlopeCap: ceilCoverage(scope.lowSlopeSqft, '100'),
    };
    derived.stepFlashing = ceilCoverage(roof.lengths.step, '10');
    ['coilNails','capNails'].forEach(key => {
      const recommendation = roof.materialRecommendations.find(r => r.key === key && parseToHundredths(r.wastePercent) === waste);
      derived[key] = recommendation?.quantity ?? null;
    });
    const defaults = [
      ['shingles','Timberline HDZ','bundle'], ['deckProtection','Deck protection 10 SQ','roll'],
      ['starter','Pro-Start 120 FT','bundle'], ['ridgeCap','Seal-A-Ridge 25 FT','bundle'],
      ['dripEdge','Drip edge 10 FT','piece'], ['leakBarrier','Leak barrier 2 SQ','roll'],
      ['lowSlopeBase','Low-slope base 2 SQ','roll'], ['lowSlopeCap','Low-slope cap 1 SQ','roll'],
      ['coilNails','Coil nails 1.25 inch','box'], ['capNails','Cap nails','box'], ['stepFlashing','Step flashing 10 FT','piece'],
    ];
    const nonnegative = (v, label) => {
      const n = parseToHundredths(v);
      if (n < ZERO) throw new Error(label + ' cannot be negative.');
      return n;
    };
    const lines = defaults.map(([key,name,unit]) => {
      const input = workflow.materials?.[key] || {};
      const overridden = input.quantity !== '' && input.quantity != null;
      if (input.product && input.product !== name && !overridden) throw new Error('Confirm quantity for the selected '+input.product+' product.');
      const quantity = overridden ? hundredthsToString(nonnegative(input.quantity, name + ' quantity')) : derived[key];
      const price = input.unitPrice === '' || input.unitPrice == null ? null : hundredthsToString(nonnegative(input.unitPrice, name + ' price'));
      const total = quantity == null || price == null ? null : hundredthsToString(divideRoundHalfUp(parseToHundredths(quantity) * parseToHundredths(price), HUNDRED));
      return { key, product: input.product || name, unit, quantity, unitPrice: price, total, overridden,
        source: overridden ? 'underwriter_override' : (['coilNails','capNails'].includes(key) && derived[key] != null ? 'gaf_report' : 'calculated'), supplier: input.supplier || '', pricedAt: input.pricedAt || '',
        rule: 'gaf-guidance-v1', coverageQuantity: derived[key] };
    });
    const priced = lines.every(l => l.quantity != null && (parseToHundredths(l.quantity) === ZERO || l.total != null));
    const material = lines.reduce((n,l) => n + (l.total == null ? ZERO : parseToHundredths(l.total)), ZERO);
    const tax = nonnegative(workflow.taxPercent ?? '8.5', 'Tax');
    if (tax > TEN_THOUSAND) throw new Error('Tax must not exceed 100%.');
    const taxed = material + divideRoundHalfUp(material * tax, TEN_THOUSAND);
    const laborRate = workflow.laborRate === '' || workflow.laborRate == null ? null : nonnegative(workflow.laborRate, 'Labor rate');
    const labor = laborRate == null ? ZERO : BigInt(order.orderSquares) * laborRate;
    const jobCosts = Object.entries(workflow.jobCosts || {}).map(([key,value]) => ({ key, amount: hundredthsToString(nonnegative(value || '0', key)) }));
    const other = jobCosts.reduce((n,c) => n + parseToHundredths(c.amount), ZERO);
    const quote = nonnegative(workflow.clientPrice || '0', 'Client price');
    const commissionRate = nonnegative(workflow.commissionPercent ?? '10', 'Commission');
    const overheadRate = nonnegative(workflow.overheadPercent ?? '0', 'Overhead');
    if (commissionRate + overheadRate >= TEN_THOUSAND) throw new Error('Commission plus overhead must be less than 100%.');
    const commission = divideRoundHalfUp(quote * commissionRate, TEN_THOUSAND);
    const overhead = divideRoundHalfUp(quote * overheadRate, TEN_THOUSAND);
    const hard = taxed + labor + other, gross = quote - hard, net = gross - commission - overhead;
    const netMargin = quote > ZERO ? hundredthsToString(divideRoundHalfUp(net * TEN_THOUSAND, quote)) : null;
    const evidence = workflow.review || {};
    const validPriceDate = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(value+'T00:00:00Z');
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
    };
    const checks = {
      measurementsVerified: evidence.measurementsVerified === true && roof.pitchAreas.length > 0,
      wasteConfirmed: evidence.wasteConfirmed === true,
      materialTakeoffReviewed: evidence.materialTakeoffReviewed === true && priced,
      laborConfirmed: evidence.laborConfirmed === true && laborRate != null,
      pricingCurrent: evidence.pricingCurrent === true && lines.every(l => l.quantity != null && (parseToHundredths(l.quantity) === ZERO || (l.total != null && l.supplier && validPriceDate(l.pricedAt)))),
      marginWithinPolicy: quote > ZERO && netMargin != null && parseToHundredths(netMargin) >= parseToHundredths(workflow.targetMarginPercent || '35'),
    };
    const dollars = hundredthsToString;
    return { roof, order, scope, formulas, lines, checks, ready: Object.values(checks).every(Boolean),
      materialCost: dollars(taxed), laborCost: dollars(labor), otherCost: dollars(other + commission + overhead),
      materialBeforeTax: dollars(material), jobCosts, hardCost: dollars(hard), clientPrice: dollars(quote),
      commission: dollars(commission), overhead: dollars(overhead), grossProfit: dollars(gross), netProfit: dollars(net), netMarginPercent: netMargin };
  }

  const api = {
    STATUSES, STATUS_LABELS, isEditable, allowedNextStatuses, canApprove,
    parseToHundredths, hundredthsToString, divideRoundHalfUp, normalizeNumeric,
    orderQuantity, calculateWorkflow, calculate, grossProfit, achievedMarginPercent, verifyRecommendedSalePrice,
  };
  return api;
})();

/* Node test harness (tests/unit) requires this file directly. */
if (typeof module !== 'undefined' && module.exports) module.exports = { UnderwritingCalc: App.UnderwritingCalc };
