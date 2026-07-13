import { chromium } from '@playwright/test';
const exe = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil: 'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => App.controller.setView('all'));
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const g = document.querySelector('.task-group');
  const probe = (el, label) => { if(!el) return label+': MISSING'; const c=getComputedStyle(el); const b=getComputedStyle(el,'::before');
    return `${label}: borderLeft=${c.borderLeft} | bg=${c.backgroundColor} | ::before{content:${b.content} w:${b.width} bg:${b.backgroundColor} left:${b.left}}`; };
  // What sits at the far-left pixel inside the group?
  const gb = g.getBoundingClientRect();
  const el = document.elementFromPoint(gb.left + 2, gb.top + 40);
  return [
    probe(g, '.task-group'),
    probe(g.querySelector('.group-body'), '.group-body'),
    probe(g.querySelector('.list-row'), '.list-row'),
    'elementAtLeftEdge: ' + (el ? el.className + ' <' + el.tagName + '>' : 'none'),
  ];
});
console.log(out.join('\n'));
await browser.close();
