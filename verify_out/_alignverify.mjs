import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.evaluate(async () => { try{ await document.fonts.load('500 28px "Fraunces"'); }catch(e){} await document.fonts.ready; });
await page.waitForTimeout(300);
const r = await page.evaluate(() => {
  const el = document.querySelector('.page-title');
  const range = document.createRange(); range.selectNodeContents(el);
  return { font: getComputedStyle(el).fontFamily.split(',')[0],
    card: +document.querySelector('.task-group').getBoundingClientRect().left.toFixed(1),
    glyphLeft: +range.getBoundingClientRect().left.toFixed(1) };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: 'verify_out/align_after.png', clip: { x: 255, y: 160, width: 300, height: 170 } });
await browser.close();
