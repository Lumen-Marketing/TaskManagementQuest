import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport:{width:1000,height:640}, deviceScaleFactor:1 });
const page = await ctx.newPage();
page.on('pageerror',e=>console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
await page.waitForTimeout(1500);
console.log('--- before hide ---');
console.log(JSON.stringify(await page.evaluate(dbg), null, 0));
await page.evaluate(() => window.App.LoaderView.hide());
await page.waitForTimeout(380);
console.log('--- 380ms after hide ---');
console.log(JSON.stringify(await page.evaluate(dbg), null, 0));
function dbg() {
  const q = s => document.querySelector(s);
  const cs = el => el ? (({display,opacity,visibility,background}) => ({display,opacity,visibility,bg:(background||'').slice(0,40)}))(getComputedStyle(el)) : null;
  const root = document.getElementById('appLoader');
  const cv = q('.ldr-canvas');
  return {
    rootPresent: !!root,
    rootChildren: root ? root.children.length : null,
    rootHTMLlen: root ? root.innerHTML.length : null,
    intro: cs(q('.ldr-intro')),
    canvasPresent: !!cv,
    canvasWH: cv ? [cv.width, cv.height, cv.clientWidth, cv.clientHeight] : null,
    canvasCss: cs(cv),
    brand: cs(q('.ldr-brand')),
    brandText: q('.ldr-name') ? q('.ldr-name').textContent : null,
  };
}
await browser.close();
