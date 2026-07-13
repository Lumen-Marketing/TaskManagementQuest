import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs=[];
for (const [w,h,tag] of [[1280,900,'desktop'],[390,844,'mobile']]) {
  const page = await (await browser.newContext({ viewport:{width:w,height:h} })).newPage();
  page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(()=>{ const tm=App.controller.taskModel; const open=tm.all().filter(t=>t.status!=='done'&&t.id!==App.DEFAULT_CLOCK_TASK_ID).slice(0,3); open.forEach(t=>tm.toggleDone(t.id,'T')); });
  await page.evaluate(()=>App.controller.setView('reports'));
  await page.waitForTimeout(400);
  if (tag==='desktop') {
    console.log('KPI_COUNT=', await page.locator('.qhq-kpi').count());
    const kvs = await page.$$eval('.qhq-kpi .kv', els=>els.map(e=>e.textContent));
    console.log('KPIS=', JSON.stringify(kvs));
    await page.locator('.qhq-range button[data-range="week"]').click(); await page.waitForTimeout(200);
    console.log('WEEK_ACTIVE=', await page.locator('.qhq-range button[data-range="week"]').evaluate(e=>e.classList.contains('on')));
    await page.evaluate(()=>App.controller.setView('reports'));
  }
  await page.screenshot({ path:`verify_out/p2_reports_${tag}.png` });
  await page.close();
}
console.log('JS_ERRORS=', errs.length?errs:'none');
await browser.close();
