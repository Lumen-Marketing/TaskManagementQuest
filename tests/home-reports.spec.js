// @ts-check
/* Phase-2 — Home + Reports gating and render.
   DB-free: uses the localhost preview bypass (?preview=1), no auth/creds.
   Run with the dev server up (default :4173):
     npx playwright test home-reports.spec.js --project=local
*/
import { test, expect } from '@playwright/test';

const url = role => `/app.html?preview=1&role=${role}&member=abraham`;
async function boot(page, role) {
  await page.goto(url(role), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape'); // dismiss onboarding tour
  await page.waitForTimeout(200);
}

test('Home is available to a worker; Reports is not', async ({ page }) => {
  await boot(page, 'worker');
  await expect(page.locator('.side-item[data-view="home"]')).toBeVisible();
  expect(await page.evaluate(() => App.controller.canView('reports'))).toBe(false);
  expect(await page.locator('.side-item[data-view="reports"]').count()).toBe(0);
});

test('admin sees Reports and can open Home + Reports', async ({ page }) => {
  await boot(page, 'admin');
  expect(await page.evaluate(() => App.controller.canView('reports'))).toBe(true);

  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('#homeWrap')).toBeVisible();
  await expect(page.locator('#listPane')).toBeHidden();
  await expect(page.locator('.qhq-greet')).toContainText('Good');

  await page.evaluate(() => App.controller.setView('reports'));
  await expect(page.locator('#reportsWrap')).toBeVisible();
  await expect(page.locator('.qhq-kpi')).toHaveCount(5);

  // Leaving the page views restores the task list.
  await page.evaluate(() => App.controller.setView('all'));
  await expect(page.locator('#listPane')).toBeVisible();
  await expect(page.locator('#reportsWrap')).toBeHidden();
});

test('Home shows the enrichment widgets (stat strip, Up next, Recents)', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('#homeWrap')).toBeVisible();
  // 4-chip stat strip + 3 quick actions.
  await expect(page.locator('.qhq-stat')).toHaveCount(4);
  await expect(page.locator('.qhq-act')).toHaveCount(3);
  // Up next renders rows (or its empty state).
  const up = await page.locator('.qhq-un-row').count();
  const upEmpty = await page.locator('.qhq-unlist .qhq-empty').count();
  expect(up + upEmpty).toBeGreaterThan(0);
  // Recents card present.
  await expect(page.locator('.qhq-recents')).toBeVisible();
});

test('Recents is team-wide for managers and own-world for workers', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => App.controller.setView('home'));
  await page.waitForTimeout(200);
  const adminRecents = await page.locator('.qhq-rec-row').count();
  await expect(page.locator('.qhq-recents .meta')).toContainText('team');

  await boot(page, 'worker');
  await page.evaluate(() => App.controller.setView('home'));
  await page.waitForTimeout(200);
  const workerRecents = await page.locator('.qhq-rec-row').count();
  await expect(page.locator('.qhq-recents .meta')).toContainText('your');
  // A manager's feed is a superset of (>=) a worker's own-world feed.
  expect(adminRecents).toBeGreaterThanOrEqual(workerRecents);
});

test('the AI ops-brief banner is gone from the task list', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
  await page.waitForTimeout(300);
  // The static `.ai-brief` banner must not exist on any task surface anymore.
  expect(await page.locator('.ai-brief').count()).toBe(0);
  // Home still has its own brief.
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('.qhq-brief')).toBeVisible();
});
