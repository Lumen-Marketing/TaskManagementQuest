// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('rbac · low-privilege role cannot reach admin surfaces', () => {
  test('worker signed in sees no New task button (UI gate)', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);
    // The button is hidden by applyRoleChrome when App.can('tasks.write') is false.
    await expect(page.locator('#newTaskBtn')).toBeHidden();
  });

  test('worker hitting the approvals view sees the No access empty state', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // ApprovalView renders into #timeViewWrap when view=approvals.
    // Drive the controller directly so we don't depend on a sidebar entry
    // that's hidden for workers.
    await page.evaluate(() => {
      window.App.EventBus.emit('view:changed', 'approvals');
    });
    const wrap = page.locator('#timeViewWrap');
    await expect(wrap).toContainText(/No access/i, { timeout: 5_000 });
  });

  test('worker invoking notify-email gets a 403-style response', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // The edge function checks profile.approved + role server-side.
    const result = await page.evaluate(async () => {
      const { data, error } = await window.App.supabase.functions.invoke('notify-email', {
        body: { to: ['noone@noone.test'], subject: 'unauthorized probe', html: '<p>x</p>' },
      });
      // Supabase wraps non-2xx as `error` with a `.context.status`.
      return {
        ok: !error,
        status: error?.context?.status ?? data?.status ?? null,
        message: error?.message || data?.error || null,
      };
    });
    expect(result.ok).toBe(false);
    expect([401, 403]).toContain(result.status);
  });

  test('worker invoking report-problem is NOT role-blocked', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // Deliberate mirror of the notify-email 403 test above: report-problem is
    // open to EVERY approved role (it can only ever email developers), so a
    // worker must never see a role gate. 429 (rate limit) is acceptable.
    const result = await page.evaluate(async () => {
      const { data, error } = await window.App.supabase.functions.invoke('report-problem', {
        body: { type: 'bug', description: 'e2e role-gate probe', context: { view: 'e2e' } },
      });
      return {
        ok: !error,
        status: error?.context?.status ?? null,
        data: data || null,
      };
    });
    expect([401, 403]).not.toContain(result.status);
    if (result.ok) expect(result.data?.ok).toBe(true);
  });

  test('anonymous caller to report-problem gets a 401', async ({ page }) => {
    // Same env gate as the signed-in probes: without the test project the
    // function isn't deployed and this would 404 instead of exercising auth.
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    // Gateway verify-JWT is off, so the function itself must reject a missing
    // bearer token. Hit it raw from the (signed-out) login page.
    await page.goto('/');
    const status = await page.evaluate(async () => {
      await window.App.configReady;
      const res = await fetch(`${window.App.supabaseUrl}/functions/v1/report-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: window.App.supabaseAnonKey },
        body: JSON.stringify({ description: 'anon probe' }),
      });
      return res.status;
    });
    expect(status).toBe(401);
  });
});
