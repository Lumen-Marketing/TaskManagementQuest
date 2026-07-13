// tests/unit/briefing-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeBriefing, fallbackBriefing } from '../../supabase/functions/ai-assistant/lib/shape.mjs';

const CTX = {
  today: '2026-07-14',
  counts: { overdue: 2, dueToday: 1, onHold: 1, completedSince: 3, total: 4 },
  lines: ['OVERDUE · Fix the sink · roofing · due 2026-07-10', 'DUE TODAY · Call client · lumen · due 2026-07-14'],
};

test('shapes a normal model reply into text + bullets', () => {
  const out = shapeBriefing('You have two overdue tasks.\n- Fix the sink first\n- Call the client', CTX);
  assert.equal(out.source, 'model');
  assert.match(out.text, /overdue/i);
  assert.ok(out.bullets.length >= 1 && out.bullets.length <= 3);
});

test('falls back when the model returns empty output', () => {
  const out = shapeBriefing('   ', CTX);
  assert.equal(out.source, 'fallback');
  assert.match(out.text, /overdue/);
});

test('falls back when model output is non-string / malformed', () => {
  assert.equal(shapeBriefing(null, CTX).source, 'fallback');
  assert.equal(shapeBriefing(undefined, CTX).source, 'fallback');
});

test('fallback text is deterministic from counts', () => {
  const a = fallbackBriefing(CTX).text;
  const b = fallbackBriefing(CTX).text;
  assert.equal(a, b);
  assert.match(a, /2 .*overdue/);
});

test('bullets never exceed 3', () => {
  const out = shapeBriefing('Summary line\n- a\n- b\n- c\n- d\n- e', CTX);
  assert.ok(out.bullets.length <= 3);
});
