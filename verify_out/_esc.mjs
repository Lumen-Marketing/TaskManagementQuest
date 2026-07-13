import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const snap = () => page.evaluate(() => ({ sel: App.controller.uiState.selectedTaskId, editing: !!document.querySelector('#edit-title'), detail: !document.getElementById('taskDetailWrap').classList.contains('hidden') }));
// open task
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id)); await page.waitForTimeout(400);
console.log('opened   ', JSON.stringify(await snap()));
// enter edit mode
await page.click('[data-action="edit-task"]'); await page.waitForTimeout(400);
console.log('editing  ', JSON.stringify(await snap()));
// press Esc inside edit title input
await page.focus('#edit-title');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('esc@edit ', JSON.stringify(await snap()), '<-- expect editing:false, detail:true (just exit edit)');
// press Esc again in view mode -> should close detail
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('esc@view ', JSON.stringify(await snap()), '<-- expect detail:false');
await browser.close();
