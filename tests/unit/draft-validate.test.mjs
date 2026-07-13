// tests/unit/draft-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from '../../supabase/functions/ai-assistant/lib/draft.mjs';

const LISTS = {
  team: [{ id: 'josh', name: 'Josh' }, { id: 'shan', name: 'Shan' }],
  companies: [{ id: 'lumen', label: 'Lumen' }, { id: 'roofing', label: 'Quest Roofing' }],
  types: [{ id: 'lead', label: 'Lead' }, { id: 'admin', label: 'Admin' }],
  labels: [{ id: 'urgent', label: 'Urgent' }],
  projects: [{ id: 'p1', label: 'Johnson reroof' }],
};

test('keeps valid fields that match the allowed lists', () => {
  const out = validateDraft(
    { assignees: ['josh'], company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30', type: 'lead', label: 'urgent', project: 'p1' }, LISTS);
  assert.deepEqual(out, { assignees: ['josh'], company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30', type: 'lead', label: 'urgent', project: 'p1' });
});

test('nulls out type/label/project not on their lists', () => {
  const out = validateDraft({ type: 'nope', label: 'nope', project: 'nope' }, LISTS);
  assert.equal(out.type, null);
  assert.equal(out.label, null);
  assert.equal(out.project, null);
});

test('keeps multiple valid assignees, drops unknowns, dedups', () => {
  const out = validateDraft({ assignees: ['josh', 'shan', 'nobody', 'josh'] }, LISTS);
  assert.deepEqual(out.assignees, ['josh', 'shan']);
});

test('accepts a singular assignee string too', () => {
  const out = validateDraft({ assignee: 'shan' }, LISTS);
  assert.deepEqual(out.assignees, ['shan']);
});

test('nulls out assignees/company not on the list', () => {
  const out = validateDraft({ assignees: ['nobody'], company: 'acme' }, LISTS);
  assert.deepEqual(out.assignees, []);
  assert.equal(out.company, null);
});

test('nulls out bad priority, date, and time', () => {
  const out = validateDraft({ priority: 'HUGE', due: '07/17/2026', dueTime: '25:99' }, LISTS);
  assert.equal(out.priority, null);
  assert.equal(out.due, null);
  assert.equal(out.dueTime, null);
});

test('garbage / missing input yields empty shape', () => {
  const shape = { assignees: [], company: null, priority: null, due: null, dueTime: null, type: null, label: null, project: null };
  assert.deepEqual(validateDraft(null, LISTS), shape);
  assert.deepEqual(validateDraft('nope', LISTS), shape);
  assert.deepEqual(validateDraft({}, LISTS), shape);
});

test('ignores unknown keys', () => {
  const out = validateDraft({ assignees: ['shan'], hacker: 'drop table' }, LISTS);
  assert.deepEqual(out, { assignees: ['shan'], company: null, priority: null, due: null, dueTime: null, type: null, label: null, project: null });
});
