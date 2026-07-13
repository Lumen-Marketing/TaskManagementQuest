import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ viewport:{width:500,height:850}, deviceScaleFactor:1 })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(1000);
// dismiss tour
await page.evaluate(() => { try{ localStorage.setItem('questhq:onboarded','1'); }catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });
const skip = page.locator('button:has-text("Skip")'); if (await skip.count()) await skip.first().click().catch(()=>{});
await page.keyboard.press('Escape').catch(()=>{});
await page.waitForTimeout(400);
await page.evaluate(() => { const r=document.querySelector('.tour-root'); if(r) r.remove(); });
await page.locator('.list-row').first().click();
await page.waitForTimeout(900);
const info = await page.evaluate(() => {
  const d = document.getElementById('detailPane');
  const modal = document.querySelector('.modal-detail');
  const cs = d ? getComputedStyle(d) : null;
  return { inModal: !!(modal && modal.contains(d)), position: cs&&cs.position, background: cs&&cs.backgroundColor,
    rect: d ? (r=>({y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(d.getBoundingClientRect()) : null };
});
console.log(JSON.stringify(info));
await page.screenshot({ path:'verify_out/detail_after.png' });
await browser.close();
