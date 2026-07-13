import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
// Find the left x of the first list-row and crop a tall thin strip there.
const box = await page.locator('.task-group').first().boundingBox();
await page.screenshot({ path: 'verify_out/baredge.png',
  clip: { x: box.x - 6, y: box.y - 6, width: 60, height: 520 } });
// Also dump the ::before details for a few rows.
const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.task-group .list-row')].slice(0,5);
  return rows.map(r => {
    const b = getComputedStyle(r, '::before');
    const prClass = [...r.querySelectorAll('[class*="priority-"]')].map(e=>e.className).join(',');
    return { bg: b.backgroundColor, w: b.width, left: b.left, radius: b.borderRadius, prClass };
  });
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
