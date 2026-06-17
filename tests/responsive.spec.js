// @ts-check
/* Mobile responsiveness sweep — implements the `mobile-responsive-testing`
   skill against the authed app (app.html + taskmanagement.css).

   Hard assertions (the bugs fixed in the responsive pass):
     1. No horizontal scrolling at any breakpoint.
     2. The New-task modal footer (Cancel/Create) stays inside the viewport —
        i.e. the `vh`→`dvh` modal sizing fix actually keeps the buttons reachable.

   Soft checks (reported as annotations, not failures):
     - Touch targets smaller than 44×44px.

   Requires TEST_* creds (see tests/_fixtures.js). Run:
     npm run test:local -- responsive.spec.js
*/
import { test, expect, TEST_USERS } from './_fixtures.js';

const BREAKPOINTS = [
  { name: 'mobile_se',       width: 320, height: 568 },
  { name: 'mobile_portrait', width: 375, height: 667 },
  { name: 'mobile_large',    width: 414, height: 896 },
  { name: 'tablet_portrait', width: 768, height: 1024 },
  { name: 'desktop',         width: 1280, height: 720 },
];

test.describe('responsive · mobile sweep', () => {
  for (const bp of BREAKPOINTS) {
    test(`${bp.name} (${bp.width}×${bp.height})`, async ({ page, signIn }, testInfo) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await signIn(TEST_USERS.admin);

      // --- 1. No horizontal scroll on the main app shell ---
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      await testInfo.attach(`${bp.name}-shell.png`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });
      expect(
        overflow.scrollWidth,
        `Horizontal scroll at ${bp.width}px (page ${overflow.scrollWidth} > viewport ${overflow.innerWidth})`,
      ).toBeLessThanOrEqual(overflow.innerWidth + 1);

      // --- 2. New-task modal footer stays on screen (the dvh fix) ---
      await page.click('#newTaskBtn');
      await expect(page.locator('#newTaskModal')).toBeVisible();
      const foot = page.locator('#newTaskModal .modal-foot');
      const box = await foot.boundingBox();
      await testInfo.attach(`${bp.name}-newtask-modal.png`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });
      expect(box, 'modal footer should be laid out').not.toBeNull();
      if (box) {
        expect(
          box.y + box.height,
          `New-task footer bottom (${Math.round(box.y + box.height)}px) is below the ${bp.height}px viewport — Save/Cancel unreachable`,
        ).toBeLessThanOrEqual(bp.height + 1);
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('#newTaskModal')).toBeHidden();

      // --- 3. Soft check: touch targets < 44px (reported, not failed) ---
      if (bp.width < 768) {
        const small = await page.evaluate(() => {
          const els = document.querySelectorAll('button, a, [role="button"], input, select');
          const out = [];
          els.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return; // hidden
            if (r.width < 44 || r.height < 44) {
              out.push(`${el.tagName.toLowerCase()}"${(el.textContent || '').trim().slice(0, 18)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
            }
          });
          return out;
        });
        if (small.length) {
          testInfo.annotations.push({
            type: 'touch-target-warning',
            description: `${small.length} target(s) < 44px: ${small.slice(0, 12).join(', ')}`,
          });
        }
      }
    });
  }
});
