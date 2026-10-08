#!/usr/bin/env node
/* DEV-ONLY. Emits SQL that inserts ~545 results of the JS estimate engine
   (js/models/UnderwritingCalc.js) straight into public.underwritings, so the
   database CHECK constraints (migration 073) either accept every one — proving
   JS/DB parity — or reject one and fail loudly. Includes exact rounding ties.
   Usage: node tools/gen-underwriting-parity.mjs > parity.sql */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = {}; globalThis.App = globalThis.window.App = {};
require('../js/models/UnderwritingCalc.js');
const C = App.UnderwritingCalc;
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const dec = (w) => `${rnd(w)}.${String(rnd(100)).padStart(2, '0')}`;
const cases = [];
for (let i = 0; i < 500; i++) cases.push({ roof: rnd(5) ? dec(20000) : null, waste: dec(60), m: dec(5000), l: dec(5000), o: dec(1000), margin: `${1 + rnd(98)}.${String(rnd(100)).padStart(2, '0')}` });
for (const t of ['0.01', '0.03', '0.05', '1.01', '2.50']) for (const mg of ['60.00', '40.00', '12.50', '87.50']) cases.push({ roof: null, waste: '0', m: t, l: '0', o: '0', margin: mg });
for (const a of ['0.01', '0.03', '49.50', '0.50', '12.34']) for (const w of ['50', '5', '0.5', '12.5', '33.33']) cases.push({ roof: a, waste: w, m: '1', l: '0', o: '0', margin: '35' });
const T = "'00000000-0000-0000-0000-000000000000'";
const q = (v) => (v === null ? 'null' : `'${v}'`);
const out = ['\\set ON_ERROR_STOP on', 'begin;'];
for (const c of cases) {
  const r = C.calculate({ roofAreaSqft: c.roof, wastePercent: c.waste, materialCost: c.m, laborCost: c.l, otherCost: c.o, targetMarginPercent: c.margin });
  if (!r.ok) { console.error('engine rejected', c, r.error); process.exit(1); }
  const d = r.data;
  const roof = c.roof === null ? null : C.hundredthsToString(C.parseToHundredths(c.roof));
  out.push(`insert into public.underwritings (tenant_id, company_id, roof_area_sqft, waste_percent, material_cost, labor_cost, other_cost, target_margin_percent, adjusted_roof_area_sqft, squares, total_estimated_cost, recommended_sale_price, calculated_at) values (${T}, 'roofing', ${q(roof)}, '${c.waste}', '${c.m}', '${c.l}', '${c.o}', '${c.margin}', ${q(d.adjustedRoofAreaSqft)}, ${q(d.squares)}, '${d.totalEstimatedCost}', '${d.recommendedSalePrice}', now());`);
}
out.push(`select 'parity: ' || count(*) || ' of ${cases.length} engine results accepted by the DB CHECKs' as result from public.underwritings;`);
out.push(`do $$ begin begin update public.underwritings set recommended_sale_price = recommended_sale_price + 0.01 where id = (select id from public.underwritings limit 1); raise exception 'FAIL: off-by-one-cent price accepted'; exception when check_violation then null; end; end $$;`);
out.push('rollback;');
console.log(out.join('\n'));
