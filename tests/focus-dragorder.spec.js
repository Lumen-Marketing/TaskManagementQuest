// @ts-check
/* The shared pointer-based drag-to-reorder helper (App.makeReorderable). */
import { test, expect } from '@playwright/test';

test('makeReorderable reports the new index after a pointer drag', async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.makeReorderable);

  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'dragTest';
    box.style.cssText = 'position:fixed;top:0;left:0;width:200px;z-index:99999;background:#fff';
    ['a', 'b', 'c'].forEach((id) => {
      const r = document.createElement('div');
      r.dataset.id = id;
      r.textContent = id;
      r.style.cssText = 'height:40px;line-height:40px;';
      box.appendChild(r);
    });
    document.body.appendChild(box);
    window.__dropResult = null;
    window.App.makeReorderable(box, { onDrop: (movedId, newIndex) => { window.__dropResult = { movedId, newIndex }; } });
  });

  // Drag row "a" (top) down past "b" and "c".
  const a = page.locator('#dragTest [data-id="a"]');
  const ab = await a.boundingBox();
  await page.mouse.move(ab.x + 10, ab.y + 20);
  await page.mouse.down();
  await page.mouse.move(ab.x + 10, ab.y + 130, { steps: 8 });
  await page.mouse.up();

  const result = await page.evaluate(() => window.__dropResult);
  expect(result.movedId).toBe('a');
  expect(result.newIndex).toBe(2);
});
