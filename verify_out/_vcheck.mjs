import { chromium } from '@playwright/test';
const URL = 'http://localhost:4173/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });

const measure = () => {
  const topbar = document.querySelector('.topbar');
  const tr = document.querySelector('.topbar-right');
  const main = document.querySelector('.main') || document.querySelector('#mainPane');
  const trBottom = tr ? Math.max(...[...tr.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect().bottom)) : 0;
  const topbarBottom = topbar ? topbar.getBoundingClientRect().bottom : 0;
  const mainTop = main ? main.getBoundingClientRect().top : 0;
  return {
    vw: window.innerWidth,
    topbarBottom: Math.round(topbarBottom),
    trBottom: Math.round(trBottom),
    mainTop: Math.round(mainTop),
    overlapIntoContent: Math.round(trBottom - mainTop), // >0 means icons spill over content
    spillBelowTopbar: Math.round(trBottom - topbarBottom), // >0 means past topbar box
  };
};

for (const w of [360, 390, 414, 600, 720, 768, 820]) {
  const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { width: w, height: 850 } })).newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(measure);
  const ok = r.overlapIntoContent <= 1;
  console.log(`${ok?'OK ':'BAD'} ${String(w).padStart(4)}px  topbarBottom=${r.topbarBottom} trBottom=${r.trBottom} mainTop=${r.mainTop}  overlapIntoContent=${r.overlapIntoContent} spillBelowTopbar=${r.spillBelowTopbar}`);
  if ([390,768].includes(w)) await page.screenshot({ path: `verify_out/vchk_${w}.png` });
  await page.context().close();
}
await browser.close();
