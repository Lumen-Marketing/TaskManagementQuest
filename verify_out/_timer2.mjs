import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [877, 768, 600, 400]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:900}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(()=>{ try{localStorage.setItem('questhq:onboarded','1');}catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  const r = await page.evaluate(() => {
    const row=document.querySelector('.list-row'); const t=row.querySelector('.timer-btn'); const f=row.querySelector('.finish-btn');
    const tb=t.getBoundingClientRect(), fb=f.getBoundingClientRect();
    return { timerShown: getComputedStyle(t).display!=='none' && !t.classList.contains('hidden'),
      timer:`${Math.round(tb.width)}x${Math.round(tb.height)}`, finish:`${Math.round(fb.width)}x${Math.round(fb.height)}`,
      overlap: Math.max(0, Math.min(tb.right,fb.right)-Math.max(tb.left,fb.left)) };
  });
  console.log(`${wv}px -> timerShown=${r.timerShown} timer=${r.timer} finish=${r.finish} overlap=${r.overlap}`);
  await page.context().close();
}
await browser.close();
