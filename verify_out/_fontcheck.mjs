import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(400);
const r = await page.evaluate(() => ({
  fraunsesLoaded: document.fonts.check('500 28px Fraunces'),
  titleFont: getComputedStyle(document.querySelector('.page-title')).fontFamily,
}));
console.log(JSON.stringify(r));
await page.screenshot({ path: 'verify_out/align_fontready.png', clip: { x: 250, y: 150, width: 320, height: 200 } });
await browser.close();
