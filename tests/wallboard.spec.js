// @ts-check
import { test, expect } from './_fixtures.js';

async function boot(page, baseURL) {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
}

test.describe('wallboard · navigation + takeover', () => {
  test('sidebar item enters a full-screen takeover; Esc returns to prior view', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    // Start on All tasks, then enter the wallboard via the sidebar.
    await page.evaluate(() => window.App.controller.setView('all'));
    await page.click('.side-item[data-view="wallboard"]');
    await expect(page.locator('#wallboardWrap')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/wallboard-active/);

    // Esc exits back to the previous view (all) and restores chrome.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/wallboard-active/);
    const view = await page.evaluate(() => window.App.controller.uiState.view);
    expect(view).toBe('all');
  });

  test('timers are cleared after leaving the wallboard', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));
    await page.evaluate(() => window.App.controller.setView('home'));
    const live = await page.evaluate(() => window.App.wallboardView && window.App.wallboardView._timersActive());
    expect(live).toBe(false);
  });
});

test.describe('wallboard · content', () => {
  test('renders one card per active person with counts and blocked highlighting', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));

    // A card per active person (seed has several).
    const cards = page.locator('#wallboardWrap .wb-card');
    expect(await cards.count()).toBeGreaterThan(1);

    // Header stats exist (ACTIVE / DONE / BLOCKED).
    await expect(page.locator('#wallboardWrap .wb-stat')).toHaveCount(3);

    // The seed has a held (blocked) task (t11 'Supabase auth wiring', assignee abraham).
    const blocked = page.locator('#wallboardWrap .wb-task--blocked');
    expect(await blocked.count()).toBeGreaterThan(0);

    // Exit button returns to prior view.
    await page.click('#wallboardWrap .wb-exit');
    await expect(page.locator('body')).not.toHaveClass(/wallboard-active/);
  });

  test('caps each person at 4 tasks with a +N more line', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => {
      // Pile 6 open tasks onto one person so the cap triggers deterministically.
      const tm = window.App.controller.taskModel;
      for (let i = 0; i < 6; i++) {
        tm.tasks.push({ id: 'wb-extra-' + i, title: 'Extra ' + i, type: 'admin', company: 'roofing',
          creator: 'abraham', assignee: 'abraham', watchers: [], due: window.App.utils.todayISO(2),
          priority: 'medium', status: 'todo', subtasks: [], activity: [] });
      }
      window.App.EventBus.emit('tasks:changed');
      window.App.controller.setView('wallboard');
    });
    const more = page.locator('#wallboardWrap .wb-card .wb-more').first();
    await expect(more).toBeVisible();
    await expect(more).toContainText('more');
  });
});

test.describe('wallboard · live + chrome', () => {
  test('hides app chrome and updates live on tasks:changed', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));

    // Chrome hidden while active.
    await expect(page.locator('.deck')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();

    const before = await page.locator('#wallboardWrap .wb-task').count();
    await page.evaluate(() => {
      const tm = window.App.controller.taskModel;
      tm.tasks.push({ id: 'wb-live-1', title: 'Live added task', type: 'admin', company: 'roofing',
        creator: 'abraham', assignee: 'andres', watchers: [], due: window.App.utils.todayISO(1),
        priority: 'high', status: 'todo', subtasks: [], activity: [] });
      window.App.EventBus.emit('tasks:changed');
    });
    await expect(page.locator('#wallboardWrap .wb-task')).toHaveCount(before + 1);
  });
});
