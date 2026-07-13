import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [520, 400, 360]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1.5 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(()=>{ try{localStorage.setItem('questhq:onboarded','1');}catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });
  const w = await page.evaluate(() => {
    const up=document.querySelector('.up-next-mount'); const pr=document.querySelector('.progress-widget-mount');
    return { upCardW: Math.round(document.querySelector('.up-next-card').getBoundingClientRect().width),
      progVisible: pr?getComputedStyle(pr).display!=='none':false,
      progCardW: pr&&pr.querySelector('.progress-card')?Math.round(pr.querySelector('.progress-card').getBoundingClientRect().width):0,
      stacked: up&&pr ? (Math.round(pr.getBoundingClientRect().top) > Math.round(up.getBoundingClientRect().bottom)-5) : null };
  });
  console.log(`${wv}px ->`, JSON.stringify(w));
  const el = await page.$('.page-head-widgets');
  if (el) await el.screenshot({ path:`verify_out/wid_after_${wv}.png` });
  await page.context().close();
}
await browser.close();
