import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
async function shot(name, vp, edit=false) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id));
  await page.waitForTimeout(500);
  if (edit) { await page.click('[data-action="edit-task"]'); await page.waitForTimeout(400); }
  const r = await page.evaluate(() => ({
    cards: document.querySelectorAll('#taskDetailWrap .detail-card').length,
    grid: !!document.querySelector('#taskDetailWrap .detail-grid'),
    horizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  console.log(name, JSON.stringify(r), 'errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
  await page.screenshot({ path: `verify_out/${name}.png` });
  await page.close();
}
await shot('blocks_desktop', { width: 1400, height: 1000 });
await shot('blocks_mobile', { width: 390, height: 780 });
await shot('blocks_edit', { width: 1400, height: 1000 }, true);
await browser.close();
