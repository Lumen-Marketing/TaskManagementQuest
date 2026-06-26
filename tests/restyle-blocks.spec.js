// @ts-check
import { test, expect } from './_fixtures.js';

// The restyle is CSS-only; preview mode boots the app with seed data and no backend.
async function boot(page, baseURL) {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
}

test.describe('flat-outline block restyle', () => {
  test('block tokens are defined and resting shadows are flattened', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return {
        line: cs.getPropertyValue('--block-line').trim().toLowerCase(),
        radius: cs.getPropertyValue('--block-radius').trim(),
        shadowSm: cs.getPropertyValue('--shadow-sm').trim().toLowerCase(),
        shadowMd: cs.getPropertyValue('--shadow-md').trim().toLowerCase(),
      };
    });
    expect(tokens.line).toBe('#16191d');
    expect(tokens.radius).toBe('8px');
    expect(tokens.shadowSm).toBe('none');
    expect(tokens.shadowMd).toBe('none');
  });

  test('Home cards are flat outline blocks (no shadow, 8px radius, near-black outline)', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('home'));
    const card = page.locator('#homeWrap .qhq-card').first();
    await expect(card).toBeVisible();
    const styles = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });

  test('Task list groups are flat outline blocks', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('all'));
    const group = page.locator('#taskViewWrap .task-group').first();
    await expect(group).toBeVisible();
    const styles = await group.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });

  test('Board columns are flat outline blocks', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => { window.App.controller.setView('all'); window.App.controller.setLayout('kanban'); });
    const col = page.locator('#taskViewWrap .kanban-col').first();
    await expect(col).toBeVisible();
    const styles = await col.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
  });

  test('Detail page cards are flat outline blocks on the shared tokens', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => { window.App.controller.setView('all'); window.App.controller.selectTask('t1'); });
    const card = page.locator('.detail-card').first();
    await expect(card).toBeVisible();
    const styles = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });
});
