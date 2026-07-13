import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
for (const role of ['worker','admin']) {
  const page = await (await browser.newContext({ viewport:{width:1280,height:800} })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`http://localhost:4188/app.html?preview=1&role=${role}&member=abraham`, { waitUntil:'networkidle' });
  await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const homeNav = !!document.querySelector('.side-item[data-view="home"]');
    const reportsNav = !!document.querySelector('.side-item[data-view="reports"]');
    App.controller.setView('home');
    const homeShown = !document.getElementById('homeWrap').classList.contains('hidden') && document.getElementById('listPane').classList.contains('hidden');
    return { canHome: App.controller.canView('home'), canReports: App.controller.canView('reports'), homeNav, reportsNav, homeShown };
  });
  console.log(role, JSON.stringify(r), 'errs=', errs.length?errs:'none');
  await page.close();
}
await browser.close();
