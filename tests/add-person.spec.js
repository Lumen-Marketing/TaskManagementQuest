// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('add person · create-user authorization', () => {
  test('worker invoking create-user gets a 401/403', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);
    const result = await page.evaluate(async () => {
      const { data, error } = await window.App.supabase.functions.invoke('create-user', {
        body: { fullName: 'Probe Person', email: 'probe-unauthorized@noone.test', role: 'worker', companyIds: [] },
      });
      return { ok: !error, status: error?.context?.status ?? data?.status ?? null };
    });
    expect(result.ok).toBe(false);
    expect([401, 403]).toContain(result.status);
  });
});
