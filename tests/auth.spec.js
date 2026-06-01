// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('auth · critical path', () => {
  test('login page renders without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await expect(page.locator('.brand-name').first()).toHaveText('Quest HQ');
    await expect(page.locator('#pwEmail')).toBeVisible();
    await expect(page.locator('#pwSignInBtn')).toBeVisible();
    // env.json failure shows up here, which is the most common cause of
    // a silent login-page break in prod.
    expect(errors).toEqual([]);
  });

  test('invalid credentials surface a clean error (no stack trace)', async ({ page }) => {
    await page.goto('/');
    await page.fill('#pwEmail', 'not-a-real-user@example.test');
    await page.fill('#pwPassword', 'definitely-wrong-password');
    await page.click('#pwSignInBtn');
    const err = page.locator('#authError');
    await expect(err).toBeVisible({ timeout: 8_000 });
    const text = await err.textContent();
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/at \w+ \(.+:\d+:\d+\)/);     // stack trace shape
    expect(text).not.toMatch(/Error: /);                    // raw thrown-error shape
  });

  test('validation: missing email blocks submit', async ({ page }) => {
    await page.goto('/');
    await page.fill('#pwEmail', '');
    await page.fill('#pwPassword', 'whatever');
    await page.click('#pwSignInBtn');
    // We expect the inline error and no navigation.
    await expect(page.locator('#authError')).toBeVisible();
    expect(page.url()).not.toContain('app.html');
  });

  test('successful sign-in redirects to /app.html', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);
    expect(page.url()).toMatch(/app\.html(\?|$)/);
  });
});
