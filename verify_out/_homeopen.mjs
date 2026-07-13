import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => App.controller.setView('home'));
await page.waitForTimeout(600);
// open a task while on Home
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id));
await page.waitForTimeout(500);
const r = await page.evaluate(() => ({
  view: App.controller.uiState.view,
  homeHidden: document.getElementById('homeWrap')?.classList.contains('hidden'),
  reportsHidden: document.getElementById('reportsWrap')?.classList.contains('hidden'),
  listHidden: document.getElementById('listPane')?.classList.contains('hidden'),
  detailHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
  homeVisibleBox: (() => { const e=document.getElementById('homeWrap'); const b=e.getBoundingClientRect(); return b.height>0 && !e.classList.contains('hidden'); })(),
}));
console.log('HOME->OPEN TASK:', JSON.stringify(r));
await page.screenshot({ path: 'verify_out/home_open_bug.png' });
await browser.close();
