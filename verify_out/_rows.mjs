import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });

const measure = () => {
  const tr = document.querySelector('.topbar-right');
  const vw = window.innerWidth;
  const kids = [...tr.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0);
  // cluster centers into rows (within 20px = same row)
  const centers = kids.map(c => { const b=c.getBoundingClientRect(); return (b.top+b.bottom)/2; }).sort((a,b)=>a-b);
  const rowCenters = [];
  centers.forEach(c => { if (!rowCenters.some(r => Math.abs(r-c) < 20)) rowCenters.push(c); });
  const maxRight = Math.max(0,...kids.map(c=>c.getBoundingClientRect().right));
  return { vw, rows: rowCenters.length, clip: Math.round(maxRight - vw), pageOverflow: document.documentElement.scrollWidth - vw };
};

let bad = 0;
for (const role of ['developer','admin']) {
  console.log(`\n===== role=${role} =====`);
  const URL = `http://localhost:4173/app.html?preview=1&role=${role}&member=abraham`;
  for (const wv of [900, 820, 768, 720, 680, 640, 600, 560, 520, 480, 440, 400, 375, 360, 320]) {
    const page = await (await browser.newContext({ deviceScaleFactor: 1, viewport: { width: wv, height: 850 } })).newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(measure);
    const ok = r.rows === 1 && r.clip <= 1 && r.pageOverflow <= 1;
    if (!ok) bad++;
    console.log(`${ok?'OK ':'BAD'} ${String(wv).padStart(4)}px rows=${r.rows} clip=${r.clip} pageOverflow=${r.pageOverflow}`);
    await page.context().close();
  }
}
await browser.close();
console.log(bad===0 ? '\n✅ ALL ONE-ROW, NO CLIP' : `\n❌ ${bad} BAD`);
