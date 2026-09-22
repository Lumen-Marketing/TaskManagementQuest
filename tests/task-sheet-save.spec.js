// @ts-check
/* Saving, editing, batch entry and the toasts. */
import { test, expect, dismissOverlays } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

const openSheet = async (page) => {
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await dismissOverlays(page);
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
});

test('Add task saves, closes the sheet and lands the card on the board', async ({ page }) => {
  const before = await page.locator('.qb-card').count();
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Fix drip edge at Simmons');
  await page.locator('.ts-save').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
  await expect(page.locator('.qb-card')).toHaveCount(before + 1);
  await expect(page.locator('.qb-board')).toContainText(/DRIP EDGE/i);
});

test('the saved title has its tokens stripped', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Order drip edge !high tmrw');
  await page.locator('.ts-save').click();
  // atEnd is true on save, so even the trailing token resolves and is removed.
  const title = await page.evaluate(() =>
    App.controller.taskModel.all().find(t => /ORDER DRIP EDGE/i.test(t.title)).title);
  expect(title).not.toMatch(/!high|tmrw/i);
});

test('the toast echoes what got scheduled', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Call the GAF rep tmrw 9a ');
  await page.locator('.ts-save').click();
  const toast = page.locator('.toast').last();
  await expect(toast).toContainText(/Tomorrow/i);
  await expect(toast).toContainText(/9:00/);
});

test('Save + Another keeps routing, clears the title and refocuses', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-row[data-field="priority"]').click();
  await page.locator('.ts-tray .ts-seg [data-value]').last().click();
  await page.locator('.ts-tray .ts-tray-done').click();
  const priority = (await page.locator('.ts-row[data-field="priority"] .ts-val').innerText()).trim();

  await page.locator('.ts-title-in').fill('First of a batch');
  await page.locator('.ts-save-another').click();

  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('.ts-title-in')).toHaveValue('');
  await expect(page.locator('.ts-title-in')).toBeFocused();
  await expect(page.locator('.ts-row[data-field="priority"] .ts-val')).toHaveText(priority);
  await expect(page.locator('.ts-checklist li')).toHaveCount(0);
});

test('editing a card saves the change back to the task', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  const id = await page.locator('.qb-card').first().getAttribute('data-id');
  await page.locator('.qb-card').first().click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('EDIT TASK');

  await page.locator('.ts-row[data-field="priority"]').click();
  const want = await page.locator('.ts-tray .ts-seg [data-value]').first().getAttribute('data-value');
  await page.locator('.ts-tray .ts-seg [data-value]').first().click();
  await page.locator('.ts-tray .ts-tray-done').click();
  await page.locator('.ts-save').click();

  await expect(page.locator('.task-sheet')).toHaveCount(0);
  expect(await page.evaluate((i) => App.controller.getTask(i).priority, id)).toBe(want);
});

test('tapping a card does not also open the detail page behind the sheet', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  await page.locator('.qb-card').first().click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  expect(await page.evaluate(() => App.controller.uiState.selectedTaskId)).toBeFalsy();
});

test('the complete circle finishes a task without opening the sheet', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  const id = await page.locator('.qb-card').first().getAttribute('data-id');
  await page.locator('.qb-card').first().locator('.qb-check').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
  expect(await page.evaluate((i) => App.taxonomy.isDone(App.controller.getTask(i)), id)).toBe(true);
});

test('Open full task leaves the sheet for the detail page', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  const id = await page.locator('.qb-card').first().getAttribute('data-id');
  await page.locator('.qb-card').first().click();
  await page.locator('.ts-open-full').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => App.controller.uiState.selectedTaskId)).toBe(id);
});

test('a validation failure keeps the sheet open with its values intact', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Has a title');
  await page.evaluate(() => { App.controller._taskSheet.form.company = 'not-a-company'; });
  await page.locator('.ts-save').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('.ts-title-in')).toHaveValue('Has a title');
});
