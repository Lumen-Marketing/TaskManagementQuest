// @ts-check
/* End-to-end Focus flow through the DB-free preview build: pick, reorder, remove.
   Focus is a shared cross-person list; the execution view shows ranked tasks
   (.focus-row, not .exec-unordered) on top and an unordered tail below. */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.controller);
});

test('add tasks to Focus, reorder by drag, removal updates ranks', async ({ page }) => {
  // Add three tasks to the shared Focus order, then switch to Execution-order.
  await page.evaluate(() => window.App.controller.addToFocus(['t6', 't7', 't3']));
  await page.evaluate(() => { window.App.controller.setLayout('table'); window.App.controller.setSortBy('focus'); });

  // Ordered (ranked) rows only — the tail rows carry .exec-unordered.
  const ordered = page.locator('.focus-row:not(.exec-unordered)');
  await expect(ordered).toHaveCount(3);
  const idsBefore = await ordered.evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsBefore).toEqual(['t6', 't7', 't3']);

  // Drag ranked #1 (t6) down past its ranked siblings (small move so it stays
  // above the divider).
  const grip = page.locator('.focus-row[data-id="t6"] .focus-drag');
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + 150, { steps: 10 });
  await page.mouse.up();

  const idsAfter = await page.locator('.focus-row:not(.exec-unordered)').evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsAfter[idsAfter.length - 1]).toBe('t6');

  // Remove the now-first ranked task; ranked count drops to 2, ranks renumber.
  await page.locator('.focus-row:not(.exec-unordered)').first().locator('.focus-remove').click();
  await expect(page.locator('.focus-row:not(.exec-unordered)')).toHaveCount(2);
  const firstRank = await page.locator('.focus-row:not(.exec-unordered) .focus-rank').first().textContent();
  expect((firstRank || '').trim()).toBe('1');
});
