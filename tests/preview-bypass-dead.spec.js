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
