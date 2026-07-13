import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const L = sel => { const el = document.querySelector(sel); if(!el) return sel+': MISSING';
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return `${sel}: left=${b.left.toFixed(1)} padL=${cs.paddingLeft} marL=${cs.marginLeft} font=${cs.fontFamily.split(',')[0]}`; };
  return [
    L('.page-eyebrow'), L('.page-title'), L('.page-head'),
    L('#taskViewWrap'), L('.task-group'), L('.list-header'),
  ];
});
console.log(r.join('\n'));
await browser.close();
