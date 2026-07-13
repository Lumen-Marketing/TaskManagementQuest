import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const BASE = 'http://localhost:4188/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport:{width:1320,height:1000}, deviceScaleFactor:1 })).newPage();
await page.goto(BASE, { waitUntil:'networkidle' });
await page.waitForTimeout(900);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

async function shot(name, view) {
  await page.evaluate(v => App.controller.setView(v), view);
  await page.waitForTimeout(700);
  await page.screenshot({ path:`verify_out/p3_${name}.png` });
}
await shot('timeresource', 'time:resource');
await shot('timemine', 'time:mine');
await shot('hierarchy2', 'team:hierarchy');

// modal over the list
await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
await page.waitForTimeout(400);
await page.evaluate(() => App.controller.openNewTaskModal && App.controller.openNewTaskModal());
await page.waitForTimeout(700);
await page.screenshot({ path:'verify_out/p3_modal.png' });

console.log('view=' + await page.evaluate(()=>App.controller.uiState && App.controller.uiState.view));
await browser.close();
