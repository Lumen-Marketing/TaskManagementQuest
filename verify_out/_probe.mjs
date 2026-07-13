import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ viewport:{width:600,height:850} })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const tr = document.querySelector('.topbar-right');
  const cs = getComputedStyle(tr);
  const kids = [...tr.children].filter(c=>c.getBoundingClientRect().width>0).map(c=>({t:(c.id||c.className||'').toString().split(' ')[0].slice(0,12), top:Math.round(c.getBoundingClientRect().top), w:Math.round(c.getBoundingClientRect().width), fs:getComputedStyle(c).flexShrink}));
  return { flexWrap: cs.flexWrap, width: Math.round(tr.getBoundingClientRect().width), display: cs.display, kids };
});
console.log(JSON.stringify(r,null,1));
await browser.close();
