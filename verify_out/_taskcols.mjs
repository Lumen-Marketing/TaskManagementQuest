import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
async function shot(name, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('#taskDetailWrap .detail-grid')).gridTemplateColumns,
    side: !!document.querySelector('.detail-side'), main: !!document.querySelector('.detail-main'), rail: !!document.querySelector('.detail-rail'),
    cardBorder: getComputedStyle(document.querySelector('#taskDetailWrap .detail-card')).borderTopWidth + ' ' + getComputedStyle(document.querySelector('#taskDetailWrap .detail-card')).borderTopColor,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  console.log(name, JSON.stringify(r), 'errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
  await page.screenshot({ path: `verify_out/${name}.png` });
  await page.close();
}
await shot('cols_wide', { width: 1500, height: 1050 });
await shot('cols_med', { width: 1040, height: 1000 });
await shot('cols_mobile', { width: 390, height: 800 });
await browser.close();
