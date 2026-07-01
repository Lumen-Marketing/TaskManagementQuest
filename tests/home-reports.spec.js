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

test('Home command center: trend cards, two columns, Up next, Recents', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('#homeWrap')).toBeVisible();
  // Trend cards replaced the old flat stat strip; 3 quick actions remain.
  await expect(page.locator('.qhq-trend')).toHaveCount(3);
  await expect(page.locator('.qhq-trend svg.qhq-tspark')).toHaveCount(3);
  await expect(page.locator('.qhq-statstrip')).toHaveCount(0);
  await expect(page.locator('.qhq-act')).toHaveCount(3);
  // Two-column shell.
  await expect(page.locator('.qhq-cc-main')).toBeVisible();
  await expect(page.locator('.qhq-cc-rail')).toBeVisible();
  // Up next renders rows (or its empty state).
  const up = await page.locator('.qhq-un-row').count();
  const upEmpty = await page.locator('.qhq-unlist .qhq-empty').count();
  expect(up + upEmpty).toBeGreaterThan(0);
  // Recents card present.
  await expect(page.locator('.qhq-recents')).toBeVisible();
});

test('period toggle re-renders; mini-calendar day click opens the calendar on that date', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => App.controller.setView('home'));
  // Week/Month toggle keeps 3 trend cards and updates the subtitle.
  await page.locator('.qhq-period button[data-p="month"]').click();
  await expect(page.locator('.qhq-trend')).toHaveCount(3);
  await expect(page.locator('.qhq-cc-rail .qhq-sec-sub')).toContainText('month');
  // Clicking a calendar day jumps to the calendar layout anchored on that date.
  await page.evaluate(() => App.controller.setView('home'));
  const day = page.locator('.qhq-cal-day[data-day]').first();
  const iso = await day.getAttribute('data-day');
  await day.click();
  const state = await page.evaluate(() => ({ layout: App.controller.uiState.layout, anchor: App.controller.uiState.calendarAnchor }));
  expect(state.layout).toBe('calendar');
  expect(state.anchor).toBe(iso);
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
  // Home renders its command center (the old `.qhq-brief` morning brief was removed).
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('.qhq-greet')).toBeVisible();
});
