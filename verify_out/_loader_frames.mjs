import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
async function frame(name, offsetAfterHide) {
  const ctx = await browser.newContext({ viewport:{width:1000,height:640}, deviceScaleFactor:1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
  await page.evaluate(() => { document.documentElement.style.background='#FBFAF8'; document.body.style.background='#FBFAF8'; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.App.LoaderView.hide());
  await page.waitForTimeout(offsetAfterHide);
  const st = await page.evaluate(() => { const r=document.getElementById('appLoader'); return { present:!!r, opacity:r?getComputedStyle(r).opacity:null, hiding:r?r.classList.contains('is-hiding'):null }; });
  console.log(name, JSON.stringify(st));
  await page.screenshot({ path:`verify_out/${name}.png` });
  await ctx.close();
}
await frame('hide_full_at_complete', 360);  // end of finish ramp, pre/at fade start
await frame('hide_mid_fade', 720);          // mid fade — terminal should show over light, not black
await browser.close();
