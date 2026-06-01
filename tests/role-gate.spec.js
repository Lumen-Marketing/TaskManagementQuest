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
});
