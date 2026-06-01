// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('tasks · create + appears in list', () => {
  test('admin can create a task and see it in the list', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);

    // Unique title so parallel runs / leftover state don't clash.
    const title = `E2E task ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    await page.click('#newTaskBtn');
    await expect(page.locator('#newTaskModal')).toBeVisible();

    await page.fill('#nt-title', title);
    await page.fill('#nt-desc', 'Created by Playwright critical-path test.');
    await page.click('[data-action="submit"]');

    // Modal closes on successful submit.
    await expect(page.locator('#newTaskModal')).toBeHidden({ timeout: 10_000 });

    // The new task should appear in the visible list. Search keeps the
    // assertion fast even if there are many tasks already.
    await page.fill('#searchInput', title);
    await expect(page.locator('#listBody').getByText(title, { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  test('validation: empty title shows toast and does not create', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);
    await page.click('#newTaskBtn');
    await page.fill('#nt-title', '   ');   // whitespace only
    await page.click('[data-action="submit"]');

    // Modal stays open (submit was rejected). Toast surfaces the reason.
    await expect(page.locator('#newTaskModal')).toBeVisible();
    await expect(page.locator('.toast-title')).toContainText('Cannot create task');
  });

  test('validation: 600-char title is rejected by client validator', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);
    await page.click('#newTaskBtn');
    await page.fill('#nt-title', 'x'.repeat(600));
    await page.click('[data-action="submit"]');

    await expect(page.locator('#newTaskModal')).toBeVisible();
    await expect(page.locator('.toast-sub')).toContainText(/too long/i);
  });
});
