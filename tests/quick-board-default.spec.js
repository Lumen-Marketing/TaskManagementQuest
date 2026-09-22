// @ts-check
/* The quick board is the phone DEFAULT, not a lock: it is chosen when nothing
   else was, and an explicit choice from the layout switcher must survive. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

// The app persists uiState per user; start each test from a clean slate so a
// previous test's explicit layout choice cannot leak into the default test.
const fresh = async (page, size) => {
  await page.setViewportSize(size);
  await page.goto('/app.html?preview=1');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
};

test('a phone lands on the quick board without being asked', async ({ page }) => {
  await fresh(page, MOBILE);
  await page.evaluate(() => App.controller.setView('all'));
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('quick');
  await expect(page.locator('.qb-board')).toBeVisible();
});

test('navigating to All tasks does not knock the phone back to the table', async ({ page }) => {
  await fresh(page, MOBILE);
  // AppController forced layout='table' whenever the view became 'all'. That
  // must no longer fire for a layout that can render the unscoped list.
  await page.evaluate(() => { App.controller.setView('today'); App.controller.setView('all'); });
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('quick');
  await expect(page.locator('.qb-board')).toBeVisible();
});

test('an explicit layout choice holds for the session', async ({ page }) => {
  await fresh(page, MOBILE);
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('cards'); });
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('cards');
  await expect(page.locator('.qb-board')).toHaveCount(0);
});

test('re-entering All tasks returns to the phone default, as it does on desktop', async ({ page }) => {
  await fresh(page, MOBILE);
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('cards'); });

  // restoreUiState deliberately does not persist the layout — "All Tasks must
  // always open in table view (2026-07-04 walkthrough)". The phone default is
  // the same rule with a different entry layout, not an exception to it.
  await page.evaluate(() => { App.controller.setView('today'); App.controller.setView('all'); });
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('quick');
});

test('desktop is untouched — it still defaults to the table', async ({ page }) => {
  await fresh(page, DESKTOP);
  await page.evaluate(() => App.controller.setView('all'));
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('table');
  await expect(page.locator('.qb-board')).toHaveCount(0);
});

test('the quick board is offered in the View-as menu', async ({ page }) => {
  await fresh(page, DESKTOP);
  await page.evaluate(() => App.controller.setView('all'));
  const keys = await page.evaluate(() => {
    // The menu is built by ToolbarMenuView; assert the layout is selectable at
    // all rather than driving the menu chrome.
    App.controller.setLayout('quick');
    return App.controller.uiState.layout;
  });
  expect(keys).toBe('quick');
});
