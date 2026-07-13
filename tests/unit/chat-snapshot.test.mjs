// tests/unit/chat-snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatSnapshot } from '../../supabase/functions/ai-assistant/lib/chat.mjs';

const TODAY = '2026-07-14';
const mk = (o) => ({ title: 'T', company: 'Lumen', assignee: 'josh', priority: 'medium', status: 'todo', due: null, completedAt: null, done: false, ...o });

test('maps a task to a compact line with the right tag', () => {
  const { lines, truncated } = buildChatSnapshot([mk({ title: 'Send deck', company: 'Skyline', assignee: 'abraham', due: '2026-07-10' })], { today: TODAY });
  assert.equal(truncated, false);
  assert.equal(lines[0], 'OVERDUE · Send deck · Skyline · abraham · due 2026-07-10');
});

test('done tasks show a completed date and sort last', () => {
  const { lines } = buildChatSnapshot([
    mk({ title: 'Kickoff', done: true, status: 'done', completedAt: '2026-06-28T10:00:00Z' }),
    mk({ title: 'Urgent', due: '2026-07-10' }),
  ], { today: TODAY });
  assert.match(lines[0], /^OVERDUE · Urgent/);
  assert.equal(lines[1], 'DONE · Kickoff · Lumen · josh · no due date · completed 2026-06-28');
});

test('orders overdue, due-today, on-hold, open, done', () => {
  const { lines } = buildChatSnapshot([
    mk({ title: 'open-nodue' }),
    mk({ title: 'done1', done: true, status: 'done', completedAt: '2026-06-01' }),
    mk({ title: 'hold1', status: 'hold' }),
    mk({ title: 'today1', due: TODAY }),
    mk({ title: 'over1', due: '2026-07-01' }),
  ], { today: TODAY });
  const tags = lines.map((l) => l.split(' · ')[0]);
  assert.deepEqual(tags, ['OVERDUE', 'DUE TODAY', 'ON HOLD', 'OPEN', 'DONE']);
});

test('caps at max and reports truncation', () => {
  const many = Array.from({ length: 5 }, (_, i) => mk({ title: 'task' + i, due: '2026-07-1' + i }));
  const { lines, truncated } = buildChatSnapshot(many, { today: TODAY, max: 3 });
  assert.equal(lines.length, 3);
  assert.equal(truncated, true);
});

test('missing company/assignee render as em dash; garbage in yields empty', () => {
  const { lines } = buildChatSnapshot([mk({ title: 'X', company: '', assignee: null })], { today: TODAY });
  assert.equal(lines[0], 'OPEN · X · — · — · no due date');
  assert.deepEqual(buildChatSnapshot(null, { today: TODAY }), { lines: [], truncated: false });
});
