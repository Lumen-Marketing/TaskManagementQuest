// tests/unit/rollup-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeRollup, buildRollupContext } from '../../supabase/functions/ai-assistant/lib/rollup.mjs';

const ctx = buildRollupContext([
  { id: 'a', title: 'A', company: 'Lumen', due: '2026-07-09', status: 'todo', completedAt: null },
], { today: '2026-07-15', projectName: 'P' });

test('splits narrative from bullet lines', () => {
  const out = shapeRollup('The project is halfway done.\n- Ship A\n- Fix B', ctx);
  assert.equal(out.source, 'model');
  assert.equal(out.text, 'The project is halfway done.');
  assert.deepEqual(out.bullets.map((b) => b.label), ['Ship A', 'Fix B']);
});

test('caps bullets at 3 and accepts *, •, numbered', () => {
  const out = shapeRollup('Summary.\n* one\n• two\n3) three\n- four', ctx);
  assert.equal(out.bullets.length, 3);
});

test('empty / whitespace model text → fallback', () => {
  assert.equal(shapeRollup('', ctx).source, 'fallback');
  assert.equal(shapeRollup('   \n  ', ctx).source, 'fallback');
  assert.equal(shapeRollup(null, ctx).source, 'fallback');
});

test('bullets-only model text uses first bullet as text', () => {
  const out = shapeRollup('- only a bullet', ctx);
  assert.equal(out.source, 'model');
  assert.equal(out.text, 'only a bullet');
});
