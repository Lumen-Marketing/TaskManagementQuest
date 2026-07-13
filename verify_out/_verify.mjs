import { chromium } from '@playwright/test';
const URL = 'http://localhost:4173/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });

const measure = () => {
  const tb = document.querySelector('.work-toolbar');
  const tr = document.querySelector('.topbar-right');
  const vw = window.innerWidth;
  const maxR = el => el ? Math.max(0,...[...el.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect().right)) : 0;
  return { vw, pageOverflow: document.documentElement.scrollWidth - vw,
    toolbarClip: Math.round(maxR(tb)-vw), topbarClip: Math.round(maxR(tr)-vw) };
};

let fail = 0;
for (const w of [320, 360, 390, 414, 600, 720, 768, 820, 900, 1024, 1280, 1440]) {
  const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { width: w, height: 850 } })).newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(measure);
  const ok = r.pageOverflow <= 1 && r.toolbarClip <= 1 && r.topbarClip <= 1;
  if (!ok) fail++;
  console.log(`${ok?'PASS':'FAIL'} ${String(w).padStart(4)}px  pageOverflow=${r.pageOverflow}  toolbarClip=${r.toolbarClip}  topbarClip=${r.topbarClip}`);
  if ([390,768,1024].includes(w)) await page.screenshot({ path: `verify_out/fixed_${w}.png` });
  await page.context().close();
}
await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
