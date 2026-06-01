// @ts-check
/* Preview-smoke suite: runs against the live Vercel preview URL after deploy.
   These tests touch NO database — they only verify deploy-time behavior:
     - env.json is served and shaped correctly
     - login page loads cleanly
     - the ?preview=1 auth-bypass is dead on a non-localhost hostname
     - production security headers are actually present on responses
   No TEST_* credentials are required, so this job runs even on PRs from
   first-time contributors. */
import { test, expect } from '@playwright/test';

test.describe('preview-smoke · deploy verification', () => {
  test('env.json is served with no-store and the right shape', async ({ page }) => {
    const res = await page.request.get('/env.json');
    expect(res.status()).toBe(200);
    expect((res.headers()['cache-control'] || '').toLowerCase()).toContain('no-store');
    const body = await res.json();
    expect(typeof body.supabaseUrl).toBe('string');
    expect(typeof body.supabaseAnonKey).toBe('string');
    expect(body.supabaseUrl).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i);
    // Hard refuse: a service_role key in env.json would mean someone set
    // SUPABASE_ANON_KEY to the wrong value in Vercel.
    expect(body.supabaseAnonKey).not.toMatch(/^sb_secret_|service_role/i);
  });

  test('login page returns 200 with security headers', async ({ page }) => {
    const res = await page.request.get('/');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['strict-transport-security']).toBeTruthy();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect((h['x-frame-options'] || '').toUpperCase()).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain('supabase.co');
    expect(h['referrer-policy']).toBeTruthy();
  });

  test('login page renders without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('/');
    await expect(page.locator('.brand-name').first()).toHaveText('Quest HQ');
    expect(errors).toEqual([]);
  });

  test('auth-bypass dead: ?preview=1 on prod hostname does not skip Supabase', async ({ page }) => {
    // On the deployed origin, hitting app.html?preview=1 should NOT activate
    // preview mode. With no session, auth-guard.js redirects to '/'.
    await page.goto('/app.html?preview=1');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // We accept either: redirect to login, or the "Auth service unavailable"
    // page. We refuse: the actual app shell rendering (which would mean
    // preview mode activated).
    const body = await page.locator('body').innerHTML();
    expect(body).not.toContain('listBody');     // task list shell == we got in
    expect(body).not.toContain('newTaskBtn');
  });
});
