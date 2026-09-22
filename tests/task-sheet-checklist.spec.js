// @ts-check
/* The checklist maps onto the app's subtasks, so a step added on a phone shows
   up on desktop and in the detail page instead of becoming a parallel list. */
import { test, expect, dismissOverlays } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await dismissOverlays(page);
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
});

test('the + button adds a step', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Measure the run');
  await page.locator('.ts-check-btn').click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(1);
  await expect(page.locator('.ts-checklist li').first()).toContainText('Measure the run');
  await expect(page.locator('.ts-check-in')).toHaveValue('');
});

test('Enter also adds a step', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Order the edge');
  await page.locator('.ts-check-in').press('Enter');
  await expect(page.locator('.ts-checklist li')).toHaveCount(1);
});

test('a blank step is refused', async ({ page }) => {
  await page.locator('.ts-check-in').fill('   ');
  await page.locator('.ts-check-btn').click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(0);
});

test('a step can be ticked and removed', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Step one');
  await page.locator('.ts-check-btn').click();

  await page.locator('.ts-checklist li .ts-check-box').first().click();
  expect(await page.evaluate(() => App.controller._taskSheet.form.checklist[0].d)).toBe(true);
  await expect(page.locator('.ts-checklist li').first()).toHaveClass(/is-done/);

  await page.locator('.ts-checklist li .ts-check-x').first().click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(0);
});

test('steps are saved as real subtasks', async ({ page }) => {
  await page.locator('.ts-title-in').fill('Drip edge job');
  await page.locator('.ts-check-in').fill('Measure the run');
  await page.locator('.ts-check-btn').click();
  await page.locator('.ts-save').click();

  const subs = await page.evaluate(() => {
    const t = App.controller.taskModel.all().find(x => /DRIP EDGE JOB/i.test(x.title));
    return t ? t.subtasks.map(s => s.t) : [];
  });
  expect(subs.join(' ')).toMatch(/MEASURE THE RUN/i);
});

test('text left in the add box is captured on save', async ({ page }) => {
  await page.locator('.ts-title-in').fill('Never pressed plus job');
  await page.locator('.ts-check-in').fill('Forgot to press plus');
  await page.locator('.ts-save').click();

  const subs = await page.evaluate(() => {
    const t = App.controller.taskModel.all().find(x => /NEVER PRESSED PLUS JOB/i.test(x.title));
    return t ? t.subtasks.map(s => s.t) : [];
  });
  expect(subs.join(' ')).toMatch(/FORGOT TO PRESS PLUS/i);
});

test('an existing task opens with its subtasks as checklist steps', async ({ page }) => {
  await page.locator('.ts-close').click();
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });

  const withSubs = await page.evaluate(() => {
    const t = App.controller.taskModel.all().find(x => (x.subtasks || []).length);
    return t ? { id: t.id, n: t.subtasks.length } : null;
  });
  test.skip(!withSubs, 'no seeded task has subtasks');

  await page.evaluate((id) => App.controller.openTaskSheet(id), withSubs.id);
  await expect(page.locator('.ts-checklist li')).toHaveCount(withSubs.n);
});
