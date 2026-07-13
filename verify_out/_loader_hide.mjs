import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport:{width:1000,height:640}, deviceScaleFactor:1 });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
// Simulate the light app sitting behind the loader so a black hard-cut would show.
await page.evaluate(() => { document.documentElement.style.background = '#FBFAF8'; document.body.style.background = '#FBFAF8'; });
await page.waitForTimeout(1500); // past MIN_MS; terminal is mid materialize
await page.screenshot({ path:'verify_out/hide_0_before.png' });

// Trigger the graceful hide and sample frames through finish-ramp + fade.
await page.evaluate(() => window.App.LoaderView.hide());
const marks = [60, 380, 560, 780, 950];
let prev = 0;
for (const t of marks) {
  await page.waitForTimeout(t - prev); prev = t;
  const st = await page.evaluate(() => {
    const r = document.getElementById('appLoader');
    return { present: !!r, opacity: r ? getComputedStyle(r).opacity : null, hiding: r ? r.classList.contains('is-hiding') : null };
  });
  console.log(`t+${t}ms`, JSON.stringify(st));
  if (st.present) await page.screenshot({ path:`verify_out/hide_${t}.png` });
}
console.log(errs.length?('ERR '+errs.join(' | ')):'no-errors');
await browser.close();
