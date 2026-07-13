import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [440, 360, 320]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900);
  // simulate a profile pic on the avatar
  await page.evaluate(() => {
    const a = document.getElementById('userAvatar');
    a.style.background='transparent';
    const img=document.createElement('img');
    img.src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>';
    img.style.cssText='width:100%;height:100%;border-radius:50%;object-fit:cover;';
    a.replaceChildren(img);
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const a=document.getElementById('userAvatar'); const ab=a.getBoundingClientRect();
    const img=a.querySelector('img'); const ib=img?img.getBoundingClientRect():null;
    const s=document.querySelector('.search'); const sb=s.getBoundingClientRect();
    const si=s.querySelector('i'); const sib=si.getBoundingClientRect(); const sis=getComputedStyle(si);
    return {
      avatar:`${Math.round(ab.width)}x${Math.round(ab.height)} fs=${getComputedStyle(a).flexShrink} flexBasis=${getComputedStyle(a).flexBasis}`,
      img: ib?`${Math.round(ib.width)}x${Math.round(ib.height)}`:null,
      searchBox:`${Math.round(sb.width)}x${Math.round(sb.height)}`,
      searchIcon:`left=${sis.left} pos=${sis.position} iconCenterX=${Math.round(sib.x+sib.width/2 - sb.x)} of ${Math.round(sb.width)}`,
    };
  });
  console.log(`\n${wv}px`); console.log(' ', JSON.stringify(r));
  await page.screenshot({ path:`verify_out/av_${wv}.png`, clip:{x:0,y:0,width:wv,height:90} });
  await page.context().close();
}
await browser.close();
