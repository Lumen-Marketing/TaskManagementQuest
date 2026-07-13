import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=supervisor&member=jesus', { waitUntil: 'networkidle' });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => {
  const me = App.controller.currentUser;
  const list = App.controller.taskModel.all();
  if (list.length) list[0].watchers = Array.from(new Set([...(list[0].watchers||[]), me]));
  App.controller.setView('watching');
});
await page.evaluate(async () => { try{ await document.fonts.ready; }catch(e){} });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const pane = document.querySelector('.list-pane');
  const cs = getComputedStyle(pane);
  const base = pane.getBoundingClientRect().left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
  const rel = (el) => el ? +(el.getBoundingClientRect().left - base).toFixed(1) : null;
  const glyph = (el) => { if(!el) return null; const g=document.createRange(); g.selectNodeContents(el); return +(g.getBoundingClientRect().left - base).toFixed(1); };
  const pad = (sel,side='paddingLeft') => { const el=document.querySelector(sel); return el? getComputedStyle(el)[side] : null; };
  return {
    listPane_paddingLeft: cs.paddingLeft,
    pageHead: rel(document.querySelector('.page-head')),
    pageHead_padL: pad('.page-head'),
    headCard: rel(document.querySelector('.head-card')),
    headCard_padL: pad('.head-card'),
    headCardTitle_glyph: glyph(document.querySelector('.head-card .head-card-title')),
    taskViewWrap: rel(document.querySelector('#taskViewWrap')),
    taskViewWrap_padL: pad('#taskViewWrap'),
    watchingView: rel(document.querySelector('.watching-view')),
    watchingView_padL: pad('.watching-view'),
    sectionHeadIcon: rel(document.querySelector('.watch-section-head')),
    watchCard: rel(document.querySelector('.watch-cards > *')),
    teamGrid_padL: pad('.team-grid'),
    teamCard: rel(document.querySelector('.team-card')),
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
