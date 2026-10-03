// Test-only offline fixture. No app entry, auth, env.json, Supabase or server.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.QUEST_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  let count = 0;
  await page.setContent('<!doctype html><html><body><main id="uwHost"></main></body></html>');
  await page.addStyleTag({content:await readFile('css/underwriting.css','utf8')});
  await page.addScriptTag({content:`window.App={can:()=>true,utils:{escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')},directory:{project:()=>null,person:()=>null}};`});
  for (const name of ['UnderwritingCalc','RoofMeasurement','UnderwritingTrace','UnderwritingModel']) await page.addScriptTag({content:await readFile('js/models/'+name+'.js','utf8')});
  await page.addScriptTag({content:await readFile('js/views/UnderwritingView.js','utf8')});
  const fixture=JSON.parse(await readFile('tests/fixtures/gaf/gilbert.json','utf8'));
  await page.evaluate(f=>{
    window.model=new App.UnderwritingModel();model.hydrate('bid',{record:{id:'u',status:'draft',calculatedAt:null}});
    const controller={
      underwriting:model,
      setUnderwritingDraftField:(id,field,value)=>model.setDraftField(id,field,value)
    };
    window.view=new App.UnderwritingView({controller});window.task={id:'bid',type:'bid'};
    model.importMeasurement('bid',f);view.mount(document.querySelector('#uwHost'),task);
  },fixture);
  for (const width of [1440,1024,768]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.locator('[data-uw-field="wastePercent"]').count(),1);count++;
    assert.match(await page.locator('[data-uw-order]').innerText(),/5941 SF · 60 order SQ/);count++;
    assert.ok(await page.locator('[data-uw-workflow="materials.shingles.unitPrice"]').isVisible());count++;
  }
  await page.locator('[data-uw-workflow="materials.shingles.unitPrice"]').fill('40');
  assert.equal(await page.locator('[data-uw-material-row="shingles"] [data-uw-material-total]').innerText(),'$6800.00');count++;
  await page.locator('[data-uw-field="wastePercent"]').fill('15');
  assert.match(await page.locator('[data-uw-order]').innerText(),/60 order SQ/);count++;
  await page.locator('[data-uw-workflow="materials.shingles.quantity"]').fill('180');
  assert.equal(await page.locator('[data-uw-material-row="shingles"] [data-uw-material-quantity]').innerText(),'180.00');count++;
  assert.equal(await page.locator('[data-uw-material-row="shingles"] [data-uw-material-total]').innerText(),'$7200.00');count++;
  await page.locator('[data-uw-review="wasteConfirmed"]').check();
  await page.locator('[data-uw-field="wastePercent"]').fill('13');
  assert.equal(await page.locator('[data-uw-review="wasteConfirmed"]').isChecked(),false);count++;
  console.log(`${count} offline UI checks passed; all external traffic blocked.`);
} finally { await browser.close(); }
