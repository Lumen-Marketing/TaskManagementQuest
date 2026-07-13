import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
for (const w of [900, 800]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => App.controller.setView('all'));
  await page.evaluate(() => App.controller.setLayout && App.controller.setLayout('table'));
  await page.waitForTimeout(500);
  const wrap = page.locator('#taskViewWrap, .main').first();
  await page.screenshot({ path: `verify_out/align_after_${w}.png`, clip: { x: w - 640 < 0 ? 0 : (w===900?248:200), y: 150, width: w - (w===900?248:200), height: 760 } });
  console.log(`W=${w} ERRS=`, errs.length ? errs : 'none');
  await page.close();
}
await browser.close();
