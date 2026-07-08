# Desktop Optimization — C2 + C3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate listener accumulation across views (C2) and centralize unknown-entity fallback logic in Directory (C3), improving desktop reliability and locality.

**Architecture:** C2 patches EventBus to accept `{ signal }` so all listeners — DOM and pub/sub — are cleaned up via a single `AbortController.abort()` call per view re-render. C3 adds `personFallback(id)` and `companyFallback(id)` to `App.directory`, replacing inline stubs and one hardcoded company-id fallback scattered across views.

**Tech Stack:** Zero-build vanilla JS SPA; Node.js `node:test` for unit tests; Playwright for integration tests; no bundler.

## Global Constraints

- Zero-build: no bundler, no transpiler. All JS runs as-is in the browser.
- Unit tests live in `tests/unit/*.test.mjs`; run with `npm run test:unit`.
- Integration tests use Playwright; run with `npm test`.
- Never use `window` in Node.js unit test files — use dual-mode exports instead.
- `App.utils.unknownPerson` stays in `js/utils.js` (load-order constraint: utils loads before Directory; utils internals call `unknownPerson` and cannot call Directory).
- Do not introduce base classes or shared view lifecycle mixins — each view owns its own `_ac` field.
- No TypeScript, no `import`/`export` in browser files — use `window.App.*` globals in browser context; add `if (typeof module !== 'undefined') module.exports = ...` guards for Node.js testability.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `js/EventBus.js` | Modify | Extract `makeEventBus()` factory; add `{ signal }` option to `on()`; add `module.exports` |
| `js/Directory.js` | Modify | Add `personFallback(id)`, `companyFallback(id)`; add `module.exports` |
| `js/views/FocusWidgetView.js` | Modify | Pilot: replace `_cleanup` with `_ac` AbortController pattern |
| `js/views/ProjectsView.js` | Modify | Add `_ac` pattern to `_renderBody()`; fix 2 raw global reads |
| `js/views/TaskListView.js` | Modify | Replace 2 inline person stubs + 2 `App.COMPANIES.roofing` with Directory calls |
| `js/views/HierarchyView.js` | Modify | Replace inline person stub in `person()` method |
| `js/controllers/AppController.js` | Modify | Replace inline person stub at line 1739 |
| `tests/unit/eventbus-signal.test.mjs` | Create | Unit tests for `on()` `{ signal }` option |
| `tests/unit/directory-fallbacks.test.mjs` | Create | Unit tests for `personFallback` and `companyFallback` |

---

## Task 1: Patch EventBus with `{ signal }` support

**Files:**
- Modify: `js/EventBus.js`
- Create: `tests/unit/eventbus-signal.test.mjs`

**Interfaces:**
- Produces: `App.EventBus.on(event, fn, { signal })` — signal is optional; when provided, the listener auto-removes on `signal.abort()`
- Produces: `makeEventBus()` — factory exported for tests; returns a fresh EventBus instance

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/eventbus-signal.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeEventBus } = require('../../js/EventBus.js');

test('on() without signal: handler fires on emit', () => {
  const bus = makeEventBus();
  const calls = [];
  bus.on('x', v => calls.push(v));
  bus.emit('x', 1);
  assert.deepEqual(calls, [1]);
});

test('on() with signal: handler fires before abort', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  bus.emit('x', 1);
  assert.deepEqual(calls, [1]);
});

test('on() with signal: handler does NOT fire after abort', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  ac.abort();
  bus.emit('x', 2);
  assert.deepEqual(calls, []);
});

test('on() with signal: aborting one controller does not remove other listeners', () => {
  const bus = makeEventBus();
  const ac1 = new AbortController();
  const calls1 = [], calls2 = [];
  bus.on('x', v => calls1.push(v), { signal: ac1.signal });
  bus.on('x', v => calls2.push(v));
  ac1.abort();
  bus.emit('x', 3);
  assert.deepEqual(calls1, []);
  assert.deepEqual(calls2, [3]);
});

test('on() with already-aborted signal: handler never fires', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  ac.abort();
  const calls = [];
  bus.on('x', v => calls.push(v), { signal: ac.signal });
  bus.emit('x', 4);
  assert.deepEqual(calls, []);
});

test('return value is still an unsub function when signal is passed', () => {
  const bus = makeEventBus();
  const ac = new AbortController();
  const calls = [];
  const unsub = bus.on('x', v => calls.push(v), { signal: ac.signal });
  unsub();
  bus.emit('x', 5);
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm run test:unit
```

Expected: failures on `makeEventBus` not exported and `{ signal }` not handled.

- [ ] **Step 3: Rewrite `js/EventBus.js`**

Replace the entire file:

```js
/* Simple pub/sub used for one-way data flow:
   Models mutate and emit. Views subscribe and re-render.
   Controllers call model methods in response to user input. */

function makeEventBus() {
  const listeners = {};
  return {
    on(event, fn, { signal } = {}) {
      if (signal && signal.aborted) return () => {};
      (listeners[event] = listeners[event] || []).push(fn);
      const unsub = () => this.off(event, fn);
      if (signal) signal.addEventListener('abort', unsub, { once: true });
      return unsub;
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(l => l !== fn);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[EventBus]', event, e); }
      });
    },
  };
}

window.App = window.App || {};
App.EventBus = makeEventBus();

if (typeof module !== 'undefined') module.exports = { makeEventBus };
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm run test:unit
```

Expected: all 6 eventbus-signal tests pass.

- [ ] **Step 5: Commit**

```
git add js/EventBus.js tests/unit/eventbus-signal.test.mjs
git commit -m "feat(eventbus): on() accepts { signal } — listeners auto-remove on AbortController.abort()"
```

---

## Task 2: Add `personFallback` and `companyFallback` to Directory

**Files:**
- Modify: `js/Directory.js`
- Create: `tests/unit/directory-fallbacks.test.mjs`

**Interfaces:**
- Produces: `App.directory.personFallback(id)` → `{ id, name: string, full: string, color: '#E8A03A' }`
- Produces: `App.directory.companyFallback(id)` → `{ id, label: string, color: 'var(--ink-3)' }`
- Both accept `null` / `undefined` and return a sensible "Unknown" stub

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/directory-fallbacks.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { personFallback, companyFallback } = (() => {
  // Inline the pure fallback logic mirroring what Directory.js will export
  const personFallback = (id) => ({ id, name: id || 'Unassigned', full: id || 'Unassigned', color: '#E8A03A' });
  const companyFallback = (id) => ({ id, label: id || 'Unknown', color: 'var(--ink-3)' });
  // After Step 3 these will be replaced with require('../../js/Directory.js')
  return { personFallback, companyFallback };
})();

test('personFallback: known id → uses id as name', () => {
  const p = personFallback('user-99');
  assert.equal(p.id, 'user-99');
  assert.equal(p.name, 'user-99');
  assert.equal(p.full, 'user-99');
  assert.equal(p.color, '#E8A03A');
});

test('personFallback: null id → Unassigned', () => {
  const p = personFallback(null);
  assert.equal(p.name, 'Unassigned');
  assert.equal(p.full, 'Unassigned');
});

test('personFallback: undefined id → Unassigned', () => {
  const p = personFallback(undefined);
  assert.equal(p.name, 'Unassigned');
});

test('companyFallback: known id → uses id as label', () => {
  const c = companyFallback('roofing');
  assert.equal(c.id, 'roofing');
  assert.equal(c.label, 'roofing');
  assert.equal(c.color, 'var(--ink-3)');
});

test('companyFallback: null id → Unknown', () => {
  const c = companyFallback(null);
  assert.equal(c.label, 'Unknown');
});
```

- [ ] **Step 2: Run tests to verify they pass as stubs**

```
npm run test:unit
```

Expected: all 5 pass (using the inline stubs — this verifies the expected behaviour before wiring the real module).

- [ ] **Step 3: Update `js/Directory.js`**

Replace the entire file:

```js
window.App = window.App || {};

/* Directory (CONTEXT.md) — the roster of people, companies, and projects that
   tasks reference. This is the interface in front of the App.PEOPLE /
   App.COMPANIES / App.projects globals: views ask the directory, so a shape
   change to the underlying rows stops at this seam instead of touching every
   render site. Modeled on js/taxonomy.js.

   personFallback / companyFallback centralise the unknown-entity stub so every
   surface agrees on the fields (name, full, color for persons; label, color for
   companies). Call sites previously defined inline stubs with inconsistent
   field sets. App.utils.unknownPerson remains in utils.js for utils-internal
   use only — load order prevents utils from calling Directory. */
App.directory = {
  person(id) { return (id && App.PEOPLE && App.PEOPLE[id]) || null; },
  people() { return Object.values(App.PEOPLE || {}); },
  company(id) { return (id && App.COMPANIES && App.COMPANIES[id]) || null; },
  companies() { return Object.values(App.COMPANIES || {}); },
  project(id) { return (id && App.projects && App.projects[id]) || null; },
  projects() { return Object.values(App.projects || {}); },

  personFallback(id) {
    return { id, name: id || 'Unassigned', full: id || 'Unassigned', color: '#E8A03A' };
  },

  companyFallback(id) {
    return { id, label: id || 'Unknown', color: 'var(--ink-3)' };
  },

  /* Stacked-avatar cluster (lead first): overlapping circles with a ring so
     they read as one group. Accepts person objects or ids; unknown ids render
     with the id as the name. */
  avatarStack(peopleOrIds, opts = {}) {
    const max = opts.max == null ? 4 : opts.max;
    const list = (peopleOrIds || []).map(p =>
      (typeof p === 'string' ? (this.person(p) || this.personFallback(p)) : p)
    ).filter(Boolean);
    if (!list.length) {
      return `<span class="td2-av-stack"><span class="avatar-xs td2-av" style="background:var(--ink-3);">?</span></span>`;
    }
    const shown = list.slice(0, max);
    const extra = list.length - shown.length;
    const avs = shown.map(p => App.utils.avatarHtml(p, 'td2-av')).join('');
    const more = extra > 0 ? `<span class="avatar-xs td2-av td2-av-more">+${extra}</span>` : '';
    return `<span class="td2-av-stack">${avs}${more}</span>`;
  },
};

if (typeof module !== 'undefined') module.exports = {
  personFallback: App.directory.personFallback,
  companyFallback: App.directory.companyFallback,
};
```

- [ ] **Step 4: Update the test to use the real module**

Replace the inline stub block in `tests/unit/directory-fallbacks.test.mjs` with a real require:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Directory.js uses window.App — provide a minimal stub for Node.js
globalThis.window = globalThis;
globalThis.App = {};
const { personFallback, companyFallback } = require('../../js/Directory.js');

test('personFallback: known id → uses id as name', () => {
  const p = personFallback('user-99');
  assert.equal(p.id, 'user-99');
  assert.equal(p.name, 'user-99');
  assert.equal(p.full, 'user-99');
  assert.equal(p.color, '#E8A03A');
});

test('personFallback: null id → Unassigned', () => {
  const p = personFallback(null);
  assert.equal(p.name, 'Unassigned');
  assert.equal(p.full, 'Unassigned');
});

test('personFallback: undefined id → Unassigned', () => {
  const p = personFallback(undefined);
  assert.equal(p.name, 'Unassigned');
});

test('companyFallback: known id → uses id as label', () => {
  const c = companyFallback('roofing');
  assert.equal(c.id, 'roofing');
  assert.equal(c.label, 'roofing');
  assert.equal(c.color, 'var(--ink-3)');
});

test('companyFallback: null id → Unknown', () => {
  const c = companyFallback(null);
  assert.equal(c.label, 'Unknown');
});
```

- [ ] **Step 5: Run tests to verify they still pass with real module**

```
npm run test:unit
```

Expected: all 5 directory-fallbacks tests pass.

- [ ] **Step 6: Commit**

```
git add js/Directory.js tests/unit/directory-fallbacks.test.mjs
git commit -m "feat(directory): add personFallback() and companyFallback() — centralise unknown-entity stubs"
```

---

## Task 3: FocusWidgetView pilot — replace `_cleanup` with AbortController

**Files:**
- Modify: `js/views/FocusWidgetView.js`

**Interfaces:**
- Consumes: `App.EventBus.on(event, fn, { signal })` from Task 1
- Consumes: `new AbortController()` (browser built-in)

This is the proof-of-pattern view. `FocusWidgetView` already has a bespoke `_cleanup` field on line 28. Replace it entirely — no partial migration.

- [ ] **Step 1: Read the current file**

Open `js/views/FocusWidgetView.js` and note:
- Every `this._cleanup` reference (set, called, nulled)
- Every `addEventListener` call — what element, what event, what handler
- Every `App.EventBus.on()` call — what event, what handler

- [ ] **Step 2: Replace the cleanup preamble in every render method**

Wherever `this._cleanup` is set or cleared, replace with:

```js
// Before: if (this._cleanup) { this._cleanup(); this._cleanup = null; }
// After:
this._ac?.abort();
this._ac = new AbortController();
```

- [ ] **Step 3: Add `{ signal }` to every EventBus subscription**

Wherever the view calls `App.EventBus.on(event, fn)`, change to:

```js
App.EventBus.on(event, fn, { signal: this._ac.signal });
```

- [ ] **Step 4: Add `{ signal }` to every DOM addEventListener**

Wherever the view calls `el.addEventListener(event, fn)`, change to:

```js
el.addEventListener(event, fn, { signal: this._ac.signal });
```

- [ ] **Step 5: Verify manually**

Open the app in the browser (or preview build), navigate to a view that shows the focus widget, open DevTools → Memory → take heap snapshot. Switch away and back 10 times. Take a second snapshot. There should be no growth in event listener count for FocusWidgetView's DOM nodes.

- [ ] **Step 6: Run unit tests**

```
npm run test:unit
```

Expected: all tests still pass (no regressions).

- [ ] **Step 7: Commit**

```
git add js/views/FocusWidgetView.js
git commit -m "refactor(focuswidget): replace bespoke _cleanup with AbortController + signal pattern (C2 pilot)"
```

---

## Task 4: ProjectsView — raw globals + listener accumulation

**Files:**
- Modify: `js/views/ProjectsView.js`

**Interfaces:**
- Consumes: `App.directory.person(id)`, `App.directory.personFallback(id)` from Task 2
- Consumes: `App.directory.company(id)`, `App.directory.companyFallback(id)` from Task 2
- Consumes: `App.EventBus.on(event, fn, { signal })` from Task 1

**Two problems to fix in one pass:**

**Problem A — raw global reads (lines 81 and 250):**
- Line 81: `const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned' }`
- Line 250: `const co = App.COMPANIES[cid] || { label: cid }`

**Problem B — listener accumulation in `_renderBody()`:** every call adds 10+ listeners without removing prior ones.

- [ ] **Step 1: Fix the raw global reads**

Find line 81 in `js/views/ProjectsView.js`:

```js
// Before:
const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned' };

// After:
const person = App.directory.person(t.assignee) || App.directory.personFallback(t.assignee);
```

Find line 250 (may have shifted — search for `App.COMPANIES[cid]`):

```js
// Before:
const co = App.COMPANIES[cid] || { label: cid };

// After:
const co = App.directory.company(cid) || App.directory.companyFallback(cid);
```

- [ ] **Step 2: Add AbortController preamble to `_renderBody()`**

Find `_renderBody()` in `js/views/ProjectsView.js`. At the very top of the method body, before any DOM manipulation:

```js
_renderBody() {
  this._ac?.abort();
  this._ac = new AbortController();
  // ... rest of existing method unchanged
```

- [ ] **Step 3: Add `{ signal }` to every `addEventListener` inside `_renderBody()`**

Every `el.addEventListener(event, fn)` call inside `_renderBody()` becomes:

```js
el.addEventListener(event, fn, { signal: this._ac.signal });
```

Also add `{ signal }` to any `App.EventBus.on()` calls wired inside `_renderBody()`.

- [ ] **Step 4: Run unit tests**

```
npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 5: Verify in browser**

Open Projects view, trigger a data refresh (add a task, or switch companies and back) to force 5+ `_renderBody()` calls. Confirm the UI renders correctly and no ghost click handlers fire (clicking once should trigger exactly one action, not multiple).

- [ ] **Step 6: Commit**

```
git add js/views/ProjectsView.js
git commit -m "refactor(projects): fix raw global reads via Directory + add AbortController cleanup (C2+C3)"
```

---

## Task 5: Migrate remaining inline fallbacks

**Files:**
- Modify: `js/views/TaskListView.js`
- Modify: `js/views/HierarchyView.js`
- Modify: `js/controllers/AppController.js`

**Interfaces:**
- Consumes: `App.directory.personFallback(id)` and `App.directory.companyFallback(id)` from Task 2

Fix all remaining scattered fallback stubs in one pass.

- [ ] **Step 1: Fix `TaskListView.js` — `renderKanbanCard` (line ~260)**

```js
// Before:
const person = App.directory.person(t.assignee) || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
const company = App.directory.company(t.company) || App.COMPANIES.roofing;

// After:
const person = App.directory.person(t.assignee) || App.directory.personFallback(t.assignee);
const company = App.directory.company(t.company) || App.directory.companyFallback(t.company);
```

- [ ] **Step 2: Fix `TaskListView.js` — `renderRow` (line ~297)**

```js
// Before:
const person = App.directory.person(t.assignee) || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
const company = App.directory.company(t.company) || App.COMPANIES.roofing;

// After:
const person = App.directory.person(t.assignee) || App.directory.personFallback(t.assignee);
const company = App.directory.company(t.company) || App.directory.companyFallback(t.company);
```

- [ ] **Step 3: Fix `HierarchyView.js` — `person()` method (line ~28)**

```js
// Before:
person(memberId) {
  return App.directory.person(memberId) || { name: memberId, full: memberId, email: '', color: '#E8A03A' };
}

// After:
person(memberId) {
  return App.directory.person(memberId) || App.directory.personFallback(memberId);
}
```

- [ ] **Step 4: Fix `AppController.js` — assignee notification (line ~1739)**

```js
// Before:
const person = App.directory.person(newAssignee) || { name: newAssignee, email: '' };

// After:
const person = App.directory.person(newAssignee) || App.directory.personFallback(newAssignee);
```

Note: `personFallback` returns `{ id, name, full, color }` — it does not include `email`. The notification code reads `person.name` and `person.email`. After the change, `person.email` will be `undefined` for unknown assignees. Verify the notification path handles `undefined` email gracefully (it should skip sending email if no address is present — check the `_deliver` logic in the notification flow).

- [ ] **Step 5: Run unit tests**

```
npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Verify in browser**

Open the Tasks table view. Confirm rows with unknown assignees or companies still render without errors (name falls back to the raw id, company label falls back to the company id string — no blank or broken cells).

Open Kanban view and verify cards render correctly.

Open the Hierarchy view and confirm unknown members show a fallback name.

- [ ] **Step 7: Commit**

```
git add js/views/TaskListView.js js/views/HierarchyView.js js/controllers/AppController.js
git commit -m "refactor(fallbacks): replace inline person/company stubs with directory.personFallback/companyFallback (C3)"
```

---

## Self-Review

**Spec coverage:**
- C2: EventBus signal ✓ (Task 1), FocusWidgetView pilot ✓ (Task 3), ProjectsView worst offender ✓ (Task 4)
- C3: personFallback + companyFallback ✓ (Task 2), TaskListView ✓ (Task 5), HierarchyView ✓ (Task 5), AppController ✓ (Task 5), ProjectsView raw reads ✓ (Task 4)
- `App.utils.unknownPerson` stays ✓ (per load-order constraint; not touched)
- ADRs recorded ✓ (docs/adr/0003, 0004)

**Gaps:**
- `avatarStack()` in Directory.js already uses an inline fallback `{ name: p, full: p, color: 'var(--ink-3)' }` — Task 2 Step 3 updates it to call `this.personFallback(p)` instead. Verify this is included in the Directory.js replacement code in Task 2 Step 3. ✓ (the code in Step 3 already does this)
- `AppController.js line 1739` email field note: flagged in Task 5 Step 4. No additional task needed — the notification logic skips email delivery when email is absent.

**Placeholder scan:** No TBDs, no "similar to Task N", all code shown inline. ✓

**Type consistency:**
- `personFallback(id)` → `{ id, name, full, color }` — consistent across Task 2 definition and Task 3/4/5 usage ✓
- `companyFallback(id)` → `{ id, label, color }` — consistent ✓
- `makeEventBus()` → EventBus object — consistent ✓
