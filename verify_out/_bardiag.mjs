import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.evaluate(() => App.controller.setLayout && App.controller.setLayout('table'));
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.list-row')];
  const summary = {};
  for (const cls of ['priority-critical','priority-urgent','priority-high','priority-medium','priority-low']) {
    const r = rows.find(x => x.querySelector('.' + cls));
    if (r) summary[cls] = getComputedStyle(r, '::before').backgroundColor;
  }
  return { total: rows.length, barColors: summary };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
