import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// Show the task list view (page-head widgets live there).
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(600);

const widgets = page.locator('.page-head-widgets');
await widgets.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await widgets.screenshot({ path: 'verify_out/widgets_resting.png' });

// Hover the Up-next card to capture the terracotta glow + lift.
const card = page.locator('.up-next-card').first();
await card.hover();
await page.waitForTimeout(450);
await widgets.screenshot({ path: 'verify_out/widgets_hover_upnext.png' });

// Hover the Focus card too.
const focus = page.locator('.focus-widget').first();
await focus.hover();
await page.waitForTimeout(450);
await widgets.screenshot({ path: 'verify_out/widgets_hover_focus.png' });

console.log('JS_ERRORS=', errs.length ? errs : 'none');
console.log('WIDGET_COUNT=', await page.locator('.page-head-widgets > *').count());
await browser.close();
