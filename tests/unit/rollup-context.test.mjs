// tests/unit/rollup-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollupContext, fallbackRollup } from '../../supabase/functions/ai-assistant/lib/rollup.mjs';

const TODAY = '2026-07-15'; // window: 2026-07-08 .. 2026-07-22
const mk = (o) => ({ id: o.id || 't', title: o.title || 'T', company: o.company || 'Lumen', due: o.due ?? null, status: o.status || 'todo', completedAt: o.completedAt ?? null });

test('percent complete is done / total, rounded', () => {
  const ctx = buildRollupContext([
    mk({ status: 'done', completedAt: '2026-07-10' }),
    mk({ status: 'todo' }),
    mk({ status: 'todo' }),
  ], { today: TODAY });
  assert.equal(ctx.counts.total, 3);
  assert.equal(ctx.pct, 33); // 1/3
});

test('empty project → 0% and empty lines, no throw', () => {
  const ctx = buildRollupContext([], { today: TODAY, projectName: 'Empty' });
  assert.equal(ctx.pct, 0);
  assert.equal(ctx.counts.total, 0);
  assert.deepEqual(ctx.lines, []);
  assert.equal(ctx.projectName, 'Empty');
});

test('partitions done / slipped / coming / open within the window', () => {
  const ctx = buildRollupContext([
    mk({ title: 'done-in',  status: 'done', completedAt: '2026-07-10' }),
    mk({ title: 'done-out', status: 'done', completedAt: '2026-07-01' }), // >7d ago → not "done this week"
    mk({ title: 'slipped',  due: '2026-07-10' }),                          // open, due<today, within week
    mk({ title: 'today',    due: '2026-07-15' }),                          // open, due today → coming
    mk({ title: 'coming',   due: '2026-07-20' }),                          // open, within +7
    mk({ title: 'far',      due: '2026-07-30' }),                          // beyond +7 → excluded from lines
    mk({ title: 'nodate' }),                                               // open, no due → open bucket
  ], { today: TODAY });
  assert.deepEqual(ctx.counts, { total: 7, done: 1, slipped: 1, coming: 2, open: 1 });
});

test('lines ordered slipped, coming, open, done and labeled', () => {
  const ctx = buildRollupContext([
    mk({ title: 'D', status: 'done', completedAt: '2026-07-12' }),
    mk({ title: 'C', due: '2026-07-18' }),
    mk({ title: 'S', due: '2026-07-09' }),
    mk({ title: 'O' }),
  ], { today: TODAY });
  assert.equal(ctx.lines[0], 'SLIPPED · S · Lumen · was due 2026-07-09');
  assert.equal(ctx.lines[1], 'DUE 2026-07-18 · C · Lumen');
  assert.equal(ctx.lines[2], 'OPEN · O · Lumen');
  assert.equal(ctx.lines[3], 'DONE · D · Lumen');
});

test('fallbackRollup names the project and its percent', () => {
  const ctx = buildRollupContext([
    mk({ status: 'done', completedAt: '2026-07-10' }),
    mk({ due: '2026-07-09' }),
  ], { today: TODAY, projectName: 'Roof A' });
  const fb = fallbackRollup(ctx);
  assert.equal(fb.source, 'fallback');
  assert.match(fb.text, /^Roof A:/);
  assert.match(fb.text, /50% complete/);
});

test('fallbackRollup handles the empty project', () => {
  const ctx = buildRollupContext([], { today: TODAY, projectName: 'Empty' });
  const fb = fallbackRollup(ctx);
  assert.equal(fb.text, 'Empty has no tasks yet.');
  assert.deepEqual(fb.bullets, []);
});
