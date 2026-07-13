import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [360, 1280]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { try{localStorage.setItem('questhq:onboarded','1');}catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  await page.keyboard.press('Escape').catch(()=>{});
  await page.evaluate(() => { const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  await page.locator('.list-row').first().click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const d=document.getElementById('detailPane'); const cs=getComputedStyle(d); const b=d.getBoundingClientRect(); return {position:cs.position, top:Math.round(b.y), bg:getComputedStyle(d.closest('.modal')||d).backgroundColor}; });
  console.log(`${wv}px -> position=${r.position} modalTop=${r.top} modalBg=${r.bg}`);
  await page.screenshot({ path:`verify_out/detail_${wv}.png` });
  await page.context().close();
}
await browser.close();
