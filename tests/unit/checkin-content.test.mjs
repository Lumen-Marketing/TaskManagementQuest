// tests/unit/checkin-content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningContext, eodContext, shapeMessage, fallbackMorning, fallbackEod, stalledText } from '../../supabase/functions/checkins/lib/content.mjs';

const T = (o) => ({ id: o.id, title: o.title, company_id: o.company_id || 'roofing',
  due: o.due ?? null, status: o.status || 'todo', completed_at: o.completed_at ?? null });

test('morningContext counts overdue and due-today', () => {
  const ctx = morningContext([
    T({ id: 'a', title: 'Late', due: '2026-07-10' }),
    T({ id: 'b', title: 'Today', due: '2026-07-15' }),
  ], { today: '2026-07-15' });
  assert.equal(ctx.counts.overdue, 1);
  assert.equal(ctx.counts.dueToday, 1);
});

test('eodContext counts done-today and slipped', () => {
  const ctx = eodContext([
    T({ id: 'a', title: 'Finished', status: 'done', completed_at: '2026-07-15T18:00:00Z' }),
    T({ id: 'b', title: 'Missed', due: '2026-07-14' }),
  ], { today: '2026-07-15' });
  assert.equal(ctx.counts.done, 1);
  assert.equal(ctx.counts.slipped, 1);
});

test('shapeMessage uses model text when present, else fallback', () => {
  assert.deepEqual(shapeMessage('  Real text ', 'FB'), { text: 'Real text', source: 'model' });
  assert.deepEqual(shapeMessage('', 'FB'), { text: 'FB', source: 'fallback' });
  assert.deepEqual(shapeMessage(null, 'FB'), { text: 'FB', source: 'fallback' });
});

test('fallbacks and stalledText produce non-empty plain strings', () => {
  assert.match(fallbackMorning({ counts: { overdue: 2, dueToday: 1, total: 5 } }), /2/);
  assert.match(fallbackEod({ counts: { done: 3, slipped: 0, open: 4 } }), /3/);
  const s = stalledText([{ id: 't1', title: 'Alpha' }, { id: 't2', title: 'Beta' }]);
  assert.match(s, /Alpha/);
  assert.match(s, /Beta/);
});
