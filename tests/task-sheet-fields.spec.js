// @ts-check
/* Field rows and picker trays. The important one is the taxonomy test: the app
   scopes statuses per company AND per type, so a fixed option list would offer
   statuses that do not exist for the selected type. */
import { test, expect, dismissOverlays } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };
const ROWS = ['company', 'assignee', 'priority', 'status', 'type', 'due', 'time'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await dismissOverlays(page);
  await page.locator('#bottomNav [data-nav="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
});

test('all seven core rows are present and reachable without scrolling', async ({ page }) => {
  for (const f of ROWS) await expect(page.locator(`.ts-row[data-field="${f}"]`)).toBeVisible();

  // The whole point of the redesign: the last row sits above the footer, so no
  // scroll is needed to reach it. The full page needed 3.1 screens.
  const fits = await page.evaluate(() => {
    const last = document.querySelector('.ts-row[data-field="time"]');
    const foot = document.querySelector('.ts-foot');
    return last.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top + 1;
  });
  expect(fits).toBe(true);
});

test('rows show real taxonomy labels, not raw keys', async ({ page }) => {
  // '*' is the all-companies sentinel; if it leaks into the form every taxonomy
  // lookup misses and the rows render keys like "todo" and "admin".
  const vals = await page.evaluate(() => ({
    company: document.querySelector('.ts-row[data-field="company"] .ts-val').textContent.trim(),
    status: document.querySelector('.ts-row[data-field="status"] .ts-val').textContent.trim(),
    type: document.querySelector('.ts-row[data-field="type"] .ts-val').textContent.trim(),
    form: App.controller._taskSheet.form,
  }));
  expect(vals.company).not.toBe('*');
  expect(vals.status).not.toBe(vals.form.status);   // a label, not the key
  expect(vals.type).not.toBe(vals.form.type);
});

test('tapping a row opens a tray and marks the row active', async ({ page }) => {
  await page.locator('.ts-row[data-field="type"]').click();
  await expect(page.locator('.ts-tray')).toBeVisible();
  await expect(page.locator('.ts-row[data-field="type"]')).toHaveClass(/is-open/);
});

test('picking an option updates the row and closes the tray', async ({ page }) => {
  await page.locator('.ts-row[data-field="type"]').click();
  const option = page.locator('.ts-tray [data-value]').nth(1);
  const label = (await option.innerText()).trim();
  await option.click();
  await expect(page.locator('.ts-tray')).toBeHidden();
  await expect(page.locator('.ts-row[data-field="type"] .ts-val')).toContainText(label);
});

test('the priority bar offers four segments, not five', async ({ page }) => {
  await page.locator('.ts-row[data-field="priority"]').click();
  // App.PRIORITIES has five keys, but 'urgent' is deliberately not offered on
  // the create path (NewTaskPageView._priList, "pro1 v1-FINAL"), and the
  // handoff's bar is four wide. Building the tray from Object.keys would
  // silently reverse that.
  await expect(page.locator('.ts-tray .ts-seg [data-value]')).toHaveCount(4);
  const labels = (await page.locator('.ts-tray .ts-seg [data-value]').allInnerTexts())
    .map(s => s.trim().toLowerCase());
  expect(labels.some(l => /urgent/.test(l))).toBe(false);
});

test('the priority tray stays open until DONE', async ({ page }) => {
  await page.locator('.ts-row[data-field="priority"]').click();
  await page.locator('.ts-tray .ts-seg [data-value]').first().click();
  await expect(page.locator('.ts-tray')).toBeVisible();          // stays open
  await page.locator('.ts-tray .ts-tray-done').click();
  await expect(page.locator('.ts-tray')).toBeHidden();
});

test('the due tray offers the quick picks plus a date input', async ({ page }) => {
  await page.locator('.ts-row[data-field="due"]').click();
  const labels = (await page.locator('.ts-tray [data-value]').allInnerTexts()).map(s => s.trim());
  expect(labels[0]).toBe('Today');
  expect(labels[1]).toBe('Tomorrow');
  expect(labels.some(l => /No date/i.test(l))).toBe(true);
  await expect(page.locator('.ts-tray input[type="date"]')).toBeVisible();
});

test('the due quick picks agree with the HQ calendar day', async ({ page }) => {
  await page.locator('.ts-row[data-field="due"]').click();
  const { firstValue, hqToday } = await page.evaluate(() => ({
    firstValue: document.querySelector('.ts-tray [data-value]').dataset.value,
    hqToday: App.utils.todayISO(0),
  }));
  // "Today" means the HQ (Phoenix) calendar day for every user, not the
  // device's. A device-local date would drift for anyone outside Arizona.
  expect(firstValue).toBe(hqToday);
});

test('the time tray leads with No time', async ({ page }) => {
  await page.locator('.ts-row[data-field="time"]').click();
  await expect(page.locator('.ts-tray [data-value]').first()).toContainText('No time');
  await expect(page.locator('.ts-tray input[type="time"]')).toBeVisible();
});

test('status options come from the taxonomy, scoped to the chosen type', async ({ page }) => {
  const statusOptions = async () => {
    await page.locator('.ts-row[data-field="status"]').click();
    const v = (await page.locator('.ts-tray [data-value]').allInnerTexts()).map(s => s.trim());
    await page.locator('.ts-tray .ts-tray-done').click();
    return v;
  };
  await statusOptions();

  // Switch type, then re-open status: the list must be re-derived, not cached.
  await page.locator('.ts-row[data-field="type"]').click();
  await page.locator('.ts-tray [data-value]').nth(1).click();
  const after = await statusOptions();

  const fromTaxonomy = await page.evaluate(() => {
    const f = App.controller._taskSheet.form;
    return App.taxonomy.activeStatuses(f.company, f.type).map(s => s.label);
  });
  expect(after).toEqual(fromTaxonomy);
});

test('changing company leaves no impossible status behind', async ({ page }) => {
  const ok = await page.evaluate(() => {
    const sheet = App.controller._taskSheet;
    const companies = Object.keys(App.COMPANIES).filter(id => id !== 'overall');
    for (const c of companies) {
      sheet._setField('company', c);
      const valid = App.taxonomy.activeStatuses(sheet.form.company, sheet.form.type).map(s => s.key);
      if (valid.length && valid.indexOf(sheet.form.status) === -1) return false;
    }
    return true;
  });
  expect(ok).toBe(true);
});

test('typing tokens fills the rows live', async ({ page }) => {
  // The trailing space matters: a token only resolves once a boundary follows
  // it, so "9a" mid-type must not fire while he may still be typing "9am".
  await page.locator('.ts-title-in').fill('Order drip edge !high tmrw 9a ');
  await expect(page.locator('.ts-row[data-field="priority"] .ts-val')).toContainText(/high/i);
  await expect(page.locator('.ts-row[data-field="due"] .ts-val')).toContainText(/Tomorrow/i);
  await expect(page.locator('.ts-row[data-field="time"] .ts-val')).toContainText(/9:00/);
});

test('the collapsed group hides reminder, label and project until asked', async ({ page }) => {
  await expect(page.locator('.ts-row[data-field="reminder"]')).toBeHidden();
  await page.locator('.ts-more-toggle').click();
  for (const f of ['reminder', 'label', 'project']) {
    await expect(page.locator(`.ts-row[data-field="${f}"]`)).toBeVisible();
  }
});

test('opening a tray does not close the sheet', async ({ page }) => {
  // App.Menu keeps ONE menu open at a time and closes the previous one, so a
  // tray built with App.Menu would dismiss the sheet it lives in.
  await page.locator('.ts-row[data-field="due"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('.ts-tray')).toBeVisible();
});

test('every tray option meets the 44px tap minimum', async ({ page }) => {
  await page.locator('.ts-row[data-field="type"]').click();
  const boxes = await page.locator('.ts-tray [data-value]').all();
  for (const b of boxes) {
    const box = await b.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
