// tests/unit/digest-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestContext, shapeDigest, fallbackDigest } from '../../supabase/functions/ai-assistant/lib/digest.mjs';

const TODAY = '2026-07-15'; // window: 2026-07-08 .. 2026-07-22
const mk = (o) => ({ id: o.id || 't', title: o.title || 'T', company: o.company || 'Lumen', due: o.due ?? null, status: o.status || 'todo', completedAt: o.completedAt ?? null });

test('partitions done / slipped / coming within the 7-day window', () => {
  const ctx = buildDigestContext([
    mk({ title: 'done-in',  status: 'done', completedAt: '2026-07-10' }),
    mk({ title: 'done-out', status: 'done', completedAt: '2026-07-01' }), // 14d ago → excluded
    mk({ title: 'slipped',  due: '2026-07-10' }),                          // open, due<today, within week
    mk({ title: 'today',    due: '2026-07-15' }),                          // open, due today → coming
    mk({ title: 'coming',   due: '2026-07-20' }),                          // open, within +7
    mk({ title: 'far',      due: '2026-07-30' }),                          // beyond +7 → excluded
  ], { today: TODAY });
  assert.deepEqual(ctx.counts, { done: 1, slipped: 1, coming: 2 });
});

test('lines are ordered slipped, coming, done and labeled', () => {
  const ctx = buildDigestContext([
    mk({ title: 'D', status: 'done', completedAt: '2026-07-12' }),
    mk({ title: 'C', due: '2026-07-18' }),
    mk({ title: 'S', due: '2026-07-09' }),
  ], { today: TODAY });
  assert.equal(ctx.lines[0], 'SLIPPED · S · Lumen · was due 2026-07-09');
  assert.equal(ctx.lines[1], 'DUE 2026-07-18 · C · Lumen');
  assert.equal(ctx.lines[2], 'DONE · D · Lumen');
});

test('a task with a completedAt is treated as done even if status lags', () => {
  const ctx = buildDigestContext([mk({ title: 'X', status: 'todo', completedAt: '2026-07-11', due: '2026-07-09' })], { today: TODAY });
  assert.deepEqual(ctx.counts, { done: 1, slipped: 0, coming: 0 }); // counted done, not slipped
});

test('fallbackDigest summarizes counts deterministically', () => {
  const out = fallbackDigest({ counts: { done: 3, slipped: 1, coming: 2 }, lines: ['SLIPPED · S · Lumen · was due 2026-07-09'] });
  assert.equal(out.source, 'fallback');
  assert.match(out.text, /3 tasks completed this week/);
  assert.match(out.text, /1 slipped/);
  assert.equal(out.bullets.length, 1);
});

test('shapeDigest splits narrative + bullets, falls back on empty', () => {
  const ctx = { counts: { done: 0, slipped: 0, coming: 0 }, lines: [] };
  const shaped = shapeDigest('A calm week overall.\n- Ship the deck\n- Call Eagle', ctx);
  assert.equal(shaped.source, 'model');
  assert.equal(shaped.text, 'A calm week overall.');
  assert.deepEqual(shaped.bullets, [{ taskId: null, label: 'Ship the deck' }, { taskId: null, label: 'Call Eagle' }]);
  assert.equal(shapeDigest('', ctx).source, 'fallback');
});
