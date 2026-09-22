// @ts-check
/* The mobile task sheet's shell: how it opens, how it closes, and which
   footer each mode shows. Fields and trays are covered separately. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
});

test('the bottom nav plus opens the sheet, not the full page', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('#newTaskWrap')).toBeHidden();
});

test('new mode is labelled and autofocuses the title', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('NEW TASK');
  await expect(page.locator('.task-sheet .ts-title-in')).toBeFocused();
});

test('new mode footer offers Add task and Save + Another', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet .ts-save')).toHaveText(/Add task/i);
  await expect(page.locator('.task-sheet .ts-save-another')).toBeVisible();
  await expect(page.locator('.task-sheet .ts-delete')).toHaveCount(0);
});

test('edit mode swaps the label and the footer', async ({ page }) => {
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
  await expect(page.locator('.qb-card').first()).toBeVisible();
  await page.locator('.qb-card').first().click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('EDIT TASK');
  await expect(page.locator('.task-sheet .ts-save')).toHaveText(/Save changes/i);
  await expect(page.locator('.task-sheet .ts-delete')).toBeVisible();
  await expect(page.locator('.task-sheet .ts-open-full')).toBeVisible();
});

test('the close button dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await page.locator('.task-sheet .ts-close').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('tapping the scrim dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await page.locator('.quick-sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('Escape dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('an empty title refuses to save without an alert dialog', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await page.locator('#bottomNav [data-nav="new"]').click();
  await page.locator('.task-sheet .ts-save').click();
  await expect(page.locator('.task-sheet')).toBeVisible();          // stays open
  await expect(page.locator('.task-sheet .ts-title-in')).toBeFocused();
  expect(dialog).toBe(false);
});

test('the sheet is a labelled modal dialog', async ({ page }) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  const sheet = page.locator('.task-sheet');
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(sheet).toHaveAttribute('aria-label', /new task/i);
});

test('desktop still opens the full New Task page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => App.controller.openNewTaskPage());
  await expect(page.locator('#newTaskWrap')).toBeVisible();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});
