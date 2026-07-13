// tests/unit/briefing-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefingContext } from '../../supabase/functions/ai-assistant/lib/context.mjs';

const T = (o) => ({ id: o.id, title: o.title, company: o.company || 'roofing',
  due: o.due ?? null, status: o.status || 'todo', priority: o.priority || 'medium',
  assignee: o.assignee || 'me', focusSeq: o.focusSeq ?? null,
  completedAt: o.completedAt ?? null, activity: o.activity || [] });
const OPTS = { me: 'me', today: '2026-07-14', maxItems: 25 };

test('classifies and counts overdue / due-today / on-hold', () => {
  const ctx = buildBriefingContext([
    T({ id: 'a', title: 'Late thing', due: '2026-07-10' }),
    T({ id: 'b', title: 'Today thing', due: '2026-07-14' }),
    T({ id: 'c', title: 'Parked thing', status: 'hold' }),
    T({ id: 'd', title: 'Someone elses', due: '2026-07-10', assignee: 'other' }),
  ], OPTS);
  assert.equal(ctx.counts.overdue, 1);
  assert.equal(ctx.counts.dueToday, 1);
  assert.equal(ctx.counts.onHold, 1);
  assert.equal(ctx.counts.total, 3); // 'd' is not the viewer's task
  assert.match(ctx.lines[0], /^OVERDUE · Late thing/);
});

test('counts tasks completed since the given day boundary', () => {
  const ctx = buildBriefingContext([
    T({ id: 'a', title: 'Done today', status: 'done', completedAt: '2026-07-14T09:00:00Z' }),
    T({ id: 'b', title: 'Done last week', status: 'done', completedAt: '2026-07-01T09:00:00Z' }),
  ], OPTS);
  assert.equal(ctx.counts.completedSince, 1);
});

test('respects maxItems and truncates long titles', () => {
  const many = Array.from({ length: 40 }, (_, i) => T({ id: 'x' + i, title: 'x'.repeat(120), due: '2026-07-10' }));
  const ctx = buildBriefingContext(many, { ...OPTS, maxItems: 10 });
  assert.equal(ctx.lines.length, 10);
  assert.ok(ctx.lines[0].includes('x'.repeat(80)) && !ctx.lines[0].includes('x'.repeat(81)));
});

test('empty input yields zero counts and no lines', () => {
  const ctx = buildBriefingContext([], OPTS);
  assert.deepEqual(ctx.counts, { overdue: 0, dueToday: 0, onHold: 0, completedSince: 0, total: 0 });
  assert.deepEqual(ctx.lines, []);
});
