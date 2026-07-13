import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport:{width:800,height:520}, deviceScaleFactor:1 });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
await page.waitForTimeout(1500);
// Instrument inside the page for accurate timing; also read back the live uPageLoadProgress.
const timeline = await page.evaluate(async () => {
  const root = document.getElementById('appLoader');
  const t0 = performance.now();
  const log = [];
  window.App.LoaderView.hide();
  return await new Promise(resolve => {
    const id = setInterval(() => {
      const present = !!root.parentNode;
      log.push({ ms: Math.round(performance.now() - t0), present, hiding: present ? root.classList.contains('is-hiding') : null });
      if (!present) { clearInterval(id); resolve(log); }
      if (performance.now() - t0 > 1800) { clearInterval(id); resolve(log); }
    }, 40);
  });
});
// Condense: first is-hiding=true moment and removal moment.
const firstHiding = timeline.find(x => x.hiding === true);
const removed = timeline.find(x => x.present === false);
console.log('first is-hiding at ~', firstHiding ? firstHiding.ms : 'never', 'ms');
console.log('removed at ~', removed ? removed.ms : 'not within window', 'ms');
console.log('samples:', JSON.stringify(timeline.filter((_,i)=>i%3===0)));
await browser.close();
