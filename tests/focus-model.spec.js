// @ts-check
/* Focus list model logic, driven through the DB-free preview build. */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.taskModel);
});

test('addToFocus appends with increasing focusSeq, focusList returns ordered active tasks', async ({ page }) => {
  const result = await page.evaluate(() => {
    const m = window.App.taskModel;
    // kristine's seed tasks: t2 (pending), t13 (done), t15 (todo)
    m.addToFocus('t15');
    m.addToFocus('t2');
    return {
      first: m.find('t15').focusSeq,
      second: m.find('t2').focusSeq,
      list: m.focusList('kristine').map(t => t.id),
    };
  });
  expect(result.second).toBeGreaterThan(result.first);
  // done task (t13) never appears; order is t15 then t2
  expect(result.list).toEqual(['t15', 't2']);
});

test('removeFromFocus drops the task; setFocusOrder reorders', async ({ page }) => {
  const result = await page.evaluate(() => {
    const m = window.App.taskModel;
    m.addToFocus('t15');
    m.addToFocus('t2');
    m.removeFromFocus('t15');
    const afterRemove = m.focusList('kristine').map(t => t.id);
    const t2seq = m.find('t2').focusSeq;
    m.setFocusOrder('t15', t2seq - 1); // slot t15 above t2
    const afterReorder = m.focusList('kristine').map(t => t.id);
    return { afterRemove, afterReorder };
  });
  expect(result.afterRemove).toEqual(['t2']);
  expect(result.afterReorder).toEqual(['t15', 't2']);
});
