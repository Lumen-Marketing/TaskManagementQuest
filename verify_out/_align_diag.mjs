import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });

for (const w of [1440, 1200, 1100, 1000, 900, 820]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => App.controller.setView('all'));
  await page.evaluate(() => App.controller.setLayout && App.controller.setLayout('table'));
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const row = document.querySelector('.list-row');
    if (!row) return { none: true };
    const cs = getComputedStyle(row);
    const main = document.querySelector('.main');
    return {
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      rowHeight: Math.round(row.getBoundingClientRect().height),
      display: cs.display,
      gridCols: cs.gridTemplateColumns,
      flexWrap: cs.flexWrap,
      withDetail: document.querySelector('.main')?.classList.contains('with-detail') || false,
    };
  });
  console.log(`W=${w}`, JSON.stringify(info));
  await page.locator('.list-row').first().scrollIntoViewIfNeeded().catch(()=>{});
  await page.screenshot({ path: `verify_out/align_${w}.png` });
  await page.close();
}
await browser.close();
