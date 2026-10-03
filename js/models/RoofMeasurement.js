window.App = window.App || {};

/* Adapter contract, not a guessed GAF XML schema. PDF/manual entry and future
   real XML adapters both return this versioned shape. Missing is never zero.
   Decimal values use the existing fixed-point underwriting engine. */
App.RoofMeasurement = (function () {
  const LENGTHS = ['eaves', 'rakes', 'hips', 'ridges', 'valleys', 'bends', 'flashing', 'step'];
  const ACCESSORIES = ['starter', 'dripEdge', 'ridgeCap', 'leakBarrier'];
  const C = () => App.UnderwritingCalc;
  const decimal = (v, label, optional = false) => {
    if (v === null || v === undefined || v === '') {
      if (optional) return null;
      throw new Error(label + ' is required.');
    }
    const h = C().parseToHundredths(v);
    if (h < 0n) throw new Error(label + ' cannot be negative.');
    return C().hundredthsToString(h);
  };
  const text = v => String(v == null ? '' : v).trim();
  function normalize(input) {
    if (!input || input.schemaVersion !== 1) throw new Error('Use normalized measurement schemaVersion 1.');
    const s = input.source || {};
    if (!text(s.provider) || !text(s.reportName) || !text(s.reference) || !Number.isInteger(s.page) || s.page < 1) {
      throw new Error('Measurement source needs provider, report name, reference and page.');
    }
    const lengths = {}, reportedAccessories = {};
    LENGTHS.forEach(k => { lengths[k] = decimal(input.lengths?.[k], k, true); });
    ACCESSORIES.forEach(k => { reportedAccessories[k] = decimal(input.reportedAccessories?.[k], k, true); });
    const pitchAreas = (input.pitchAreas || []).map(p => {
      if (!Number.isInteger(p.pitchRise) || p.pitchRise < 0 || p.pitchRise > 24) throw new Error('Pitch rise must be 0–24 over 12.');
      return { pitchRise: p.pitchRise, areaSqft: decimal(p.areaSqft, 'Pitch area'), page: p.page || s.page };
    });
    if (!Array.isArray(input.pitchAreas)) throw new Error('Pitch areas must be an array (empty when unknown).');
    if (input.facetCount != null && (!Number.isInteger(input.facetCount) || input.facetCount < 1)) throw new Error('Facet count must be a positive integer.');
    const fieldSources = {};
    const fields = [['roofAreaSqft','SF'],['suggestedWastePercent','%'],...LENGTHS.map(k=>['lengths.'+k,'FT']),...ACCESSORIES.map(k=>['reportedAccessories.'+k,'FT'])];
    fields.forEach(([key,unit]) => {
      const supplied=input.fieldSources?.[key] || {};
      const page=supplied.page ?? s.page;
      if (!Number.isInteger(page) || page<1) throw new Error('Field source page must be positive.');
      fieldSources[key]={reportName:text(s.reportName),reference:text(s.reference),page,label:text(supplied.label) || key,unit};
    });
    return {
      fieldSources,
      schemaVersion: 1,
      source: { provider: text(s.provider), method: text(s.method) || 'manual', reportName: text(s.reportName),
        reportDate: text(s.reportDate), reference: text(s.reference), sha256: text(s.sha256), page: s.page },
      property: text(input.property), roofAreaSqft: decimal(input.roofAreaSqft, 'Roof area'),
      penetrationCount: input.penetrationCount ?? null,
      materialRecommendations: (input.materialRecommendations || []).map(r => ({ key: text(r.key), quantity: decimal(r.quantity, 'Report quantity'), wastePercent: decimal(r.wastePercent, 'Report quantity waste'), page: r.page || s.page, unit: text(r.unit) })),
      facetCount: input.facetCount ?? null, predominantPitch: input.predominantPitch ?? null,
      pitchAreas, lengths, reportedAccessories,
      suggestedWastePercent: decimal(input.suggestedWastePercent, 'Suggested waste', true),
      reportWasteTable: (input.reportWasteTable || []).map(r => ({
        wastePercent: decimal(r.wastePercent, 'Report waste'), adjustedAreaSqft: decimal(r.adjustedAreaSqft, 'Report adjusted area'),
        orderSquares: decimal(r.orderSquares, 'Report squares'),
      })),
    };
  }
  function fromManualPdf(input) {
    return normalize({ ...input, source: { ...input.source, method: 'pdf-manual' } });
  }
  const adapters = new Map([['pdf-manual', fromManualPdf]]);
  function registerAdapter(name, adapter) {
    if (!name || typeof adapter !== 'function') throw new Error('An adapter function is required.');
    adapters.set(name, adapter);
  }
  function importReport(name, payload) {
    if (!adapters.has(name)) throw new Error('No adapter for ' + name + '. Real XML is required before implementing an XML parser.');
    return normalize(adapters.get(name)(payload));
  }
  function geometry(roof) {
    const l = roof.lengths;
    const sum = keys => keys.some(k => l[k] === null) ? null : C().hundredthsToString(keys.reduce((n,k) => n + C().parseToHundredths(l[k]), 0n));
    return { starter: sum(['eaves','rakes']), dripEdge: sum(['eaves','rakes']), ridgeCap: sum(['hips','ridges']),
      leakBarrier: sum(['bends','eaves','flashing','hips','rakes','step','valleys']) };
  }
  function pitchScope(roof) {
    if (!roof.pitchAreas.length) return { lowSlopeSqft: null, shingleSqft: null, discrepancySqft: null };
    const sum = pred => roof.pitchAreas.filter(pred).reduce((n,p) => n + C().parseToHundredths(p.areaSqft), 0n);
    return { lowSlopeSqft: C().hundredthsToString(sum(p => p.pitchRise < 2)),
      shingleSqft: C().hundredthsToString(sum(p => p.pitchRise >= 2)),
      discrepancySqft: C().hundredthsToString(C().parseToHundredths(roof.roofAreaSqft) - sum(() => true)) };
  }
  return { LENGTHS, ACCESSORIES, normalize, fromManualPdf, registerAdapter, importReport, geometry, pitchScope };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = { RoofMeasurement: App.RoofMeasurement };
