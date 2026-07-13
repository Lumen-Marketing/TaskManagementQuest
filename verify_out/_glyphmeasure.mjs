import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const measure = (sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const elLeft = el.getBoundingClientRect().left;
    // Range over the text gives the actual inked glyph box.
    const range = document.createRange(); range.selectNodeContents(el);
    const glyphLeft = range.getBoundingClientRect().left;
    return { elLeft: +elLeft.toFixed(1), glyphLeft: +glyphLeft.toFixed(1) };
  };
  const card = document.querySelector('.task-group').getBoundingClientRect().left;
  return { card: +card.toFixed(1), pageTitle: measure('.page-title') };
});
console.log(JSON.stringify(r));
await browser.close();
