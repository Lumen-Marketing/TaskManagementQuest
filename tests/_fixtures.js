// @ts-check
/* Shared Playwright fixtures.
   Test users must be created manually in the TEST Supabase project and
   approved (profiles.approved = true) with the correct role. The CI workflow
   reads creds from repo secrets; for local runs, set them in your shell. */
import { test as base, expect } from '@playwright/test';

const env = (name, fallback) => process.env[name] ?? fallback;

export const TEST_USERS = {
  admin:  { email: env('TEST_ADMIN_EMAIL',  ''), password: env('TEST_ADMIN_PASSWORD',  '') },
  worker: { email: env('TEST_WORKER_EMAIL', ''), password: env('TEST_WORKER_PASSWORD', '') },
};

export const test = base.extend({
  signIn: async ({ page }, use) => {
    /* Usage:
         await signIn(TEST_USERS.admin);
       Lands on app.html with a hydrated session. Throws if creds are unset
       so a CI run with missing secrets fails loudly rather than silently
       skipping the auth step. */
    await use(async ({ email, password }) => {
      if (!email || !password) {
        throw new Error('TEST_* credentials are not set in env. See tests/_fixtures.js.');
      }
      await page.goto('/');
      await page.fill('#pwEmail', email);
      await page.fill('#pwPassword', password);
      await Promise.all([
        page.waitForURL('**/app.html', { timeout: 15_000 }),
        page.click('#pwSignInBtn'),
      ]);
      // Wait for the app to bootstrap — TopbarView paints the avatar last.
      await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
    });
  },
});

export { expect };
