// tests/unit/draft-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from '../../supabase/functions/ai-assistant/lib/draft.mjs';

const LISTS = {
  team: [{ id: 'josh', name: 'Josh' }, { id: 'shan', name: 'Shan' }],
  companies: [{ id: 'lumen', label: 'Lumen' }, { id: 'roofing', label: 'Quest Roofing' }],
};

test('keeps valid fields that match the allowed lists', () => {
  const out = validateDraft(
    { assignee: 'josh', company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30' }, LISTS);
  assert.deepEqual(out, { assignee: 'josh', company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30' });
});

test('nulls out assignee/company not on the list', () => {
  const out = validateDraft({ assignee: 'nobody', company: 'acme' }, LISTS);
  assert.equal(out.assignee, null);
  assert.equal(out.company, null);
});

test('nulls out bad priority, date, and time', () => {
  const out = validateDraft({ priority: 'HUGE', due: '07/17/2026', dueTime: '25:99' }, LISTS);
  assert.equal(out.priority, null);
  assert.equal(out.due, null);
  assert.equal(out.dueTime, null);
});

test('garbage / missing input yields all nulls, fully shaped', () => {
  const shape = { assignee: null, company: null, priority: null, due: null, dueTime: null };
  assert.deepEqual(validateDraft(null, LISTS), shape);
  assert.deepEqual(validateDraft('nope', LISTS), shape);
  assert.deepEqual(validateDraft({}, LISTS), shape);
});

test('ignores unknown keys', () => {
  const out = validateDraft({ assignee: 'shan', hacker: 'drop table' }, LISTS);
  assert.deepEqual(out, { assignee: 'shan', company: null, priority: null, due: null, dueTime: null });
});
