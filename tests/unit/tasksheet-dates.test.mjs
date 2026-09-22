// tests/unit/tasksheet-dates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/tasksheet/dates.js');

const D = () => App.TaskSheet.dates;

// 2026-09-23 is a Wednesday.
const WED = '2026-09-23';

test('nextDow is strictly the next weekday, never today', () => {
  assert.equal(D().nextDow(WED, 5), '2026-09-25');        // Fri that week
  assert.equal(D().nextDow(WED, 1), '2026-09-28');        // following Mon
  // Asking for Wednesday on a Wednesday must jump a full week, not return today.
  assert.equal(D().nextDow(WED, 3), '2026-09-30');
});

test('nextDow crosses a month boundary without drifting', () => {
  assert.equal(D().nextDow('2026-09-29', 5), '2026-10-02');
});

test('quickPicks offers today, tomorrow, next Fri, next Mon and No date', () => {
  const picks = D().quickPicks(WED);
  assert.equal(picks.length, 5);
  assert.deepEqual(picks.map(p => p.key), ['today', 'tomorrow', 'fri', 'mon', 'none']);
  assert.deepEqual(picks.map(p => p.iso),
    [WED, '2026-09-24', '2026-09-25', '2026-09-28', '']);
  assert.equal(picks[0].label, 'Today');
  assert.equal(picks[1].label, 'Tomorrow');
  assert.equal(picks[4].label, 'No date');
});

test('the weekday picks are labelled with their real date', () => {
  const picks = D().quickPicks(WED);
  assert.equal(picks[2].label, 'Fri, Sep 25');
  assert.equal(picks[3].label, 'Mon, Sep 28');
});

test('quickPicks is stable across the viewer timezone', () => {
  const seen = new Set();
  for (const tz of ['America/Phoenix', 'Asia/Manila', 'UTC']) {
    process.env.TZ = tz;
    seen.add(D().quickPicks(WED).map(p => p.iso + '|' + p.label).join(','));
  }
  assert.equal(seen.size, 1, 'quick picks must not vary with the device zone');
});

test('timePicks leads with No time and returns 24h values', () => {
  const picks = D().timePicks();
  assert.equal(picks[0].key, 'none');
  assert.equal(picks[0].value, '');
  assert.deepEqual(picks.map(p => p.value),
    ['', '07:00', '09:00', '12:00', '14:00', '16:00']);
  assert.equal(picks[2].label, '9:00 AM');
  assert.equal(picks[5].label, '4:00 PM');
});
