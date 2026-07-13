import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=supervisor&member=jesus', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// Force a watched task so the "Tasks you're watching" panel has a card, then show the Watching view.
await page.evaluate(() => {
  const me = App.controller.currentUser;
  const tm = App.controller.taskModel;
  const list = tm.all();
  if (list.length) {
    const t = list[0];
    t.watchers = Array.from(new Set([...(t.watchers||[]), me]));
  }
  App.controller.setView('watching');
});
await page.evaluate(async () => { try{ await document.fonts.ready; }catch(e){} });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const L = (sel) => { const el = document.querySelector(sel); return el ? +el.getBoundingClientRect().left.toFixed(1) : null; };
  const glyph = (sel) => { const el = document.querySelector(sel); if(!el) return null; const g=document.createRange(); g.selectNodeContents(el); return +g.getBoundingClientRect().left.toFixed(1); };
  return {
    headCardTitle_glyph: glyph('.head-card .head-card-title'),
    headCard_box: L('.head-card'),
    pageHead_box: L('.page-head'),
    taskViewWrap_box: L('#taskViewWrap'),
    watchingView_box: L('.watching-view'),
    sectionHead_box: L('.watch-section-head'),
    sectionHead_glyph: glyph('.watch-section-head span'),
    watchCard_box: L('.watch-cards > *'),
    teamGrid_box: L('.team-grid'),
    teamCard_box: L('.team-card'),
  };
});
console.log(JSON.stringify(r, null, 2));
const pane = await page.$('.list-pane');
await pane.screenshot({ path: 'verify_out/watch_before.png' });
await browser.close();
