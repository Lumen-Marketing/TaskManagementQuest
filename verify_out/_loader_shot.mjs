import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: [
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});

const shots = [
  { name: 'desktop', width: 1280, height: 800, waits: [800, 2600] },
  { name: 'mobile', width: 390, height: 844, waits: [2600] },
];

for (const s of shots) {
  for (const w of s.waits) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await page.goto('http://localhost:4173/loader-preview.html', { waitUntil: 'load' });
    // Report whether a real WebGL context was acquired vs. the CSS fallback.
    await page.waitForTimeout(w);
    const diag = await page.evaluate(() => {
      const c = document.querySelector('.ldr-canvas');
      const fb = document.querySelector('.ldr-intro.ldr-fallback');
      return {
        hasCanvas: !!c,
        canvasHidden: c ? getComputedStyle(c).display === 'none' : null,
        fallback: !!fb,
        canvasPx: c ? [c.width, c.height] : null,
      };
    });
    console.log(`[${s.name}@${w}ms]`, JSON.stringify(diag), errs.length ? ('ERR ' + errs.join(' | ')) : 'no-errors');
    await page.screenshot({ path: `verify_out/loader_${s.name}_${w}.png` });
    await ctx.close();
  }
}
await browser.close();
