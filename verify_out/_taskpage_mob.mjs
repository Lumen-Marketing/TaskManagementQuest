import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 390, height: 780 } })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id));
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth;
  return { horizOverflow: sw > cw + 1, sw, cw, wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden') };
});
console.log('MOBILE:', JSON.stringify(r));
await page.screenshot({ path: 'verify_out/taskpage_mobile.png' });
console.log('errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
await browser.close();
