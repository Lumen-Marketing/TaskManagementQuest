import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport:{width:900,height:560}, deviceScaleFactor:1 });
const page = await ctx.newPage();
page.on('pageerror',e=>console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
await page.waitForTimeout(1500);
await page.evaluate(() => window.App.LoaderView.hide());
// Poll context-lost + a center-pixel sample across the finish ramp + into fade.
for (const t of [120, 300, 500, 800]) {
  await page.waitForTimeout(t === 120 ? 120 : 0);
  const info = await page.evaluate((tt) => new Promise(res => {
    setTimeout(() => {
      const cv = document.querySelector('.ldr-canvas');
      const gl = cv && cv.getContext('webgl', { alpha:false });
      let lost = null, sample = null;
      if (gl) {
        lost = gl.isContextLost();
        try {
          const px = new Uint8Array(4);
          gl.readPixels(Math.floor(cv.width/2), Math.floor(cv.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          sample = Array.from(px);
        } catch (e) { sample = 'err:'+e.message; }
      }
      const r = document.getElementById('appLoader');
      res({ t: tt, present: !!r, hiding: r && r.classList.contains('is-hiding'), opacity: r && getComputedStyle(r).opacity, contextLost: lost, centerPixel: sample });
    }, 0);
  }), t);
  console.log(JSON.stringify(info));
  if (t !== 120) await page.waitForTimeout(200);
}
await browser.close();
