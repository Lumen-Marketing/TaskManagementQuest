import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
async function shot(w, h, tag) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await page.goto('http://localhost:4188/app.html?preview=1&role=supervisor&member=jesus', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.evaluate(() => {
    const me = App.controller.currentUser;
    const list = App.controller.taskModel.all();
    if (list.length) list[0].watchers = Array.from(new Set([...(list[0].watchers||[]), me]));
    App.controller.setView('watching');
  });
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const rel = (el,base) => el ? +(el.getBoundingClientRect().left - base).toFixed(1) : null;
    const pane = q('.list-pane'); const b = pane.getBoundingClientRect().left + parseFloat(getComputedStyle(pane).paddingLeft);
    const gl = el => { if(!el) return null; const g=document.createRange(); g.selectNodeContents(el); return +(g.getBoundingClientRect().left-b).toFixed(1); };
    return { title: gl(q('.head-card .head-card-title')), headCardEdge: rel(q('.head-card'),b), watchCard: rel(q('.watch-cards>*'),b), teamCard: rel(q('.team-card'),b), overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  console.log(tag, JSON.stringify(r));
  await page.screenshot({ path: `verify_out/watch_${tag}.png`, fullPage: false });
  await page.close();
}
await shot(1280, 860, 'w1280');
await shot(390, 780, 'mobile');
await browser.close();
