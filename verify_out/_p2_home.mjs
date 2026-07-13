import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs=[];
for (const [w,h,tag] of [[1280,860,'desktop'],[390,844,'mobile']]) {
  const page = await (await browser.newContext({ viewport:{width:w,height:h} })).newPage();
  page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(()=>App.controller.setView('home'));
  await page.waitForTimeout(300);
  if (tag==='desktop') {
    const txt = await page.locator('.qhq-dateline').textContent();
    console.log('DATELINE=', txt);
    console.log('ATRISK_ROWS=', await page.locator('.qhq-ar-row').count());
  }
  await page.screenshot({ path:`verify_out/p2_home_${tag}.png` });
  await page.close();
}
console.log('JS_ERRORS=', errs.length?errs:'none');
await browser.close();
