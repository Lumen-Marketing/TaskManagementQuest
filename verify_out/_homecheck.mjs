import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });

async function check(role, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:4188/app.html?preview=1&role=${role}&member=abraham`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => App.controller.setView('home'));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    stats: document.querySelectorAll('.qhq-stat').length,
    actions: document.querySelectorAll('.qhq-act').length,
    upNext: document.querySelectorAll('.qhq-un-row').length,
    upEmpty: document.querySelectorAll('.qhq-unlist .qhq-empty').length,
    recents: document.querySelectorAll('.qhq-rec-row').length,
    recEmpty: document.querySelectorAll('.qhq-reclist .qhq-empty').length,
    recMeta: document.querySelector('.qhq-recents .meta')?.textContent,
  }));
  await page.screenshot({ path: `verify_out/home_${role}_${vp.width}.png`, fullPage: true });
  console.log(role + ' ' + vp.width + ' ' + JSON.stringify(r) + ' errs=' + JSON.stringify(errs.filter(e => !/env\.json|404/.test(e))));
  await page.close();
}

await check('admin', { width: 1320, height: 1000 });
await check('worker', { width: 1320, height: 1000 });
await check('admin', { width: 390, height: 780 });
await browser.close();
