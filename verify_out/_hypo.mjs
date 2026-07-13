import { chromium } from '@playwright/test';
const URL = 'http://localhost:4173/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

async function snap(label) {
  const r = await page.evaluate(() => {
    const app = document.querySelector('.app');
    const tb = document.querySelector('.work-toolbar');
    const tr = document.querySelector('.topbar-right');
    const vw = window.innerWidth;
    const rows = new Set();
    tb && tb.querySelectorAll(':scope > .btn').forEach(b => rows.add(Math.round(b.getBoundingClientRect().top)));
    const maxRightTb = tb ? Math.max(...[...tb.querySelectorAll(':scope > *')].map(c=>c.getBoundingClientRect().right)) : 0;
    const maxRightTr = tr ? Math.max(...[...tr.querySelectorAll(':scope > *')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect().right)) : 0;
    return { vw, appW: app? Math.round(app.getBoundingClientRect().width):0,
      toolbarCW: tb?Math.round(tb.clientWidth):0, toolbarRows: rows.size,
      toolbarMaxRight: Math.round(maxRightTb), toolbarClipPastVw: Math.round(maxRightTb - vw),
      topbarMaxRight: Math.round(maxRightTr), topbarClipPastVw: Math.round(maxRightTr - vw) };
  });
  console.log(`  [${label}] ${JSON.stringify(r)}`);
  return r;
}

for (const w of [390, 414]) {
  await page.setViewportSize({ width: w, height: 850 });
  await page.waitForTimeout(400);
  console.log(`\n=== ${w}px ===`);
  await snap('BEFORE');

  // Apply candidate fix via injected stylesheet
  await page.addStyleTag({ content: `
    @media (max-width: 720px) {
      body .app { grid-template-columns: minmax(0, 1fr) !important; }
      .topbar-right { flex-wrap: wrap !important; justify-content: flex-end !important; row-gap: 4px; }
    }
  `});
  await page.waitForTimeout(400);
  await snap('AFTER');
  await page.screenshot({ path: `verify_out/hypo_${w}.png` });
}
await browser.close();
console.log('\ndone');
