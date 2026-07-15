// tests/unit/checkin-schedule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hqParts, weekKey, firesNow, MODE_HOUR } from '../../supabase/functions/checkins/lib/schedule.mjs';

// 2026-07-15 is a Wednesday. 15:00 UTC = 08:00 HQ (UTC-7).
const AUG_MORNING = Date.UTC(2026, 6, 15, 15, 30); // 08:30 HQ
const AUG_EOD = Date.UTC(2026, 6, 15, 23, 5);      // 16:05 HQ
const AUG_NOON = Date.UTC(2026, 6, 15, 19, 0);     // 12:00 HQ

test('hqParts converts UTC to HQ wall clock and date', () => {
  const p = hqParts(AUG_MORNING);
  assert.equal(p.hour, 8);
  assert.equal(p.minute, 30);
  assert.equal(p.dateKey, '2026-07-15');
});

test('hqParts rolls the date back across the UTC-7 midnight boundary', () => {
  // 2026-07-15 03:00 UTC = 2026-07-14 20:00 HQ.
  const p = hqParts(Date.UTC(2026, 6, 15, 3, 0));
  assert.equal(p.dateKey, '2026-07-14');
  assert.equal(p.hour, 20);
});

test('weekKey returns the HQ-Monday of the week', () => {
  // Wed 2026-07-15 -> Monday 2026-07-13.
  assert.equal(weekKey('2026-07-15'), '2026-07-13');
  // Sunday 2026-07-19 -> Monday 2026-07-13 (Sunday belongs to the week that started Mon 13).
  assert.equal(weekKey('2026-07-19'), '2026-07-13');
});

test('firesNow matches each mode to its HQ hour band', () => {
  assert.equal(firesNow('morning', AUG_MORNING), true);
  assert.equal(firesNow('eod', AUG_MORNING), false);
  assert.equal(firesNow('eod', AUG_EOD), true);
  assert.equal(firesNow('morning', AUG_NOON), false);
  assert.equal(MODE_HOUR.stalled, 9);
});
