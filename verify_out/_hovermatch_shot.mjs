import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.evaluate(() => App.controller.setLayout && App.controller.setLayout('table'));
await page.waitForTimeout(500);

async function shot(sel, name) {
  const row = page.locator(sel).first();
  if (!await row.count()) { console.log('NO ROW', sel); return; }
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(300);
  const b = await row.boundingBox();
  await page.screenshot({ path: `verify_out/${name}.png`, clip: { x: b.x, y: b.y - 4, width: Math.min(720, b.width), height: b.height + 8 } });
}
// A medium (blue bar) row and a critical (red bar) row.
await shot('.list-row:not(:has(.prio-critical)):not(:has(.prio-urgent)):not(:has(.prio-high))', 'hover_blue');
await shot('.list-row:has(.prio-critical)', 'hover_red');
await shot('.list-row:has(.prio-high)', 'hover_orange');
console.log('ERRS=', errs.length ? errs : 'none');
await browser.close();
