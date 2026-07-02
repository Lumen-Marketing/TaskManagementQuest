// @ts-check
/* Phase-1 redesign chrome — topbar title + scope segment.
   DB-free: uses the localhost preview bypass (?preview=1) so it needs no auth or
   TEST_* creds. Run with the dev server on LOCAL_BASE_URL (default :4173):
     npm run dev            # or: PORT=4173 node tools/dev-server.mjs
     npx playwright test redesign-topbar.spec.js --project=local
*/
import { test, expect } from '@playwright/test';

const APP = '/app.html?preview=1&role=developer&member=abraham';

async function boot(page) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // Dismiss the onboarding tour overlay (Esc counts as seen) so it can't
  // intercept clicks on the chrome.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test('scope segment filters in place instead of navigating', async ({ page }) => {
  await boot(page);

  // Company is the default scope; flipping to My work must NOT change views.
  await page.locator('#scopeSeg button[data-scope="mine"]').click();
  await expect(page.locator('.seg button[data-scope="mine"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#tbTitle')).toHaveText('All tasks');

  // The scope survives switching to a quick-filter view (Urgent) — that's the
  // whole point: "my urgent tasks" without leaving Urgent.
  await page.locator('.pnav-item[data-nav="tasks"]').click();
  await page.locator('.pnav-menu-item[data-view="hot"]').click();
  await expect(page.locator('#tbTitle')).toHaveText('Urgent');
  await expect(page.locator('.seg button[data-scope="mine"]')).toHaveClass(/\bon\b/);

  await page.locator('#scopeSeg button[data-scope="all"]').click();
  await expect(page.locator('.seg button[data-scope="all"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#tbTitle')).toHaveText('Urgent');
});

test('Ask Quest focuses the search input', async ({ page }) => {
  await boot(page);
  await page.locator('#askQuestBtn').click();
  const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id);
  expect(focusedId).toBe('searchInput');
});

test('sidebar shows the redesigned Personal / Team / Workspaces groups', async ({ page }) => {
  await boot(page);
  const labels = await page.$$eval('.deck .side-label', els => els.map(e => e.textContent.trim()));
  expect(labels).toContain('Personal');
  expect(labels).toContain('Team');
  expect(labels).toContain('Workspaces');
});
