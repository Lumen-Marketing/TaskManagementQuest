#!/usr/bin/env node
/* Proposal intake checker. Paste one job per line (stdin or a file); it runs each
   through the SAME estimate engine the app uses and prints the exact approved-price
   the app must show, plus a numbered click-sheet. Touches no database or network.

   Line format (pipe-separated; blank lines and lines starting with # are ignored):
     client | project name | job address | roof sqft | waste % | material $ | labor $ | other $ | margin %

   usage:  node tools/proposal-intake.mjs jobs.txt        or   pbpaste | node tools/proposal-intake.mjs */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global.window || {};
global.App = global.window.App = {};
require('../js/models/UnderwritingCalc.js');
require('../js/models/ProposalDoc.js');
const C = App.UnderwritingCalc, D = App.ProposalDoc;

const src = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const clean = (s) => String(s ?? '').trim().replace(/[$,%\s]/g, '').replace(/,/g, '');
const rows = []; let bad = 0;
src.split('\n').forEach((line, i) => {
  if (!line.trim() || line.trim().startsWith('#')) return;
  const f = line.split('|').map((s) => s.trim());
  const [client, project, address] = f;
  const r = { n: rows.length + 1, client, project, address, issues: [] };
  if (f.length !== 9) r.issues.push(`expected 9 fields, got ${f.length}`);
  else {
    const num = (k, v) => { const c = clean(v); if (c === '') { r.issues.push(k + ' missing'); return null; } try { return C.hundredthsToString(C.parseToHundredths(c)); } catch (e) { r.issues.push(k + ' not a number: ' + v); return null; } };
    const inp = { roofAreaSqft: num('roof', f[3]), wastePercent: num('waste', f[4]), materialCost: num('material', f[5]), laborCost: num('labor', f[6]), otherCost: num('other', f[7]), targetMarginPercent: num('margin', f[8]) };
    if (!project) r.issues.push('project name missing');
    if (!client) r.issues.push('client missing');
    if (!r.issues.length) {
      const res = C.calculate(inp);
      if (!res.ok) r.issues.push(res.error); else { r.inp = inp; r.cost = res.data.totalEstimatedCost; r.price = res.data.recommendedSalePrice; }
    }
  }
  if (r.issues.length) bad++;
  rows.push(r);
});

console.log('\n#  CLIENT / PROJECT                          APPROVED PRICE    (total cost)');
for (const r of rows) console.log(String(r.n).padEnd(3) + `${r.client} / ${r.project}`.slice(0, 40).padEnd(42) + (r.price ? D.money(r.price).padStart(14) + '    (' + D.money(r.cost) + ')' : '  ✗ ' + r.issues.join('; ')));
console.log(`\n${rows.length - bad} ok, ${bad} need fixing.\n`);
for (const r of rows.filter((x) => x.price)) {
  console.log(`--- Job ${r.n}: ${r.project}  (${r.client}, ${r.address || 'no address'})`);
  console.log(`  Project folder: name "${r.project}", client "${r.client}", address "${r.address}"  (fill in BEFORE generating — the proposal copies these)`);
  console.log(`  Underwriting:   roof ${r.inp.roofAreaSqft} | waste ${r.inp.wastePercent} | material ${r.inp.materialCost} | labor ${r.inp.laborCost} | other ${r.inp.otherCost} | margin ${r.inp.targetMarginPercent}`);
  console.log(`  Must show:      ${D.money(r.price)}   -> if the app shows anything else, STOP and tell me\n`);
}
process.exit(bad ? 1 : 0);
