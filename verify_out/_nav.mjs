import { chromium } from '@playwright/test';
const URL = 'http://localhost:4173/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });

const measure = () => {
  const q = s => document.querySelector(s);
  const vw = window.innerWidth;
  const w = el => el ? Math.round(el.getBoundingClientRect().width) : null;
  const vis = el => el ? getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 : false;
  const tr = q('.topbar-right');
  const maxR = el => el ? Math.max(0,...[...el.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect().right)) : 0;
  return {
    vw,
    searchW: w(q('.search')),
    brandVisible: vis(q('.brand-name')),
    viewasW: w(q('.viewas-switcher')),
    clockW: w(q('.clock-widget')),
    topbarClip: Math.round(maxR(tr) - vw),
    pageOverflow: document.documentElement.scrollWidth - vw,
  };
};

for (const wv of [700, 640, 600, 540, 500, 460, 400, 360]) {
  const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { width: wv, height: 850 } })).newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const before = await page.evaluate(measure);
  // test search expand on focus
  let expanded = null;
  try { await page.focus('#searchInput'); await page.waitForTimeout(300); expanded = await page.evaluate(() => Math.round(document.querySelector('.search').getBoundingClientRect().width)); } catch {}
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(200);
  console.log(`${String(wv).padStart(4)}px  search=${before.searchW}->focus${expanded}  brand=${before.brandVisible?'shown':'hidden'}  viewas=${before.viewasW}  clock=${before.clockW}  topbarClip=${before.topbarClip}  pageOverflow=${before.pageOverflow}`);
  if ([700,500,360].includes(wv)) await page.screenshot({ path: `verify_out/nav_${wv}.png` });
  await page.context().close();
}
await browser.close();
