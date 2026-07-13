import { chromium } from '@playwright/test';
const URL = 'http://localhost:4173/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });

const measure = () => {
  const tb = document.querySelector('.work-toolbar');
  const tr = document.querySelector('.topbar-right');
  const vw = window.innerWidth;
  const maxR = el => el ? Math.max(...[...el.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect().right)) : 0;
  return { vw, toolbarCW: tb?Math.round(tb.clientWidth):0,
    toolbarClip: Math.round(maxR(tb)-vw), topbarClip: Math.round(maxR(tr)-vw),
    topbarRows: tr ? new Set([...tr.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>Math.round(c.getBoundingClientRect().top))).size : 0 };
};

const conditions = {
  none: ``,
  minmaxOnly: `@media (max-width:720px){ body .app{ grid-template-columns:minmax(0,1fr)!important } }`,
  minmaxPlusWrap: `@media (max-width:720px){ body .app{ grid-template-columns:minmax(0,1fr)!important } .topbar-right{ flex-wrap:wrap!important; row-gap:4px; justify-content:flex-end!important } }`,
};

for (const w of [360, 390, 414]) {
  console.log(`\n=== ${w}px ===`);
  for (const [name, css] of Object.entries(conditions)) {
    const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { width: w, height: 850 } })).newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(300);
    const r = await page.evaluate(measure);
    console.log(`  ${name.padEnd(16)} ${JSON.stringify(r)}`);
    if (name === 'minmaxPlusWrap') await page.screenshot({ path: `verify_out/hypo2_${w}.png` });
    await page.context().close();
  }
}
await browser.close();
console.log('\ndone');
