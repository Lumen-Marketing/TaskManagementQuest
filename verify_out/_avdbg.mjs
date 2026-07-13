import { chromium } from '@playwright/test';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [440, 360]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900);
  await page.evaluate((src) => {
    const a=document.getElementById('userAvatar'); a.style.background='transparent';
    const img=document.createElement('img'); img.src=src;
    img.style.cssText='width:100%;height:100%;border-radius:50%;object-fit:cover;';
    a.replaceChildren(img);
  }, PNG);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => { const a=document.getElementById('userAvatar'); const img=a.querySelector('img');
    const ab=a.getBoundingClientRect(), ib=img.getBoundingClientRect();
    return `avatar=${Math.round(ab.width)}x${Math.round(ab.height)} img=${Math.round(ib.width)}x${Math.round(ib.height)}`; });
  console.log(`${wv}px -> ${r}`);
  await page.context().close();
}
await browser.close();
