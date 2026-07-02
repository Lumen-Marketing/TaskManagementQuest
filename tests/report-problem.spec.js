// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('report a problem · account menu modal', () => {
  test('worker opens the modal, sees counter, escape closes it', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // The account chip opens the user menu; the menu is appended to <body>.
    await page.locator('#userChip, #userAvatar').first().click();
    await page.locator('.user-menu-item[data-action="report-problem"]').click();

    await expect(page.locator('#reportModal')).toBeVisible();
    await page.fill('#rp-desc', 'Test report from e2e');
    await expect(page.locator('#rp-count')).toHaveText('20 / 2000');
    await expect(page.locator('#reportModal [data-action="submit"]')).toBeEnabled();

    // No submit — this spec must not depend on the edge function.
    await page.keyboard.press('Escape');
    await expect(page.locator('#reportModal')).toHaveCount(0);
  });

  test('empty description shows inline error, modal stays open', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    await page.locator('#userChip, #userAvatar').first().click();
    await page.locator('.user-menu-item[data-action="report-problem"]').click();
    await page.locator('#reportModal [data-action="submit"]').click();

    await expect(page.locator('#reportModal .profile-inline-error'))
      .toHaveText('Please describe the problem.');
    await expect(page.locator('#reportModal')).toBeVisible();
  });
});
