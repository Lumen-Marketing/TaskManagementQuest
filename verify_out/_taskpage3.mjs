import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport: { width: 1320, height: 1000 } })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// Realistic click: the task title text inside the first row.
await page.click('#listBody .list-row .task-title, #listBody .list-row .title, #listBody .list-row [data-col="title"]', { timeout: 4000 }).catch(async () => {
  // fallback: click the row's left area (avatar/title region, x=200)
  const box = await (await page.$('#listBody .list-row')).boundingBox();
  await page.mouse.click(box.x + 200, box.y + box.height/2);
});
await page.waitForTimeout(600);
const open = await page.evaluate(() => ({
  wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
  listHidden: document.getElementById('listPane')?.classList.contains('hidden'),
  detailParent: document.getElementById('detailPane')?.parentElement?.id,
  title: document.querySelector('.detail-title')?.textContent?.slice(0,40),
}));
console.log('OPEN via row click:', JSON.stringify(open));
await page.screenshot({ path: 'verify_out/taskpage_open.png' });

await page.click('.detail-back');
await page.waitForTimeout(500);
const closed = await page.evaluate(() => ({
  wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'),
  listHidden: document.getElementById('listPane')?.classList.contains('hidden'),
  rows: document.querySelectorAll('#listBody .list-row').length,
}));
console.log('CLOSED via Back:', JSON.stringify(closed));
await page.screenshot({ path: 'verify_out/taskpage_closed.png' });

// Esc test: open again then Esc
await page.evaluate(() => App.controller.selectTask(App.taskModel.all()[1].id));
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const esc = await page.evaluate(() => ({ wrapHidden: document.getElementById('taskDetailWrap')?.classList.contains('hidden'), listHidden: document.getElementById('listPane')?.classList.contains('hidden') }));
console.log('AFTER Esc:', JSON.stringify(esc));
console.log('errs=' + JSON.stringify(errs.filter(e => !/env\.json|404|Failed to load resource/.test(e))));
await browser.close();
