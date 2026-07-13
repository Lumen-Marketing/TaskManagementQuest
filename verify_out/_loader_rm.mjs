import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport:{width:1000,height:640}, deviceScaleFactor:1, reducedMotion:'reduce' });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:4173/loader-preview.html',{waitUntil:'load'});
await page.waitForTimeout(1200);
const diag = await page.evaluate(()=>{ const c=document.querySelector('.ldr-canvas'); return { fallback: !!document.querySelector('.ldr-intro.ldr-fallback'), canvasPx: c?[c.width,c.height]:null }; });
console.log('reduced-motion', JSON.stringify(diag), errs.length?('ERR '+errs.join(' | ')):'no-errors');
await page.screenshot({ path:'verify_out/loader_reduced_motion.png' });
await browser.close();
