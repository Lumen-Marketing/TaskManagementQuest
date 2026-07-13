import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const errs=[];
const ctx = await browser.newContext({ viewport:{width:1280,height:800} });
// worker
let page = await ctx.newPage(); page.on('pageerror',e=>errs.push('worker:'+e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=worker&member=abraham',{waitUntil:'networkidle'});
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const worker = await page.evaluate(()=>({ homeNav:!!document.querySelector('.side-item[data-view="home"]'), reportsNav:document.querySelectorAll('.side-item[data-view="reports"]').length, canReports:App.controller.canView('reports') }));
await page.close();
// admin
page = await ctx.newPage(); page.on('pageerror',e=>errs.push('admin:'+e.message));
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham',{waitUntil:'networkidle'});
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const admin = await page.evaluate(()=>{
  const r={};
  r.canReports=App.controller.canView('reports');
  App.controller.setView('home');
  r.homeShown=!document.getElementById('homeWrap').classList.contains('hidden')&&document.getElementById('listPane').classList.contains('hidden');
  r.greet=(document.querySelector('.qhq-greet')||{}).textContent||'';
  App.controller.setView('reports');
  r.kpis=document.querySelectorAll('.qhq-kpi').length;
  App.controller.setView('all');
  r.listBack=!document.getElementById('listPane').classList.contains('hidden')&&document.getElementById('reportsWrap').classList.contains('hidden');
  return r;
});
// regression: sweep all views
const sweep=['home','all','mine','overdue','today','watching','reports','time:mine','time:resource','team:hierarchy','approvals','all'];
for (const v of sweep){ await page.evaluate(view=>App.controller.setView(view),v); await page.waitForTimeout(120); }
await page.close();
await browser.close();
console.log('WORKER=',JSON.stringify(worker));
console.log('ADMIN=',JSON.stringify(admin));
console.log('JS_ERRORS=',errs.length?errs:'none');
