import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const OUT = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const shots = [
  { view: 'time:resource', file: 'team_workload.png', wait: '.time-table, .empty-title' },
  { view: 'time:mine',     file: 'my_time.png',       wait: '.time-table, .empty-title' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

for (const s of shots) {
  const url = `${BASE}/?preview=1&role=admin&member=abraham&view=${encodeURIComponent(s.view)}`;
  console.log('navigating', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  // Give the SPA time to boot, seed, and render the deep-linked view.
  await page.waitForTimeout(1500);
  try { await page.waitForSelector(s.wait, { timeout: 8000 }); } catch { console.log('  (selector wait timed out, capturing anyway)'); }
  const title = await page.locator('.list-title, h1').first().textContent().catch(() => '');
  console.log('  view title:', (title || '').trim());
  await page.screenshot({ path: `${OUT}${s.file}` });
  console.log('  saved', s.file);
}

await browser.close();
console.log('done');
