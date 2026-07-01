// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

/* Project Folders critical path. Requires the TEST Supabase project with
   migration 055 applied and at least one seeded folder (migration 006 seeds
   several). Filing/creating a folder needs an admin (tasks.write) session. */
test.describe('project folders', () => {
  test('create a task filed into a new inline folder', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);

    const folder = `E2E Folder ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const title = `E2E proj task ${Date.now().toString(36)}`;

    await page.click('#newTaskBtn');
    await expect(page.locator('#newTaskWrap')).toBeVisible();
    await page.fill('#nt-title', title);

    // Open the project picker and create a brand-new folder inline.
    await page.click('#nt-project');
    await page.fill('.proj-picker-search', folder);
    await page.click('.proj-picker-create');

    // The trigger reflects the new folder, then the task is created filed into it.
    await expect(page.locator('#nt-project')).toContainText(folder, { timeout: 10_000 });
    await page.click('[data-action="submit"]');

    await expect(page.locator('#newTaskWrap')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('#taskDetailWrap .projtag')).toContainText(folder, { timeout: 10_000 });
  });

  test('Projects grid opens a scoped folder detail', async ({ page, signIn }) => {
    await signIn(TEST_USERS.admin);

    await page.click('.side-item[data-view="projects"]');
    await expect(page.locator('#projectsWrap .proj-grid')).toBeVisible({ timeout: 10_000 });

    const firstCard = page.locator('.proj-card').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    // The list is now scoped: the folder header appears.
    await expect(page.locator('.proj-detail-head')).toBeVisible({ timeout: 10_000 });

    // "Projects" back-control clears the scope.
    await page.click('[data-action="clear-project"]');
    await expect(page.locator('.proj-detail-head')).toBeHidden({ timeout: 10_000 });
  });
});
