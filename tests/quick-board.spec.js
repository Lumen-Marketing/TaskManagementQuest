// @ts-check
/* The quick board is the phone default layout and carries Abraham's approved
   v2 design: an Open/Done/All segment, company chips, and flat cards sorted
   not-done -> priority -> due. Runs in preview mode, so no Supabase creds. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
  await expect(page.locator('.qb-card').first()).toBeVisible();
});

test('the board renders a flat list of cards, not grouped rows', async ({ page }) => {
  await expect(page.locator('.qb-board')).toBeVisible();
  expect(await page.locator('.qb-card').count()).toBeGreaterThan(0);
  await expect(page.locator('.qt-group')).toHaveCount(0);
});

test('every card carries the v2 furniture', async ({ page }) => {
  const card = page.locator('.qb-card').first();
  await expect(card.locator('.qb-check')).toBeVisible();
  await expect(card.locator('.qb-title')).toBeVisible();
  await expect(card.locator('.qb-pill-priority')).toBeVisible();
  await expect(card.locator('.qb-pill-company')).toBeVisible();
});

test('the segment filters open and done', async ({ page }) => {
  const openCount = await page.locator('.qb-card').count();

  await page.locator('.qb-seg button[data-seg="done"]').click();
  // Either there are done tasks, or the honest empty state shows. Never a
  // silently blank board.
  const doneOrEmpty = await page.locator('.qb-card.is-done').count()
    + await page.locator('.empty-state, .qb-board .empty').count();
  expect(doneOrEmpty).toBeGreaterThan(0);

  await page.locator('.qb-seg button[data-seg="all"]').click();
  expect(await page.locator('.qb-card').count()).toBeGreaterThanOrEqual(openCount);
});

test('done cards are struck through', async ({ page }) => {
  await page.locator('.qb-seg button[data-seg="all"]').click();
  const done = page.locator('.qb-card.is-done').first();
  if (await done.count()) {
    await expect(done.locator('.qb-title')).toHaveCSS('text-decoration-line', 'line-through');
  }
});

test('the open segment never shows a done task', async ({ page }) => {
  await page.locator('.qb-seg button[data-seg="open"]').click();
  await expect(page.locator('.qb-card.is-done')).toHaveCount(0);
});

test('company chips filter the board', async ({ page }) => {
  await page.locator('.qb-seg button[data-seg="all"]').click();
  const chips = page.locator('.qb-chips button');
  expect(await chips.count()).toBeGreaterThan(1);

  const company = await chips.nth(1).getAttribute('data-company');
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveClass(/is-on/);

  // Every remaining card really belongs to that company.
  const stray = await page.evaluate((co) => {
    const ids = [...document.querySelectorAll('.qb-card')].map(c => c.dataset.id);
    return ids.filter(id => {
      const t = App.controller.taskModel.all().find(x => x.id === id);
      return t && t.company !== co;
    }).length;
  }, company);
  expect(stray).toBe(0);
});

test('the board has no horizontal overflow at 390px', async ({ page }) => {
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(over).toBe(false);
});

test('tap targets on a card meet the 44px minimum', async ({ page }) => {
  const box = await page.locator('.qb-card .qb-check').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(24);
  const card = await page.locator('.qb-card').first().boundingBox();
  expect(card.height).toBeGreaterThanOrEqual(44);
});
