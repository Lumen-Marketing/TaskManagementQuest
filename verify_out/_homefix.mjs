import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
async function snap(label){ return await page.evaluate(()=>({view:App.controller.uiState.view, home:!document.getElementById('homeWrap').classList.contains('hidden'), reports:!document.getElementById('reportsWrap').classList.contains('hidden'), list:!document.getElementById('listPane').classList.contains('hidden'), detail:!document.getElementById('taskDetailWrap').classList.contains('hidden')})); }
// HOME: open then close
await page.evaluate(() => App.controller.setView('home')); await page.waitForTimeout(400);
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[0].id)); await page.waitForTimeout(400);
console.log('home+open ', JSON.stringify(await snap()));
await page.evaluate(() => App.controller.closeDetail()); await page.waitForTimeout(400);
console.log('home+close', JSON.stringify(await snap()));
// REPORTS: open then close
await page.evaluate(() => App.controller.setView('reports')); await page.waitForTimeout(400);
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[1].id)); await page.waitForTimeout(400);
console.log('rep+open  ', JSON.stringify(await snap()));
await page.evaluate(() => App.controller.closeDetail()); await page.waitForTimeout(400);
console.log('rep+close ', JSON.stringify(await snap()));
// LIST: open then close
await page.evaluate(() => App.controller.setView('all')); await page.waitForTimeout(400);
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[2].id)); await page.waitForTimeout(400);
console.log('list+open ', JSON.stringify(await snap()));
await page.evaluate(() => App.controller.closeDetail()); await page.waitForTimeout(400);
console.log('list+close', JSON.stringify(await snap()));
console.log('errs=' + JSON.stringify(errs.filter(e=>!/env\.json|404|Failed to load resource/.test(e))));
await browser.close();
