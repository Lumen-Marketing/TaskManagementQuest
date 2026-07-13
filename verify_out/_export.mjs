import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const ctx = await browser.newContext({ viewport:{width:1280,height:900}, acceptDownloads:true });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{ if(m.type()==='error' && !/env\.json|Configuration|challenges|Intervention/.test(m.text())) errs.push(m.text()); });
await page.goto('http://localhost:4173/app.html?preview=1&role=developer&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(()=>{ try{localStorage.setItem('questhq:onboarded','1');}catch(e){} const r=document.querySelector('.tour-root'); if(r) r.remove(); });

async function doExport(which) {
  await page.click('#exportBtn'); await page.waitForTimeout(250);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click(`[data-export="${which}"]`),
  ]);
  const p = await dl.path();
  const txt = await readFile(p, 'utf8');
  const lines = txt.trim().split(/\r?\n/);
  return { name: dl.suggestedFilename(), lines: lines.length, header: lines[0], sample: lines[1] };
}

const t = await doExport('tasks');
console.log('TASKS:', JSON.stringify(t,null,1));
const tm = await doExport('time');
console.log('TIME:', JSON.stringify(tm,null,1));

// calendar week label check
await page.click('#viewBtn'); await page.waitForTimeout(200); await page.click('[data-layout="calendar"]'); await page.waitForTimeout(300);
await page.click('[data-cal-mode="week"]'); await page.waitForTimeout(300);
const wl = await page.evaluate(()=> (document.querySelector('.cal-label')||{}).textContent);
console.log('WEEK LABEL:', wl);
console.log(errs.length?('ERRORS: '+errs.join(' | ')):'NO JS ERRORS');
await browser.close();
