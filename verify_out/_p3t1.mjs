import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport:{width:1320,height:1000} })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
await page.waitForTimeout(300);
const briefOnList = await page.locator('.ai-brief').count();
// sweep non-home surfaces too
for (const v of ['time:resource','approvals','team:hierarchy','all']) { await page.evaluate(x=>App.controller.setView(x), v); await page.waitForTimeout(350); }
const briefAnySurface = await page.locator('.ai-brief').count();
await page.evaluate(() => App.controller.setView('home'));
await page.waitForTimeout(300);
const qhqBrief = await page.locator('.qhq-brief').count();
console.log(JSON.stringify({ briefOnList, briefAnySurface, qhqBrief, errs }));
await browser.close();
