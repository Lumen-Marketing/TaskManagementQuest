import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return sel+': MISSING';
    const cs = getComputedStyle(el);
    return `${sel}: bg=${cs.backgroundColor} | bdf=${cs.backdropFilter} | img=${cs.backgroundImage.slice(0,40)}`; };
  return [
    pick('.main'), pick('.qhq-page'), pick('#taskViewWrap'),
    pick('.task-group'), pick('.group-body'), pick('.task-group .list-row'),
  ];
});
console.log(r.join('\n'));
await browser.close();
