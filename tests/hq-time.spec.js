// @ts-check
/* HQ-time (Phoenix) date anchor — todayISO + hqWallClockToMs run in HQ zone. */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.utils && window.App.HQ_TIMEZONE);
});

test('hqWallClockToMs maps Phoenix wall-clock to the right UTC instant', async ({ page }) => {
  const got = await page.evaluate(() => window.App.utils.hqWallClockToMs(2026, 6, 19, 8, 0));
  // Phoenix is UTC-7 year-round (no DST) → 08:00 MST == 15:00 UTC.
  expect(got).toBe(Date.UTC(2026, 5, 19, 15, 0));
});

test('todayISO returns the HQ calendar date and shifts by whole days', async ({ page }) => {
  const res = await page.evaluate(() => {
    const fmt = (off) => window.App.utils.todayISO(off);
    // Recompute the expected HQ date independently to compare.
    const hqDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: window.App.HQ_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return { today: fmt(0), tomorrow: fmt(1), yesterday: fmt(-1), hqDate };
  });
  expect(res.today).toBe(res.hqDate);
  // Tomorrow/yesterday are one UTC day off the HQ date string.
  const dayAfter = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const s = new Date(Date.UTC(y, m - 1, d + n));
    return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`;
  };
  expect(res.tomorrow).toBe(dayAfter(res.today, 1));
  expect(res.yesterday).toBe(dayAfter(res.today, -1));
});
