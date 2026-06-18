// @ts-check
/* End-to-end Focus flow through the DB-free preview build: pick, reorder, remove. */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.controller);
});

test('add tasks to Focus, reorder by drag, removal updates ranks', async ({ page }) => {
  // Seed three of abraham's tasks into Focus, then fold the list into the
  // main table via the Execution-order sort (no separate Focus view).
  await page.evaluate(() => window.App.controller.addToFocus(['t6', 't7', 't3']));
  await page.evaluate(() => { window.App.controller.setLayout('table'); window.App.controller.setSortBy('focus'); });

  const rows = page.locator('.focus-row');
  await expect(rows).toHaveCount(3);
  const idsBefore = await rows.evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsBefore).toEqual(['t6', 't7', 't3']);

  // Drag row #1 (t6) to the bottom.
  const grip = page.locator('.focus-row[data-id="t6"] .focus-drag');
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + 220, { steps: 10 });
  await page.mouse.up();

  const idsAfter = await page.locator('.focus-row').evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsAfter[idsAfter.length - 1]).toBe('t6');

  // Remove the now-first task; count drops to 2 and ranks renumber from 1.
  await page.locator('.focus-row').first().locator('.focus-remove').click();
  await expect(page.locator('.focus-row')).toHaveCount(2);
  const firstRank = await page.locator('.focus-row .focus-rank').first().textContent();
  expect((firstRank || '').trim()).toBe('1');
});
