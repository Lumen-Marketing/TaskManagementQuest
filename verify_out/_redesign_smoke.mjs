import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs = [];
const page = await (await browser.newContext({ viewport:{width:1280,height:800} })).newPage();
page.on('console', m => { if (m.type()==='error' && !/env\.json|404/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const views = ['overdue','today','watching','time:mine','time:resource','team:hierarchy','approvals','all'];
for (const v of views) {
  await page.evaluate(view => window.App.controller.setView(view), v);
  await page.waitForTimeout(250);
  const title = await page.locator('#tbTitle').textContent();
  console.log(`view=${v.padEnd(14)} title="${title}"`);
}
console.log('JS_ERRORS=', errs.length ? errs : 'none');
await browser.close();
