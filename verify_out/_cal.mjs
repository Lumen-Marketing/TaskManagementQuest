import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const errors = [];
for (const [wv, mode] of [[1280,'month'],[1280,'week'],[420,'month']]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:900}, deviceScaleFactor:1 })).newPage();
  page.on('console', m => { if (m.type()==='error' && !/env\.json|Configuration unavailable|challenges|Intervention/.test(m.text())) errors.push(`[${wv}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${wv}] PAGEERROR ${e.message}`));
  // preselect layout=calendar + mode via localStorage uiState
  await page.addInitScript((m) => {
    try { localStorage.setItem('questhq:onboarded','1'); } catch(e){}
  }, mode);
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{ const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  // open View menu, click Calendar
  await page.click('#viewBtn');
  await page.waitForTimeout(300);
  await page.click('[data-layout="calendar"]');
  await page.waitForTimeout(500);
  if (mode === 'week') { await page.click('[data-cal-mode="week"]').catch(()=>{}); await page.waitForTimeout(400); }
  const info = await page.evaluate(() => {
    const grid = document.querySelector('.cal-grid');
    return { hasGrid: !!grid, cells: document.querySelectorAll('.cal-cell').length, chips: document.querySelectorAll('.cal-chip').length, label: (document.querySelector('.cal-label')||{}).textContent, mode: document.querySelector('.cal-week')?'week':(document.querySelector('.cal-month')?'month':'?') };
  });
  console.log(`${wv}/${mode} ->`, JSON.stringify(info));
  await page.screenshot({ path:`verify_out/cal_${wv}_${mode}.png` });
  await page.context().close();
}
await browser.close();
console.log(errors.length ? 'JS ERRORS:\n'+errors.join('\n') : 'NO JS ERRORS');
