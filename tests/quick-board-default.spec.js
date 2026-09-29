// @ts-check
/* The quick board is the phone DEFAULT, not a lock: it is chosen when nothing
   else was, and an explicit choice from the layout switcher must survive. */
import { test, expect, dismissOverlays } from './_fixtures.js';

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
  await dismissOverlays(page);
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

test('desktop header, widget row, and task table share compact aligned edges', async ({ page }) => {
  await fresh(page, { width: 1920, height: 900 });
  await page.evaluate(() => App.controller.setView('all'));
  const layout = await page.evaluate(() => {
    const head = document.querySelector('.page-head').getBoundingClientRect();
    const table = document.querySelector('.qt-group').getBoundingClientRect();
    const widgets = [...document.querySelectorAll('.page-head-widgets > :not(:empty)')]
      .map(el => el.getBoundingClientRect());
    return {
      headLeft: head.left, headRight: head.right,
      tableLeft: table.left, tableRight: table.right,
      widgetLeft: widgets[0].left,
      widgetRight: widgets[widgets.length - 1].right,
      gaps: widgets.slice(1).map((box, i) => box.left - widgets[i].right),
    };
  });
  expect(Math.abs(layout.headLeft - layout.tableLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.headRight - layout.tableRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.widgetLeft - layout.headLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.widgetRight - layout.headRight)).toBeLessThanOrEqual(1);
  expect(layout.gaps.every(gap => gap <= 10.5)).toBe(true);
});

test('an old quick-board link restores the table on desktop', async ({ page }) => {
  await fresh(page, DESKTOP);
  await page.goto('/app.html?preview=1#/tasks/quick');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await dismissOverlays(page);
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('table');
  await expect(page.locator('.qb-board')).toHaveCount(0);
  await expect(page.locator('#taskViewWrap.qt-skin')).toBeVisible();
});
