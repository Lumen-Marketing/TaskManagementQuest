import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
global.window = {}; global.App = window.App = {};
require('../../js/models/UnderwritingCalc.js');
require('../../js/models/RoofMeasurement.js');
require('../../js/models/UnderwritingTrace.js');
require('../../js/models/UnderwritingModel.js');
const C = App.UnderwritingCalc, R = App.RoofMeasurement;
const fixtures = Object.fromEntries(['gilbert','florence','queen-creek'].map(k => [k,JSON.parse(readFileSync(new URL('../fixtures/gaf/'+k+'.json',import.meta.url)))]));
const workflow = (key = 'gilbert') => ({ schemaVersion:1, measurement:R.fromManualPdf(fixtures[key]), materials:{}, review:{}, jobCosts:{}, taxPercent:'8.5', commissionPercent:'10',overheadPercent:'0',targetMarginPercent:'35',laborRate:'100',clientPrice:'30000' });
function priced(key = 'gilbert') {
  const w = workflow(key), r = C.calculateWorkflow(w,fixtures[key].suggestedWastePercent);
  r.lines.forEach(l => { w.materials[l.key] = { unitPrice:'10',supplier:'Quest test supplier',pricedAt:'2026-10-03' }; if(l.quantity == null) w.materials[l.key].quantity = '0'; });
  w.review = { measurementsVerified:true,wasteConfirmed:true,materialTakeoffReviewed:true,laborConfirmed:true,pricingCurrent:true };
  return w;
}
for (const [key,expected] of [['gilbert',['5258','13','5941','60','170']],['florence',['4453','8','4809','49','138']],['queen-creek',['4574','11','5077','51','155']]]) {
  test(key+' PDF ground truth and existing fractional-squares contract', () => {
    const f = fixtures[key], r = C.calculateWorkflow(workflow(key),f.suggestedWastePercent);
    assert.equal(R.normalize(f).roofAreaSqft,expected[0]+'.00');
    assert.equal(R.normalize(f).suggestedWastePercent,expected[1]+'.00');
    assert.deepEqual(r.order,{adjustedAreaSqft:expected[2],orderSquares:expected[3]});
    assert.equal(r.lines.find(l=>l.key==='shingles').quantity,expected[4]);
    const old=C.calculate({roofAreaSqft:f.roofAreaSqft,wastePercent:f.suggestedWastePercent,materialCost:'0',laborCost:'0',otherCost:'0',targetMarginPercent:'35'});
    assert.equal(old.ok,true); assert.notEqual(old.data.squares,expected[3]+'.00');
    const pdf=readFileSync(new URL('../fixtures/gaf/'+key+'.pdf',import.meta.url));
    assert.equal(createHash('sha256').update(pdf).digest('hex'),f.source.sha256);
  });
}
test('Florence keeps 1/12 apart from 2/12 and 4/12; rounding gap is visible',()=>{
  const scope=R.pitchScope(R.normalize(fixtures.florence));
  assert.deepEqual(scope,{lowSlopeSqft:'276.00',shingleSqft:'4176.00',discrepancySqft:'1.00'});
  const r=C.calculateWorkflow(workflow('florence'),'8');
  assert.equal(r.lines.find(l=>l.key==='lowSlopeBase').quantity,'2');
  assert.equal(r.lines.find(l=>l.key==='lowSlopeCap').quantity,'3');
});
test('Gilbert accessory source values survive printed-formula discrepancies',()=>{
  const roof=R.normalize(fixtures.gilbert);
  assert.deepEqual(R.geometry(roof),{starter:'325.00',dripEdge:'325.00',ridgeCap:'308.00',leakBarrier:'759.00'});
  assert.equal(roof.reportedAccessories.starter,'275.00');
  assert.equal(roof.reportedAccessories.leakBarrier,'705.00');
  const r=C.calculateWorkflow(workflow(),'13');
  assert.equal(r.lines.find(l=>l.key==='leakBarrier').quantity,'12');
  assert.equal(r.lines.find(l=>l.key==='ridgeCap').quantity,'14');
});
test('missing measurements remain null; explicit zero remains zero',()=>{
  const f=structuredClone(fixtures.gilbert);delete f.lengths.hips;f.lengths.step='0';
  const roof=R.normalize(f);assert.equal(roof.lengths.hips,null);assert.equal(roof.lengths.step,'0.00');
  assert.equal(R.geometry(roof).ridgeCap,null);
});
test('reject malformed imports, negative values and speculative XML',()=>{
  assert.throws(()=>R.normalize({}),/schemaVersion/);
  assert.throws(()=>R.normalize({...fixtures.gilbert,roofAreaSqft:'-1'}),/negative/);
  assert.throws(()=>R.normalize({...fixtures.gilbert,source:{}}),/source/);
  assert.throws(()=>R.importReport('gaf-xml','<invented/>'),/Real XML/);
});
test('a future adapter feeds the same normalized shape without changing the calculator',()=>{
  R.registerAdapter('test-real-format',()=>fixtures['queen-creek']);
  assert.equal(R.importReport('test-real-format',{}).roofAreaSqft,'4574.00');
});
test('waste override leaves suggested waste untouched and requires nails to be reconfirmed',()=>{
  const w=workflow();const r=C.calculateWorkflow(w,'15');
  assert.deepEqual(r.order,{adjustedAreaSqft:'6046',orderSquares:'61'});
  assert.equal(w.measurement.suggestedWastePercent,'13.00');
  assert.equal(r.lines.find(l=>l.key==='coilNails').quantity,null);
});
test('quantity, Quest product and price overrides keep their source',()=>{
  const w=priced();w.materials.shingles={product:'Quest selected shingle',quantity:'180',unitPrice:'40',supplier:'Supplier A',pricedAt:'2026-10-03'};
  const r=C.calculateWorkflow(w,'13'), line=r.lines.find(l=>l.key==='shingles');
  assert.equal(line.total,'7200.00');assert.equal(line.source,'underwriter_override');assert.equal(line.product,'Quest selected shingle');
  assert.equal(w.measurement.source.provider,'GAF QuickMeasure');
});
test('sheet business rules: tax only materials and deduct commission from gross profit',()=>{
  const w=priced();const before=C.calculateWorkflow(w,'13').materialBeforeTax;
  w.jobCosts={permit:'100',dumpster:'200'};w.overheadPercent='5';
  const r=C.calculateWorkflow(w,'13');
  assert.equal(r.materialCost,C.hundredthsToString(C.parseToHundredths(before)+C.divideRoundHalfUp(C.parseToHundredths(before)*850n,10000n)));
  assert.equal(r.laborCost,'6000.00');assert.equal(r.commission,'3000.00');assert.equal(r.overhead,'1500.00');
  assert.equal(C.parseToHundredths(r.grossProfit)-C.parseToHundredths(r.netProfit),450000n);
});
test('readiness requires all six checks, supplier evidence and actual net margin',()=>{
  const w=priced();assert.equal(C.calculateWorkflow(w,'13').ready,true);
  w.review.wasteConfirmed=false;assert.equal(C.calculateWorkflow(w,'13').ready,false);
  w.review.wasteConfirmed=true;w.materials.shingles.supplier='';assert.equal(C.calculateWorkflow(w,'13').ready,false);
  w.materials.shingles.supplier='Supplier';w.clientPrice='1000';assert.equal(C.calculateWorkflow(w,'13').checks.marginWithinPolicy,false);
});
test('negative/nondecimal rates cannot create valid economics',()=>{
  for (const value of ['-1','NaN','0.001']) {const w=priced();w.laborRate=value;assert.throws(()=>C.calculateWorkflow(w,'13'));}
});
const record=()=>({id:'u',status:'draft',calculatedAt:null});
test('import uses the existing model; background hydration does not replace an unsaved draft',async()=>{
  const m=new App.UnderwritingModel({load:async()=>({record:record(),history:[]})});m.hydrate('bid',{record:record()});
  m.importMeasurement('bid',fixtures.florence);assert.equal(m.draft('bid').wastePercent,'8.00');
  await m.refresh('bid');assert.equal(m.draft('bid').workflow.measurement.roofAreaSqft,'4453.00');assert.equal(m.isDirty('bid'),true);
});
test('existing save receives workflow and the SAME fixed-point estimate snapshot atomically',async()=>{
  let payload;const m=new App.UnderwritingModel({saveEstimate:async(id,p)=>{payload=p;}});m.hydrate('bid',{record:record()});
  m.importMeasurement('bid',fixtures.gilbert);m.draft('bid').workflow=priced();m.draft('bid').targetMarginPercent='35';m.draft('bid').reason='Scope confirmation';
  const result=await m.saveDraft('bid');assert.equal(result.ok,true);assert.equal(payload.input.roofAreaSqft,'5258.00');
  assert.equal(payload.workflow.snapshot.order.orderSquares,'60');assert.equal(payload.data.squares,'59.42');
  assert.equal(payload.workflow.measurement.source.sha256,fixtures.gilbert.source.sha256);
});
test('changed inputs invalidate reviews, preserve source and require override reason',()=>{
  const m=new App.UnderwritingModel();m.hydrate('bid',{record:record()});m.importMeasurement('bid',fixtures.gilbert);
  m.draft('bid').workflow=priced();m.setDraftField('bid','roofAreaSqft','5000');
  assert.deepEqual(m.draft('bid').workflow.review,{});assert.equal(m.draft('bid').workflow.measurement.roofAreaSqft,'5258.00');
  assert.match(m.evaluateDraft('bid').errors.form,/reason/);
  m.setDraftField('bid','reason','Site verification correction');assert.equal(m.evaluateDraft('bid').ok,true);
});
test('unsafe nested paths and locked estimates cannot mutate V1 inputs',()=>{
  const m=new App.UnderwritingModel();m.hydrate('bid',{record:record()});m.importMeasurement('bid',fixtures.gilbert);
  m.setWorkflowField('bid','__proto__.polluted','yes');assert.equal({}.polluted,undefined);
  m.record('bid').status='approved';assert.throws(()=>m.importMeasurement('bid',fixtures.florence),/locked/);
  m.setWorkflowField('bid','laborRate','999');assert.equal(m.draft('bid').workflow.laborRate,'');
});
test('V1 submission uses saved PROVE evidence, not an unsaved checkbox',async()=>{
  const m=new App.UnderwritingModel({setStatus:async()=>{throw new Error('must not call');}});
  m.hydrate('bid',{record:{...record(),calculatedAt:'2026-10-03',workflow:workflow(),wastePercent:'13'}});
  const res=await m.transition('bid','ready_for_review');assert.match(res.error,/PROVE/);
});

test('Google Sheet David Shingle business-rule totals reconcile to cents',()=>{
  const w=priced();w.measurement=R.normalize({...fixtures.gilbert,roofAreaSqft:'6800',pitchAreas:[{pitchRise:4,areaSqft:'6800'}],reportWasteTable:[]});
  for(const key of Object.keys(w.materials)) w.materials[key]={quantity:'0',unitPrice:'0'};
  w.materials.shingles={quantity:'1',unitPrice:'17482.13',supplier:'Reference only',pricedAt:'2026-10-03'};
  w.laborRate='60';w.clientPrice='35700';w.jobCosts={other:'2000',dumpster:'200'};
  const r=C.calculateWorkflow(w,'0');assert.equal(r.materialCost,'18968.11');assert.equal(r.hardCost,'25248.11');
  assert.equal(r.commission,'3570.00');assert.equal(r.grossProfit,'10451.89');assert.equal(r.netProfit,'6881.89');assert.equal(r.netMarginPercent,'19.28');
});
require('../../js/views/UnderwritingView.js');
App.utils={escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};
App.can=()=>true;App.directory={project:()=>null,person:()=>null};
const viewFor = model => {const v=Object.create(App.UnderwritingView.prototype);v.controller={underwriting:model};v._errors={};return v;};
test('the existing Bid view renders the five stages in order without duplicate form fields',()=>{
  const m=new App.UnderwritingModel();m.hydrate('bid',{record:record()});m.importMeasurement('bid',fixtures.gilbert);
  const html=viewFor(m)._html({id:'bid',type:'bid'});
  let prev=-1;for(const label of ['01 / MEASURE','02 / CALCULATE','03 / MATERIALS','04 / COST','05 / PROVE']) {const pos=html.indexOf(label);assert.ok(pos>prev);prev=pos;}
  assert.equal((html.match(/data-uw-field="wastePercent"/g)||[]).length,1);
  assert.equal((html.match(/data-uw-field="targetMarginPercent"/g)||[]).length,1);
  assert.match(html,/5941 SF · 60 order SQ/);assert.match(html,/Unknown|Unpriced/);
});
test('measurement intake uses ordinary report fields and source strings are escaped',()=>{
  const m=new App.UnderwritingModel();m.hydrate('bid',{record:record()});
  assert.match(viewFor(m)._html({id:'bid'}),/Enter measurements from a GAF report/);
  const f=structuredClone(fixtures.gilbert);f.source.reportName='<script>alert(1)</script>';
  m.importMeasurement('bid',f);const html=viewFor(m)._html({id:'bid'});
  assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/&lt;script&gt;/);
});
test('switching Quest product requires confirmation of its coverage quantity',()=>{
  const w=priced();w.materials.shingles.product='Different coverage product';
  assert.throws(()=>C.calculateWorkflow(w,'13'),/Confirm quantity/);
});
require('../../js/services/SupabaseDataStore.js');
test('V1 datastore calls one atomic RPC; legacy payload retains its existing RPC',async()=>{
  const calls=[];const store=new App.SupabaseDataStore({supabase:{rpc:async(name,args)=>{calls.push({name,args});return {error:null};}}});
  const result=C.calculate({roofAreaSqft:'5258',wastePercent:'13',materialCost:'1',laborCost:'1',otherCost:'1',targetMarginPercent:'35'});
  const input={roofAreaSqft:'5258',wastePercent:'13',materialCost:'1',laborCost:'1',otherCost:'1',targetMarginPercent:'35'};
  await store.saveUnderwritingEstimate('u',{input,data:result.data},null);
  await store.saveUnderwritingEstimate('u',{input,data:result.data,workflow:priced()},'Verified');
  assert.deepEqual(calls.map(c=>c.name),['save_underwriting_estimate','save_underwriting_v1']);
  assert.equal(calls[1].args.p_workflow.measurement.source.provider,'GAF QuickMeasure');assert.equal(calls[1].args.p_reason,'Verified');
  assert.equal(calls[0].args.p_workflow,undefined);
});
test('failed persistence preserves the source, overrides and unsaved draft',async()=>{
  const m=new App.UnderwritingModel({saveEstimate:async()=>{throw new Error('database refused');}});m.hydrate('bid',{record:record()});
  m.importMeasurement('bid',fixtures.gilbert);m.draft('bid').workflow=priced();m.draft('bid').reason='Reviewed scope';
  await assert.rejects(()=>m.saveDraft('bid'),/database refused/);assert.equal(m.draft('bid').workflow.measurement.source.reportName,fixtures.gilbert.source.reportName);
  assert.equal(m.isDirty('bid'),true);
});

test('normalized fields preserve units and page-specific source locations',()=>{
  const roof=R.normalize(fixtures['queen-creek']);assert.equal(roof.fieldSources['lengths.step'].page,4);
  assert.equal(roof.fieldSources['lengths.step'].unit,'FT');assert.equal(roof.fieldSources.roofAreaSqft.page,7);
});
