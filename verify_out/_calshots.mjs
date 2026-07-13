import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
// week view desktop
let page = await (await browser.newContext({ viewport:{width:1280,height:900} })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham',{waitUntil:'networkidle'});
await page.waitForTimeout(1100);
await page.evaluate(()=>{try{localStorage.setItem('questhq:onboarded','1');}catch(e){}const r=document.querySelector('.tour-root');if(r)r.remove();});
await page.click('#viewBtn');await page.waitForTimeout(200);await page.click('[data-layout="calendar"]');await page.waitForTimeout(300);
await page.click('[data-cal-mode="week"]');await page.waitForTimeout(400);
await page.screenshot({path:'verify_out/cal_week.png'});
await page.context().close();
// mobile month + tap a day with tasks
page = await (await browser.newContext({ viewport:{width:420,height:880} })).newPage();
await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham',{waitUntil:'networkidle'});
await page.waitForTimeout(1100);
await page.evaluate(()=>{try{localStorage.setItem('questhq:onboarded','1');}catch(e){}const r=document.querySelector('.tour-root');if(r)r.remove();});
await page.click('#viewBtn');await page.waitForTimeout(200);await page.click('[data-layout="calendar"]');await page.waitForTimeout(400);
await page.click('.cal-cell.has-tasks');await page.waitForTimeout(400);
await page.screenshot({path:'verify_out/cal_mobile_daytap.png', fullPage:true});
await page.context().close();
await browser.close();
console.log('shots done');
