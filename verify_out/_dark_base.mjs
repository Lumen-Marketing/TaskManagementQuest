import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// Force dark theme.
const how = await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme','dark');
  document.body.setAttribute('data-theme','dark');
  return { htmlAttr: document.documentElement.getAttribute('data-theme') };
});
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'verify_out/dark_baseline.png' });
console.log(JSON.stringify(how));
await browser.close();
