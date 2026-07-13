import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
// Force-load Fraunces explicitly.
const loaded = await page.evaluate(async () => {
  try { await document.fonts.load('500 28px "Fraunces"'); await document.fonts.load('600 28px "Fraunces"'); } catch(e){}
  await document.fonts.ready;
  return document.fonts.check('500 28px "Fraunces"');
});
await page.waitForTimeout(300);
const r = await page.evaluate(() => {
  const el = document.querySelector('.page-title');
  const range = document.createRange(); range.selectNodeContents(el);
  return {
    titleFontNow: getComputedStyle(el).fontFamily.split(',')[0],
    card: +document.querySelector('.task-group').getBoundingClientRect().left.toFixed(2),
    elLeft: +el.getBoundingClientRect().left.toFixed(2),
    glyphLeft: +range.getBoundingClientRect().left.toFixed(2),
  };
});
console.log('FraunsesLoaded=', loaded, JSON.stringify(r));
await page.screenshot({ path: 'verify_out/fr_crop.png', clip: { x: 255, y: 165, width: 300, height: 150 } });
await browser.close();
