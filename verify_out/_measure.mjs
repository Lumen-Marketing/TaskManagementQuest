import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const URL = `${BASE}/app.html?preview=1&role=developer&member=abraham`;

const widths = [390, 414, 600, 700, 760, 820];

const browser = await chromium.launch({
  executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

for (const w of widths) {
  await page.setViewportSize({ width: w, height: 850 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const info = (el) => el ? {
      sw: Math.round(el.scrollWidth), cw: Math.round(el.clientWidth),
      clipped: el.scrollWidth - el.clientWidth,
      rectRight: Math.round(el.getBoundingClientRect().right),
    } : null;
    // children of toolbar that extend past the toolbar's right edge
    const tb = q('.work-toolbar');
    const vw = window.innerWidth;
    const tbKids = [];
    if (tb) {
      const tbr = tb.getBoundingClientRect().right;
      tb.querySelectorAll(':scope > *').forEach(c => {
        const b = c.getBoundingClientRect();
        tbKids.push({ t: (c.textContent||'').trim().slice(0,12), right: Math.round(b.right), top: Math.round(b.top), clippedPastTb: Math.round(b.right - tbr), clippedPastVw: Math.round(b.right - vw) });
      });
    }
    const trKids = [];
    const tr = q('.topbar-right');
    if (tr) {
      tr.querySelectorAll(':scope > *').forEach(c => {
        const b = c.getBoundingClientRect();
        if (b.width===0&&b.height===0) return;
        trKids.push({ t: (c.id||c.className||c.textContent||'').toString().trim().slice(0,16), right: Math.round(b.right), clippedPastVw: Math.round(b.right - vw) });
      });
    }
    return {
      vw, docW: document.documentElement.scrollWidth,
      toolbar: info(tb), topbarRight: info(tr),
      tbKids, trKids,
      toolbarBtnCount: tb ? tb.querySelectorAll(':scope > .btn').length : 0,
    };
  });
  console.log(`\n=== ${w}px ===  docW=${r.docW} vw=${r.vw}  pageOverflow=${r.docW - r.vw}`);
  console.log(`  toolbar: ${JSON.stringify(r.toolbar)}  btns=${r.toolbarBtnCount}`);
  r.tbKids.forEach(k => console.log(`    tb-child top=${k.top} right=${k.right} pastTB=${k.clippedPastTb} pastVW=${k.clippedPastVw}  "${k.t}"`));
  console.log(`  topbar-right: ${JSON.stringify(r.topbarRight)}`);
  r.trKids.forEach(k => console.log(`    tr-child right=${k.right} pastVW=${k.clippedPastVw}  "${k.t}"`));
  await page.screenshot({ path: `verify_out/probe_${w}.png` });
}

await browser.close();
console.log('\ndone');
