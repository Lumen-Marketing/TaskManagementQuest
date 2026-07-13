import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1320, height: 1000 } })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));

await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Click the first task row to open the detail page.
const row = await page.$('#listBody .list-row');
console.log('row found:', !!row);
await row.click();
await page.waitForTimeout(600);

const state = await page.evaluate(() => ({
  wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
  listHidden: document.getElementById('listPane')?.classList.contains('hidden'),
  detailInWrap: document.getElementById('detailPane')?.parentElement?.id,
  backBtn: !!document.querySelector('.detail-back'),
  title: document.querySelector('.detail-title')?.textContent?.slice(0, 40),
  hasModalBackdrop: !!document.getElementById('taskDetailModal'),
}));
console.log('OPEN:', JSON.stringify(state));
await page.screenshot({ path: 'verify_out/taskpage_open.png', fullPage: false });

// Click Back to return to the list.
await page.click('.detail-back');
await page.waitForTimeout(500);
const closed = await page.evaluate(() => ({
  wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
  listHidden: document.getElementById('listPane')?.classList.contains('hidden'),
  rows: document.querySelectorAll('#listBody .list-row').length,
}));
console.log('CLOSED:', JSON.stringify(closed));
await page.screenshot({ path: 'verify_out/taskpage_closed.png', fullPage: false });

console.log('errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
await browser.close();
