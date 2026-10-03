window.App = window.App || {};

/* UnderwritingTrace — builds the human-auditable calculation trace behind the
   Estimate Breakdown. Pure; no DOM.

   Every displayed RESULT comes straight from the stored value or from
   App.UnderwritingCalc (calculate / grossProfit / achievedMarginPercent /
   verifyRecommendedSalePrice). This module only adds labels, formula strings and
   the step-by-step lines around those results — it never recomputes a figure with
   different math than the one real formula.

   Sources are NEVER invented. Legacy records use: 'manual' (a person typed
   it), 'calculated' (derived by the formula), 'not_entered'. This app has no
   import pipeline, measurement-report ingestion or override path, so those
   sources come from the normalized V1 report only when present.

   "Has this record ever been through a real calculation save" is read off
   `recommendedSalePrice` being non-null (the row is written whole, by one RPC).
   Until then every input column holds its untouched database default (waste's
   literal 0.00, costs' 0.00) which is NOT something a person entered and must not
   be labelled "manual". */
App.UnderwritingTrace = (function () {
  const C = () => App.UnderwritingCalc;

  const SOURCE_LABELS = {
    manual: 'Manual entry', gaf_report: 'GAF QuickMeasure report', underwriter_override: 'Underwriter override',
    calculated: 'Calculated',
    not_entered: 'Not entered',
  };

  const money = (v) => '$' + v;

  // 0.3500 style fraction from percent-hundredths (3500 -> "0.3500"), integers only.
  function fraction4(h) {
    const s = h.toString().padStart(4, '0');
    return (s.slice(0, s.length - 4) || '0') + '.' + s.slice(-4);
  }

  function notEntered(key, label, formula) {
    return { key, label, inputs: [], formula: formula || null, calculationLines: [],
             result: 'Not entered', source: 'not_entered', roundingNote: null };
  }

  /* u: the underwriting as the model holds it (decimal strings; null where unset):
     { roofAreaSqft, wastePercent, materialCost, laborCost, otherCost,
       targetMarginPercent, adjustedRoofAreaSqft, squares, totalEstimatedCost,
       recommendedSalePrice } */
  function build(u) {
    const calc = C();
    const has = u.recommendedSalePrice !== null && u.recommendedSalePrice !== undefined;
    const manualOrNone = has ? 'manual' : 'not_entered';
    const steps = [];

    steps.push({
      key: 'base_roof_area', label: 'Base roof area', inputs: [], formula: null,
      calculationLines: [],
      result: u.roofAreaSqft ? u.roofAreaSqft + ' sqft' : 'Not entered',
      source: u.workflow ? (u.workflow.measurementOverrides ? 'underwriter_override' : 'gaf_report') : (u.roofAreaSqft ? manualOrNone : 'not_entered'), roundingNote: null,
    });

    steps.push({
      key: 'waste_percent', label: 'Waste %', inputs: [], formula: null, calculationLines: [],
      result: has ? u.wastePercent + '%' : 'Not entered', source: manualOrNone, roundingNote: null,
    });

    const wasteFormula = 'Waste-added Area = Adjusted Roof Area − Base Roof Area';
    const adjFormula = 'Adjusted Roof Area = Base Roof Area × (1 + Waste % / 100)';
    if (u.roofAreaSqft && u.adjustedRoofAreaSqft) {
      const added = calc.hundredthsToString(
        calc.parseToHundredths(u.adjustedRoofAreaSqft) - calc.parseToHundredths(u.roofAreaSqft));
      steps.push({
        key: 'waste_added_area', label: 'Waste-added area',
        inputs: [
          { label: 'Adjusted roof area', value: u.adjustedRoofAreaSqft + ' sqft' },
          { label: 'Base roof area', value: u.roofAreaSqft + ' sqft' },
        ],
        formula: wasteFormula,
        calculationLines: [u.adjustedRoofAreaSqft + ' sqft − ' + u.roofAreaSqft + ' sqft', '= ' + added + ' sqft'],
        result: added + ' sqft', source: 'calculated',
        roundingNote: 'Derived from the stored, already-rounded adjusted area, so base + added always reconciles exactly with adjusted.',
      });
      steps.push({
        key: 'adjusted_roof_area', label: 'Adjusted roof area',
        inputs: [
          { label: 'Base roof area', value: u.roofAreaSqft + ' sqft' },
          { label: 'Waste %', value: u.wastePercent + '%' },
        ],
        formula: adjFormula,
        calculationLines: [
          u.roofAreaSqft + ' sqft × (1 + ' + u.wastePercent + ' / 100)',
          '= ' + u.adjustedRoofAreaSqft + ' sqft',
        ],
        result: u.adjustedRoofAreaSqft + ' sqft', source: 'calculated',
        roundingNote: 'Rounded to the nearest 0.01 sqft, half-up.',
      });
    } else {
      steps.push(notEntered('waste_added_area', 'Waste-added area', wasteFormula));
      steps.push(notEntered('adjusted_roof_area', 'Adjusted roof area', adjFormula));
    }

    const sqFormula = 'Squares = Adjusted Roof Area / 100';
    if (u.squares && u.adjustedRoofAreaSqft) {
      steps.push({
        key: 'squares', label: 'Squares',
        inputs: [{ label: 'Adjusted roof area', value: u.adjustedRoofAreaSqft + ' sqft' }],
        formula: sqFormula,
        calculationLines: [u.adjustedRoofAreaSqft + ' sqft / 100', '= ' + u.squares + ' squares'],
        result: u.squares + ' squares', source: 'calculated',
        roundingNote: 'Rounded to the nearest 0.01 square, half-up — computed from the unrounded adjusted-area numerator, not from the rounded area above, so rounding is applied once.',
      });
    } else {
      steps.push(notEntered('squares', 'Squares', sqFormula));
    }

    [['material_cost', 'Material cost', u.materialCost],
     ['labor_cost', 'Labor cost', u.laborCost],
     ['other_cost', 'Other cost', u.otherCost]].forEach(([key, label, v]) => {
      steps.push({
        key, label, inputs: [], formula: null, calculationLines: [],
        result: has ? money(v) : 'Not entered', source: manualOrNone, roundingNote: null,
      });
    });

    const totFormula = 'Total Cost = Material + Labor + Other';
    if (has) {
      steps.push({
        key: 'total_estimated_cost', label: 'Total estimated cost',
        inputs: [
          { label: 'Material cost', value: money(u.materialCost) },
          { label: 'Labor cost', value: money(u.laborCost) },
          { label: 'Other cost', value: money(u.otherCost) },
        ],
        formula: totFormula,
        calculationLines: [
          money(u.materialCost) + ' + ' + money(u.laborCost) + ' + ' + money(u.otherCost),
          '= ' + money(u.totalEstimatedCost),
        ],
        result: money(u.totalEstimatedCost), source: 'calculated', roundingNote: null,
      });
    } else {
      steps.push(notEntered('total_estimated_cost', 'Total estimated cost', totFormula));
    }

    steps.push({
      key: 'target_margin_percent', label: 'Target margin',
      inputs: [], formula: null, calculationLines: [],
      result: u.targetMarginPercent ? u.targetMarginPercent + '%' : 'Not entered',
      source: u.targetMarginPercent ? manualOrNone : 'not_entered', roundingNote: null,
    });

    const priceFormula = 'Sale Price = Cost / (1 − Margin)';
    if (has && u.targetMarginPercent) {
      const mh = calc.parseToHundredths(u.targetMarginPercent);
      const frac = fraction4(mh);
      const oneMinus = fraction4(BigInt(10000) - mh);
      steps.push({
        key: 'recommended_sale_price', label: 'Recommended sale price',
        inputs: [
          { label: 'Total cost', value: money(u.totalEstimatedCost) },
          { label: 'Margin', value: u.targetMarginPercent + '%' },
        ],
        formula: priceFormula,
        calculationLines: [
          money(u.totalEstimatedCost) + ' / (1 − ' + frac + ')',
          '= ' + money(u.totalEstimatedCost) + ' / ' + oneMinus,
          '= ' + money(u.recommendedSalePrice),
        ],
        result: money(u.recommendedSalePrice), source: 'calculated',
        roundingNote: 'Rounded to the nearest cent, half-up.',
      });
    } else {
      steps.push(notEntered('recommended_sale_price', 'Recommended sale price', priceFormula));
    }

    const gpFormula = 'Gross Profit = Sale Price − Total Cost';
    const amFormula = 'Achieved Margin = Gross Profit / Sale Price';
    if (has) {
      const gp = calc.grossProfit(u.recommendedSalePrice, u.totalEstimatedCost);
      steps.push({
        key: 'gross_profit', label: 'Gross profit',
        inputs: [
          { label: 'Recommended sale price', value: money(u.recommendedSalePrice) },
          { label: 'Total estimated cost', value: money(u.totalEstimatedCost) },
        ],
        formula: gpFormula,
        calculationLines: [money(u.recommendedSalePrice) + ' − ' + money(u.totalEstimatedCost), '= ' + money(gp)],
        result: money(gp), source: 'calculated', roundingNote: null,
      });

      const achieved = calc.achievedMarginPercent(gp, u.recommendedSalePrice);
      if (achieved) {
        const v = u.targetMarginPercent
          ? calc.verifyRecommendedSalePrice({
              roofAreaSqft: u.roofAreaSqft, wastePercent: u.wastePercent,
              materialCost: u.materialCost, laborCost: u.laborCost, otherCost: u.otherCost,
              targetMarginPercent: u.targetMarginPercent,
            }, u.recommendedSalePrice)
          : { verified: false };
        steps.push({
          key: 'achieved_margin_verification', label: 'Achieved margin verification',
          inputs: [
            { label: 'Gross profit', value: money(gp) },
            { label: 'Recommended sale price', value: money(u.recommendedSalePrice) },
          ],
          formula: amFormula,
          calculationLines: [money(gp) + ' / ' + money(u.recommendedSalePrice), '= ' + achieved + '%'],
          result: achieved + '% achieved (target ' + u.targetMarginPercent + '%) — ' +
            (v.verified ? 'Verified ✓' : 'Mismatch ✗ (formula would produce a different price)'),
          source: 'calculated',
          verified: !!v.verified,
          roundingNote: 'Achieved margin rounded to 2 decimal places. Verification recomputes the sale price from these same stored inputs via the same formula that produced it — an exact match, not a tolerance.',
        });
      } else {
        steps.push({
          key: 'achieved_margin_verification', label: 'Achieved margin verification',
          inputs: [], formula: amFormula, calculationLines: [],
          result: 'n/a (recommended sale price is $0)', source: 'calculated', roundingNote: null,
        });
      }
    } else {
      steps.push(notEntered('gross_profit', 'Gross profit', gpFormula));
      steps.push(notEntered('achieved_margin_verification', 'Achieved margin verification', amFormula));
    }

    if (u.workflow?.snapshot) {
      const s = u.workflow.snapshot, src = u.workflow.measurement.source;
      steps.push({ key:'order_quantity', label:'Order quantity (whole squares)',
        inputs:[{label:'Report',value:src.reportName+' · page '+src.page},{label:'Selected waste',value:u.wastePercent+'%'}],
        formula:'Use the printed report waste row when available; otherwise round area to whole SF and ceil exact area / 100.',
        calculationLines:[], result:s.order.adjustedAreaSqft+' SF · '+s.order.orderSquares+' SQ',
        source:'calculated', roundingNote:'Separate from migration 073 decimal squares; preserves provider rounding.' });
      steps.push({ key:'net_profit', label:'Net profit at client price', inputs:[], formula:'Client price − hard cost − commission − overhead',
        calculationLines:[s.clientPrice+' − '+s.hardCost+' − '+s.commission+' − '+s.overhead],
        result:'$'+s.netProfit+' · '+s.netMarginPercent+'% net margin', source:'calculated',roundingNote:'Quest supplier and labor rates; material tax only. Saved V1 snapshot.' });
    }
    return steps;
  }

  return { SOURCE_LABELS, build };
})();

/* Node test harness (tests/unit) requires this file directly. */
if (typeof module !== 'undefined' && module.exports) module.exports = { UnderwritingTrace: App.UnderwritingTrace };
