import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { STEPS, selectSteps, includeStep } = require('../../js/TourSteps.js');

/* Predicate bundles. selectSteps is pure: it decides inclusion purely from the
   three predicates (can / canView / isVisible), never touching the DOM. */
const ALL_YES = { can: () => true, canView: () => true, isVisible: () => true };
const withCanView = (fn) => ({ ...ALL_YES, canView: fn });
const withCan = (fn) => ({ ...ALL_YES, can: fn });
const withVisible = (fn) => ({ ...ALL_YES, isVisible: fn });

// The sections the tour is expected to walk into (Wallboard intentionally out).
const SECTION_VIEWS = [
  'home', 'all', 'projects', 'reports', 'time:mine', 'time:resource',
  'team:hierarchy', 'approvals', 'admin:clock', 'admin:task-setup',
  'admin:permissions', 'admin:reports',
];

test('every walkable section has at least one tour step that navigates to it', () => {
  // Completeness guard: if a new section is added, it must get a tour stop.
  // (The task view "all" carries several steps — task list, views, create,
  // clock — so this is an at-least-one check, not exactly-one.)
  for (const v of SECTION_VIEWS) {
    const hits = STEPS.filter(s => s.view === v);
    assert.ok(hits.length >= 1, `expected a step for view "${v}", got ${hits.length}`);
  }
});

test('there is no Wallboard step (decided out of scope)', () => {
  assert.equal(STEPS.some(s => s.view === 'wallboard'), false);
});

test('a section step navigates to its view AND spotlights a container selector', () => {
  for (const s of STEPS.filter(s => s.view)) {
    assert.ok(s.sel, `section step "${s.title}" must have a spotlight selector`);
  }
});

test('every step has a non-empty title and body', () => {
  for (const s of STEPS) {
    assert.equal(typeof s.title, 'string');
    assert.ok(s.title.length > 0, 'title');
    assert.equal(typeof s.body, 'string');
    assert.ok(s.body.length > 0, `body for "${s.title}"`);
  }
});

test('with full access, all steps are included', () => {
  assert.equal(selectSteps(STEPS, ALL_YES).length, STEPS.length);
});

test('Home step is dropped when canView("home") is false', () => {
  const preds = withCanView(v => v !== 'home');
  const out = selectSteps(STEPS, preds);
  assert.equal(out.some(s => s.view === 'home'), false);
  // A different section (projects) is still there.
  assert.equal(out.some(s => s.view === 'projects'), true);
});

test('"Create a task" is dropped without tasks.write even when the task view is allowed', () => {
  const preds = withCan(p => p !== 'tasks.write'); // canView still all-true
  const out = selectSteps(STEPS, preds);
  assert.equal(out.some(s => s.sel === '#newTaskBtn'), false);
  // The task-list step (gated only by the view) survives.
  assert.equal(out.some(s => s.sel === '#listPane'), true);
});

test('a visibility-gated chrome step follows isVisible()', () => {
  const hidden = selectSteps(STEPS, withVisible(sel => sel !== '#notifBtn'));
  assert.equal(hidden.some(s => s.sel === '#notifBtn'), false);
  const shown = selectSteps(STEPS, ALL_YES);
  assert.equal(shown.some(s => s.sel === '#notifBtn'), true);
});

test('welcome and closing cards are always included (no gate/view/sel)', () => {
  const nothing = { can: () => false, canView: () => false, isVisible: () => false };
  const out = selectSteps(STEPS, nothing);
  // First and last steps are the centered welcome/closing — always shown.
  assert.equal(out[0].title, STEPS[0].title);
  assert.equal(out[out.length - 1].title, STEPS[STEPS.length - 1].title);
  assert.ok(out.length >= 2);
});

test('selection preserves declaration order (output is a subsequence of STEPS)', () => {
  const preds = withCanView(v => v === 'home' || v === 'projects' || v === 'all');
  const out = selectSteps(STEPS, preds);
  const idx = out.map(s => STEPS.indexOf(s));
  const sorted = [...idx].sort((a, b) => a - b);
  assert.deepEqual(idx, sorted);
});

test('a task-only worker sees no admin/team/reports section steps', () => {
  // Worker: can view tasks + home, clock in, but no admin/team/reports/time-team.
  const workerCanView = (v) => ['home', 'all', 'projects', 'time:mine'].includes(v);
  const workerCan = (p) => ['tasks.view', 'tasks.write', 'clock.use', 'home.view'].includes(p);
  const out = selectSteps(STEPS, { can: workerCan, canView: workerCanView, isVisible: () => true });
  const views = out.map(s => s.view).filter(Boolean);
  for (const v of views) {
    assert.equal(v.startsWith('admin:'), false, `worker should not see ${v}`);
    assert.equal(['approvals', 'reports', 'team:hierarchy', 'time:resource'].includes(v), false,
      `worker should not see ${v}`);
  }
});

test('includeStep: explicit gate wins over view (used by "Create a task")', () => {
  // A step with both a view and a gate: inclusion follows the gate, not the view.
  const step = { view: 'all', sel: '#x', title: 't', body: 'b', gate: ({ can }) => can('tasks.write') };
  assert.equal(includeStep(step, withCan(() => false)), false);
  assert.equal(includeStep(step, withCan(() => true)), true);
});
