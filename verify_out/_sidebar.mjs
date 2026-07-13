import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport:{width:1320,height:1000} })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// minimize via the real button
const clicked = await page.evaluate(() => {
  const b = document.getElementById('sideMinimizeBtn');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const deck = document.querySelector('.deck');
  const body = document.body;
  const count = document.querySelector('.deck .side-count');
  const item = document.querySelector('.deck .side-item');
  return {
    deckClasses: deck ? deck.className : null,
    bodyHasMin: body.classList.contains('sidebar-minimized'),
    deckWidth: deck ? deck.getBoundingClientRect().width : null,
    countDisplay: count ? getComputedStyle(count).display : 'NO .side-count',
    countText: count ? count.textContent : null,
    itemHTML: item ? item.outerHTML.slice(0, 300) : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path:'verify_out/sidebar_min.png', clip:{x:0,y:0,width:120,height:1000} });
await browser.close();
