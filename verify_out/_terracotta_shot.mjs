import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);

await page.evaluate(() => App.controller.setView('home'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'verify_out/terracotta_home.png' });

await page.evaluate(() => App.controller.setView('reports'));
await page.waitForTimeout(600);
await page.screenshot({ path: 'verify_out/terracotta_reports.png' });

console.log('JS_ERRORS=', errs.length ? errs : 'none');
await browser.close();
