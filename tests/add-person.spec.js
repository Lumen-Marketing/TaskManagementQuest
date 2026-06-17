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

test.describe('add person · UI flow (preview)', () => {
  test('admin can open the form, submit, and see a success toast', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
    await page.waitForFunction(() => !!window.App && !!window.App.controller);
    // Stub createUser so no backend is needed; simulate a new profile being added.
    await page.evaluate(() => {
      window.App.dataStore.createUser = async ({ fullName, email }) => {
        const id = 'preview-new-' + Math.random().toString(16).slice(2, 8);
        window.App.PROFILES = (window.App.PROFILES || []).concat([
          { id, email, full_name: fullName, approved: true, role: 'worker', member_id: id, company_ids: [] },
        ]);
        return { ok: true, profileId: id, memberId: id, emailSent: true };
      };
      window.App.EventBus.emit('view:changed', 'approvals');
    });
    await page.click('[data-action="add-person"]');
    await page.fill('#ap-name', 'Taylor Tester');
    await page.fill('#ap-email', 'taylor.tester@example.com');
    await page.click('#addPersonModal [data-action="submit"]');
    await expect(page.locator('#toastContainer')).toContainText(/Person added/i, { timeout: 5_000 });
    await expect(page.locator('#timeViewWrap')).toContainText('Taylor Tester', { timeout: 5_000 });
  });
});
