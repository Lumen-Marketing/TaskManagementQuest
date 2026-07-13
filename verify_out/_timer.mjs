import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [500, 390]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:900}, deviceScaleFactor:1.5 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(1100);
  await page.evaluate(()=>{ try{localStorage.setItem('questhq:onboarded','1');}catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  const r = await page.evaluate(() => {
    const row=document.querySelector('.list-row'); if(!row) return {err:'no row'};
    const t=row.querySelector('.timer-btn'); const f=row.querySelector('.finish-btn');
    const tb=t?t.getBoundingClientRect():null, fb=f?f.getBoundingClientRect():null;
    const tHidden = t? t.classList.contains('hidden') : 'no-el';
    const tDisp = t? getComputedStyle(t).display : null;
    const overlap = (tb&&fb)? Math.max(0, Math.min(tb.right,fb.right)-Math.max(tb.left,fb.left)) : null;
    return { timerHidden:tHidden, timerDisplay:tDisp,
      timer: tb?`${Math.round(tb.width)}x${Math.round(tb.height)} @${Math.round(tb.left)}`:null,
      finish: fb?`${Math.round(fb.width)}x${Math.round(fb.height)} @${Math.round(fb.left)}`:null,
      overlapPx: overlap };
  });
  console.log(`${wv}px ->`, JSON.stringify(r));
  const row = await page.$('.list-row');
  if (row) await row.screenshot({ path:`verify_out/timer_${wv}.png` });
  await page.context().close();
}
await browser.close();
