import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
// (a) baseline: fully materialized, no hide
{
  const ctx = await browser.newContext({ viewport:{width:900,height:560}, deviceScaleFactor:1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
  await page.waitForTimeout(2600);
  await page.screenshot({ path:'verify_out/clean_baseline_full.png', animations:'allow' });
  await ctx.close();
}
// (b) post-hide: finish ramp done (progress forced to 1), fade not yet
{
  const ctx = await browser.newContext({ viewport:{width:900,height:560}, deviceScaleFactor:1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
  await page.waitForTimeout(1500);          // mid-materialize (sparser)
  await page.screenshot({ path:'verify_out/clean_before_hide.png', animations:'allow' });
  await page.evaluate(() => window.App.LoaderView.hide());
  await page.waitForTimeout(340);           // finish ramp ~done, before is-hiding
  const st = await page.evaluate(() => { const r=document.getElementById('appLoader'); return { hiding:r&&r.classList.contains('is-hiding') }; });
  console.log('post-hide state', JSON.stringify(st));
  await page.screenshot({ path:'verify_out/clean_after_finish.png', animations:'allow' });
  await ctx.close();
}
await browser.close();
