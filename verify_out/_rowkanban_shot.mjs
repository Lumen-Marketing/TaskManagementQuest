import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(400);

// ---- Kanban (bolder) ----
await page.evaluate(() => App.controller.setLayout('kanban'));
await page.waitForTimeout(600);
const card = page.locator('.kanban-card').first();
await card.scrollIntoViewIfNeeded();
await card.hover();
await page.waitForTimeout(450);
const box = await card.boundingBox();
await page.screenshot({ path: 'verify_out/kanban_hover.png',
  clip: { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 30), width: box.width + 60, height: box.height + 70 } });

// ---- List row (subtle) ----
await page.evaluate(() => App.controller.setLayout('table'));
await page.waitForTimeout(500);
const row = page.locator('.list-row').nth(2);
await row.scrollIntoViewIfNeeded();
await row.hover();
await page.waitForTimeout(350);
const rb = await row.boundingBox();
await page.screenshot({ path: 'verify_out/row_hover.png',
  clip: { x: rb.x, y: Math.max(0, rb.y - 36), width: Math.min(1200, rb.width), height: rb.height + 72 } });

console.log('JS_ERRORS=', errs.length ? errs : 'none');
console.log('KANBAN_CARDS=', await page.locator('.kanban-card').count());
await browser.close();
