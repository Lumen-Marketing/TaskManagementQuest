import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
for (const [w,h] of [[390,844],[768,1024]]) {
  const page = await (await browser.newContext({ viewport:{width:w,height:h} })).newPage();
  await page.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
  await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const ov = await page.evaluate(()=>({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth}));
  await page.screenshot({ path:`verify_out/redesign_m_${w}.png` });
  let drawer = 'n/a';
  if (w<=720) {
    await page.locator('.topbar-left').click({position:{x:10,y:16}}).catch(()=>{});
    await page.waitForTimeout(300);
    drawer = await page.evaluate(()=>document.body.classList.contains('sidebar-open'));
    await page.screenshot({ path:`verify_out/redesign_m_${w}_drawer.png` });
  }
  console.log(`W=${w} overflow=${ov.sw>ov.cw+1?('YES '+ov.sw+'>'+ov.cw):'no'} drawerOpens=${drawer}`);
  await page.close();
}
await browser.close();
