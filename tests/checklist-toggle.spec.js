// @ts-check
import { test, expect } from './_fixtures.js';

// Preview mode boots the app with seed data and no backend.
async function boot(page, baseURL) {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  // Dismiss the onboarding tour overlay (Esc counts as seen) so its .tour-catch
  // layer can't intercept clicks on the checklist.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test.describe('task detail checklist', () => {
  // Regression: the checklist card in the detail view rendered steps read-only,
  // so a click did nothing — the only way to check a step off was full Edit mode.
  test('clicking a checklist step toggles its done-state, progress, and persists', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    // t1 seeds two subtasks: "Pull deed info" (done) + "Notarize" (not done) → 1/2.
    await page.evaluate(() => window.App.controller.selectTask('t1'));

    const card = page.locator('#taskDetailWrap .td2-card').filter({ hasText: 'Checklist' });
    const steps = card.locator('.td2-step');
    await expect(steps).toHaveCount(2);
    await expect(card.locator('.td2-count')).toHaveText('1/2');
    await expect(steps.nth(1)).not.toHaveClass(/done/);

    // Click the not-done step ("Notarize", idx 1) → done, count 2/2.
    await steps.nth(1).click();
    await expect(card.locator('.td2-count')).toHaveText('2/2');
    await expect(card.locator('.td2-step').nth(1)).toHaveClass(/done/);

    // Change is persisted on the model, not just the DOM.
    const done = await page.evaluate(() => window.App.controller.taskModel.find('t1').subtasks[1].d);
    expect(done).toBe(true);
  });
});
