import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1320, height: 1000 } })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const dbg = await page.evaluate(() => {
  const id = App.taskModel.all()[0]?.id;
  App.controller.selectTask(id);
  return {
    selId: App.controller.uiState.selectedTaskId,
    view: App.controller.uiState.view,
    wrapExists: !!document.getElementById('taskDetailWrap'),
    wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
    detailParent: document.getElementById('detailPane')?.parentElement?.id,
    backBtn: !!document.querySelector('.detail-back'),
    title: document.querySelector('.detail-title')?.textContent?.slice(0,40),
  };
});
console.log('AFTER selectTask:', JSON.stringify(dbg));
console.log('errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
await browser.close();
