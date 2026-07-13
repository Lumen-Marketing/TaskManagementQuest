import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport:{width:1280,height:800} })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const info = await page.evaluate(() => {
  const seg = document.getElementById('scopeSeg');
  const tl = document.querySelector('.topbar-left');
  const allBtn = document.querySelector('.seg button[data-scope="all"]');
  const r = el => el ? el.getBoundingClientRect() : null;
  return {
    segDisplay: seg ? getComputedStyle(seg).display : 'NONE',
    tlRect: r(tl), allRect: r(allBtn),
    allVisCss: allBtn ? getComputedStyle(allBtn).display+'/'+getComputedStyle(allBtn).visibility : 'NONE'
  };
});
console.log(JSON.stringify(info,null,1));
await page.screenshot({ path:'verify_out/redesign_t5_full.png' });
await browser.close();
