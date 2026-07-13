import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport:{width:1280,height:800} })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.locator('#scopeSeg button[data-scope="mine"]').click();
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const view = window.App && App.controller ? App.controller.uiState.view : '??';
  const tl = document.querySelector('.topbar-left');
  const allBtn = document.querySelector('.seg button[data-scope="all"]');
  const cs = el => el ? getComputedStyle(el) : null;
  return {
    view,
    tbVisible: tl ? getComputedStyle(tl.closest('.topbar')).display : '??',
    tlDisplay: tl ? cs(tl).display : '??',
    allRect: allBtn ? allBtn.getBoundingClientRect() : null,
    allDisplay: allBtn ? cs(allBtn).display + '/' + cs(allBtn).visibility : '??',
  };
});
console.log(JSON.stringify(info,null,1));
await page.screenshot({ path:'verify_out/redesign_t5_aftermine.png' });
await browser.close();
