import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
for (const wv of [554, 360]) {
  const page = await (await browser.newContext({ viewport:{width:wv,height:850}, deviceScaleFactor:1 })).newPage();
  await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path:`verify_out/onerow_${wv}.png`, clip:{x:0,y:0,width:wv,height:140} });
}
await browser.close();
