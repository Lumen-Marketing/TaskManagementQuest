// @ts-check
/* Regression test for the Phase 3 fix: ?preview=1 is gated to localhost only,
   but the local dev server we run in CI IS localhost — so this test only
   asserts that on a non-localhost hostname the bypass is dead. The same
   assertion runs in preview-smoke.spec.js against the Vercel preview URL,
   which is the actual prod-shape check. Here we just verify the regex matches
   the expected hostnames so a future refactor can't quietly disable it. */
import { test, expect } from './_fixtures.js';

test('auth-guard preview check rejects non-local hostnames', async ({ page }) => {
  // Load the script source directly and assert the localhost gate exists.
  // If someone removes it, this test fails before the regression ships.
  const res = await page.request.get('/js/auth-guard.js');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/isLocal/);
  expect(body).toMatch(/localhost/);
  expect(body).toMatch(/127\.0\.0\.1/);
  expect(body).toMatch(/preview.*1.*isLocal|isLocal.*preview.*1/s);
});

test('local dev server allows preview mode (sanity check the gate works on localhost)', async ({ page }) => {
  // On localhost, preview mode should activate and bypass the Supabase auth.
  // We assert it landed on app.html without redirecting away.
  await page.goto('/app.html?preview=1');
  await page.waitForLoadState('domcontentloaded');
  // If preview mode was rejected we'd be on the login page.
  expect(page.url()).toMatch(/app\.html/);
});

test('local preview exposes the command-center UI shell without backend access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('body')).toHaveClass(/ui-command-center/);
  await expect(page.locator('.deck')).toBeVisible();
  await expect(page.locator('#newTaskBtn')).toBeVisible();

  // The morning brief lives on the Home view (the landing view is now the
  // task list after the Home/Reports redesign), so switch to Home to assert it.
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('.qhq-brief')).toBeVisible();
  await expect(page.locator('.qhq-brief')).toContainText(/morning brief|ops brief/i);

  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.body);
    return {
      primary: styles.getPropertyValue('--amber').trim().toLowerCase(),
      primaryBg: styles.getPropertyValue('--amber-bg').trim().toLowerCase(),
      primaryInk: styles.getPropertyValue('--amber-ink').trim().toLowerCase(),
    };
  });
  expect(palette).toEqual({
    primary: '#ed4e0d',
    primaryBg: '#fdeee6',
    primaryInk: '#c2410c',
  });

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
});
