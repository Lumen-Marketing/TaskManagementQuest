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
