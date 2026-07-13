import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const BASE = 'http://localhost:4188/app.html?preview=1&role=developer&member=abraham';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport:{width:1320,height:1000}, deviceScaleFactor:1 })).newPage();
await page.goto(BASE, { waitUntil:'networkidle' });
await page.waitForTimeout(900);
await page.keyboard.press('Escape'); // dismiss tour
await page.waitForTimeout(200);

async function shot(name, setup) {
  await page.evaluate(setup);
  await page.waitForTimeout(650);
  await page.screenshot({ path:`verify_out/p3_${name}.png` });
}

await shot('list',     () => { App.controller.setView('all'); App.controller.setLayout('table'); });
await shot('kanban',   () => { App.controller.setLayout('kanban'); });
await shot('calendar', () => { App.controller.setLayout('calendar'); });
await shot('time',     () => { App.controller.setLayout('table'); App.controller.setView('time'); });
await shot('approvals',() => { App.controller.setView('approvals'); });
await shot('hierarchy',() => { App.controller.setView('hierarchy'); });

// detail pane: open first visible task
await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
await page.waitForTimeout(400);
const firstId = await page.evaluate(() => {
  const t = App.controller.visibleTasks ? App.controller.visibleTasks({includeDone:false})[0] : null;
  if (t) App.controller.selectTask(t.id);
  return t ? t.id : null;
});
await page.waitForTimeout(600);
await page.screenshot({ path:'verify_out/p3_detail.png' });

// new-task modal
await page.evaluate(() => App.controller.openNewTaskModal && App.controller.openNewTaskModal());
await page.waitForTimeout(600);
await page.screenshot({ path:'verify_out/p3_modal.png' });

console.log('done firstId=' + firstId);
await browser.close();
