// tests/unit/tasksheet-form.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/newtask/tokenParser.js');   // provides App.parseTaskTitle
require('../../js/views/tasksheet/formModel.js');

const F = () => App.TaskSheet.form;
const CTX = {
  company: 'roofing', me: 'abraham', todayIso: '2026-09-23',
  defaultStatus: 'todo', defaultType: 'admin',
};
const PARSE = {
  team: [{ id: 'abraham', name: 'Abraham' }, { id: 'jesus', name: 'Jesus' }],
  companies: [{ id: 'roofing', label: 'Roofing' }, { id: 'lumen', label: 'Lumen' }],
  today: '2026-09-23',
};

test('defaults assign the task to the current user', () => {
  const f = F().defaults(CTX);
  // App.validate.newTask rejects a task with no assignee, so this cannot be empty.
  assert.deepEqual(f.whos, ['abraham']);
  assert.equal(f.company, 'roofing');
  assert.equal(f.status, 'todo');
  assert.equal(f.type, 'admin');
  assert.equal(f.due, '2026-09-23');
  assert.equal(f.priority, 'medium');
  assert.deepEqual(f.checklist, []);
});

const TYPED = 'Order drip edge @jesus #lumen !high tmrw 9a';

test('applyTokens fills every row from the tokens', () => {
  const { form } = F().applyTokens(F().defaults(CTX), TYPED, Object.assign({ atEnd: true }, PARSE));
  assert.deepEqual(form.whos, ['jesus']);
  assert.equal(form.company, 'lumen');
  assert.equal(form.priority, 'high');
  assert.equal(form.due, '2026-09-24');
  assert.equal(form.time, '09:00');
});

test('the saved title has every token stripped', () => {
  // atEnd:true is the SAVE parse: the final token counts as complete.
  const { cleanTitle } = F().applyTokens(
    F().defaults(CTX), TYPED, Object.assign({ atEnd: true }, PARSE));
  assert.equal(cleanTitle, 'Order drip edge');
});

test('while typing, the last token is left alone until a space follows it', () => {
  // atEnd:false is the LIVE parse. Without it, typing "9a" on the way to "9am"
  // would resolve and vanish under the cursor.
  const live = F().applyTokens(F().defaults(CTX), TYPED, Object.assign({ atEnd: false }, PARSE));
  assert.equal(live.cleanTitle, 'Order drip edge 9a');
  assert.equal(live.form.time, '', 'the unterminated token has not been applied yet');

  // One more space and it resolves.
  const settled = F().applyTokens(F().defaults(CTX), TYPED + ' ', Object.assign({ atEnd: false }, PARSE));
  assert.equal(settled.form.time, '09:00');
  assert.equal(settled.cleanTitle, 'Order drip edge');
});

test('applyTokens does not mutate the form it was given', () => {
  const base = F().defaults(CTX);
  F().applyTokens(base, 'thing !high', PARSE);
  assert.equal(base.priority, 'medium');
});

test('tokens are recognised anywhere in the string, for voice-to-text', () => {
  const { form, cleanTitle } = F().applyTokens(
    F().defaults(CTX), '!high order the @jesus drip edge', Object.assign({ atEnd: true }, PARSE));
  assert.equal(form.priority, 'high');
  assert.deepEqual(form.whos, ['jesus']);
  assert.equal(cleanTitle, 'order the drip edge');
});

test('an unmatched token is left in the title rather than silently eaten', () => {
  const { form, cleanTitle } = F().applyTokens(
    F().defaults(CTX), 'call @nobody about it', Object.assign({ atEnd: true }, PARSE));
  assert.equal(cleanTitle, 'call @nobody about it');
  assert.deepEqual(form.whos, ['abraham'], 'assignee is untouched by a failed match');
});

test('toPayload maps the checklist onto subtasks', () => {
  const f = F().defaults(CTX);
  f.checklist = [{ t: 'Measure', d: false }, { t: 'Order', d: true }];
  const p = F().toPayload(f, 'Fix drip edge');
  assert.deepEqual(p.subtasks, [{ t: 'Measure', d: false }, { t: 'Order', d: true }]);
});

test('toPayload emits the keys validate.newTask reads', () => {
  const p = F().toPayload(F().defaults(CTX), 'Fix drip edge');
  assert.equal(p.title, 'Fix drip edge');
  assert.deepEqual(p.whos, ['abraham']);
  assert.equal(p.company, 'roofing');
  assert.equal(p.type, 'admin');
  assert.equal(p.status, 'todo');
  assert.equal(p.priority, 'medium');
  assert.equal(p.due, '2026-09-23');
  // validate.newTask defaults an absent label to 'roof'; send the explicit
  // "no label" key instead so a sheet with no label chosen stays unlabelled.
  assert.equal(p.label, 'none');
});

test('an empty time becomes null, not an empty string', () => {
  const f = F().defaults(CTX);
  f.time = '';
  assert.equal(F().toPayload(f, 'x').dueTime, null);
});

test('a blank checklist row is dropped', () => {
  const f = F().defaults(CTX);
  f.checklist = [{ t: '  ', d: false }, { t: 'Real step', d: false }];
  assert.deepEqual(F().toPayload(f, 'x').subtasks, [{ t: 'Real step', d: false }]);
});
