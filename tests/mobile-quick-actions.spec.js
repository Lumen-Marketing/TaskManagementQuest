// @ts-check
/* Phase 1 (mobile triage): each task card on a phone exposes a quick-actions
   bottom sheet so the two actions that aren't already on the card — Reassign and
   Set due — are reachable without opening the full detail overlay. Status, Mark
   done and Clock are also surfaced in the sheet for a single thumb-friendly menu.

   Runs in preview mode (?preview=1) so it needs no Supabase creds — the local
   dev server is localhost, where the preview bypass is allowed. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 375, height: 800 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => App.controller.setView('all'));
  await expect(page.locator('.list-row').first()).toBeVisible();
});

test('mobile card exposes a quick-actions trigger that opens a bottom sheet', async ({ page }) => {
  const row = page.locator('.list-row').first();
  const trigger = row.locator('[data-action="open-quick"]');
  await expect(trigger).toBeVisible();

  await trigger.click();

  const sheet = page.locator('.quick-sheet');
  await expect(sheet).toBeVisible();
  // The two net-new actions must be present (the rest already live on the card).
  await expect(sheet.getByRole('button', { name: /reassign/i })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /due/i })).toBeVisible();
});

test('reassign from the sheet changes the task assignee', async ({ page }) => {
  const row = page.locator('.list-row').first();
  const taskId = await row.getAttribute('data-id');
  const before = await page.evaluate((id) => App.taskModel.find(id).assignee, taskId);

  await row.locator('[data-action="open-quick"]').click();
  await page.locator('.quick-sheet').getByRole('button', { name: /reassign/i }).click();

  // A people picker appears; choose the first option that isn't the current assignee.
  const option = page.locator('.quick-sheet [data-assignee]').filter({ hasNot: page.locator(`[data-assignee="${before}"]`) }).first();
  const chosen = await option.getAttribute('data-assignee');
  await option.click();

  const after = await page.evaluate((id) => App.taskModel.find(id).assignee, taskId);
  expect(after).toBe(chosen);
  expect(after).not.toBe(before);
});

test('set-due from the sheet changes the task due date', async ({ page }) => {
  const row = page.locator('.list-row').first();
  const taskId = await row.getAttribute('data-id');

  await row.locator('[data-action="open-quick"]').click();
  await page.locator('.quick-sheet').getByRole('button', { name: /due/i }).click();

  const dateInput = page.locator('.quick-sheet input[type="date"]');
  await expect(dateInput).toBeVisible();
  await dateInput.fill('2026-12-31');
  await page.locator('.quick-sheet [data-action="due-save"]').click();

  const due = await page.evaluate((id) => App.taskModel.find(id).due, taskId);
  expect(due).toBe('2026-12-31');
});

test('sheet action rows meet the 44px touch-target minimum', async ({ page }) => {
  await page.locator('.list-row').first().locator('[data-action="open-quick"]').click();
  await expect(page.locator('.quick-sheet')).toBeVisible();

  const small = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.quick-sheet button')];
    return rows
      .map((b) => ({ label: (b.textContent || '').trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height) }))
      .filter((x) => x.h < 44);
  });
  expect(small, `sheet buttons under 44px: ${JSON.stringify(small)}`).toEqual([]);
});

test('the quick-actions trigger is hidden on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const trigger = page.locator('.list-row').first().locator('[data-action="open-quick"]');
  await expect(trigger).toBeHidden();
});
