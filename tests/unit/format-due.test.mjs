// tests/unit/format-due.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// utils.js is a plain object literal over `window`; give it the globals it
// touches at load time (`document` is only reached inside function bodies).
global.window = global.window || {};
global.App = global.window.App = { HQ_TIMEZONE: 'America/Phoenix' };
require('../../js/utils.js');

// Pin "today" so the assertions do not drift with the calendar.
const FIXED_TODAY = '2026-09-23';
App.utils.todayISO = (offset = 0) => {
  const p = FIXED_TODAY.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + offset));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Every zone must name the same calendar day. Phoenix (UTC-7) is the HQ zone and
// the one the old implementation got wrong; Manila (UTC+8) is where the work is
// reviewed from. Both must agree with the ISO string.
for (const tz of ['America/Phoenix', 'Asia/Manila', 'UTC']) {
  test(`formatDue names the same day in ${tz}`, () => {
    process.env.TZ = tz;
    assert.equal(App.utils.formatDue('2026-09-25').text, 'Sep 25');
    assert.equal(App.utils.formatDue('2026-10-01').text, 'Oct 1');
    assert.equal(App.utils.formatDue('2026-09-18').text, 'Sep 18');
  });
}

test('today and tomorrow are named, not dated', () => {
  process.env.TZ = 'America/Phoenix';
  assert.deepEqual(App.utils.formatDue('2026-09-23'), { text: 'Today', cls: 'due-today' });
  assert.equal(App.utils.formatDue('2026-09-24').text, 'Tomorrow');
});

test('past dates are flagged overdue', () => {
  process.env.TZ = 'America/Phoenix';
  assert.equal(App.utils.formatDue('2026-09-18').cls, 'due-overdue');
  assert.equal(App.utils.formatDue('2026-09-25').cls, '');
});
