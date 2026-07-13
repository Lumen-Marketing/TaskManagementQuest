import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [600, 500, 440, 360]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const tr = document.querySelector('.topbar-right');
    return [...tr.children].filter(c=>c.getBoundingClientRect().width>0).map(c=>{
      const b=c.getBoundingClientRect();
      return `${(c.id||c.className||'').toString().split(' ')[0].slice(0,11).padEnd(11)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    });
  });
  console.log(`\n${wv}px:`); r.forEach(x=>console.log('  '+x));
  await page.screenshot({ path:`verify_out/size_${wv}.png`, clip:{x:0,y:0,width:wv,height:120} });
}
await browser.close();
