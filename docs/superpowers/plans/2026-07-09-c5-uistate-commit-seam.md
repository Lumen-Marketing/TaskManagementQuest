# C5 — UiState Commit Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the persist/emit/route tails of AppController's ~13 UI-state setters behind one `_commit(patch)` seam driven by a declarative, unit-tested policy table — killing the "forgot to emit / forgot to persist" bug class.

**Architecture:** New `js/UiStatePolicy.js` holds a pure `planCommit(prev, patch)` planner plus a per-field policy table (`field → { event, payload, persisted, routed }`). `AppController._commit(patch, opts)` applies the plan: assign changes → `opts.onApply()` → `_persistUiState()` if any persisted field changed → emit each event once (policy declaration order) → `_syncRoute()` if any routed field changed. Setters keep their imperative heads (guards + cascades) but assemble a patch object and end with a single `_commit` call. Behavior is **normalized** (events only on actual change, deduped, standard ordering) — every observable divergence from today is listed in Task 6's QA checklist.

**Tech Stack:** Vanilla JS (zero-build static SPA, classic `<script defer>` tags), node:test for unit tests.

## Global Constraints

- Zero-build: no ES modules in browser code; classic scripts with `if (typeof window !== 'undefined')` / `if (typeof module !== 'undefined')` dual-mode guards (pattern: `js/EventBus.js`, `js/directory.js`).
- Unit tests run via `npm run test:unit` (`node --test "tests/unit/*.test.mjs"`), CommonJS-required through `createRequire`.
- ⚠️ Git path casing (Windows): after the first commit of the new file, run `git ls-files js/UiStatePolicy.js` and confirm it prints the exact path — a casing mismatch stages nothing silently (bit us on `js/directory.js`, see commit 668d335).
- Excluded from `_commit` by design (documented in the new file's header): `setCompany` + role preview (deliberate force-refresh `view:changed` emits), `restoreUiState` (silent bulk restore), `initCompanyContext` boot path, `creatingTask`/`bulkMode` toggles (pane/DOM tails).
- Reference-equality contract: object/Set-valued fields (`filters`, `collapsedGroups`) must be passed as fresh instances in patches; in-place mutation is invisible to the diff.

---

### Task 1: `js/UiStatePolicy.js` — policy table + pure planner

**Files:**
- Create: `js/UiStatePolicy.js`
- Create: `tests/unit/uistate-policy.test.mjs`
- Modify: `app.html` (script tag after line 265, `js/directory.js`)

**Interfaces:**
- Consumes: nothing (pure module; no App globals inside `planCommit`)
- Produces: `App.uiStatePolicy.planCommit(prev, patch) → { dirty, changed, events: [{name, payload}], persist, route }` and `App.uiStatePolicy.POLICY`. Node: `module.exports = { POLICY, planCommit }`. Task 2's `_commit` relies on exactly this shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/uistate-policy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { POLICY, planCommit } = require('../../js/UiStatePolicy.js');

// Mirror of AppController's uiState fields that the policy governs.
const base = () => ({
  view: 'all', scope: 'all', layout: 'table',
  calendarMode: 'month', calendarAnchor: null, calendarSelectedDay: null,
  sortBy: 'priority', sortDir: 'asc', groupBy: 'due',
  collapsedGroups: new Set(), searchQuery: '', selectedTaskId: null,
  filters: { assignees: [], dueRange: 'all' }, filtersOpen: false,
});

test('no-op patch: same values → not dirty, no events, no persist/route', () => {
  const plan = planCommit(base(), { view: 'all', selectedTaskId: null });
  assert.equal(plan.dirty, false);
  assert.deepEqual(plan.events, []);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, false);
});

test('view change → payload event + persist + route', () => {
  const plan = planCommit(base(), { view: 'home' });
  assert.equal(plan.dirty, true);
  assert.deepEqual(plan.changed, { view: 'home' });
  assert.deepEqual(plan.events, [{ name: 'view:changed', payload: 'home' }]);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, true);
});

test('sortBy + sortDir in one patch → ONE sort:changed', () => {
  const plan = planCommit(base(), { sortBy: 'due', sortDir: 'desc' });
  assert.deepEqual(plan.events, [{ name: 'sort:changed', payload: undefined }]);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, false);
});

test('calendar trio shares ONE calendar:changed; only selected day routes', () => {
  let plan = planCommit(base(), { calendarMode: 'week', calendarAnchor: '2026-07-01' });
  assert.deepEqual(plan.events, [{ name: 'calendar:changed', payload: undefined }]);
  assert.equal(plan.route, false);
  plan = planCommit(base(), { calendarSelectedDay: '2026-07-09' });
  assert.equal(plan.route, true);
  assert.equal(plan.persist, false);
});

test('searchQuery: payload event, no persist, no route', () => {
  const plan = planCommit(base(), { searchQuery: 'roof' });
  assert.deepEqual(plan.events, [{ name: 'search:changed', payload: 'roof' }]);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, false);
});

test('selection: no payload, routes, does not persist', () => {
  const plan = planCommit(base(), { selectedTaskId: 't-1' });
  assert.deepEqual(plan.events, [{ name: 'selection:changed', payload: undefined }]);
  assert.equal(plan.persist, false);
  assert.equal(plan.route, true);
});

test('unknown field throws (typo guard)', () => {
  assert.throws(() => planCommit(base(), { vieww: 'home' }), /unknown field/);
});

test('object fields diff by reference: same ref clean, fresh ref dirty', () => {
  const prev = base();
  assert.equal(planCommit(prev, { filters: prev.filters }).dirty, false);
  const plan = planCommit(prev, { filters: { ...prev.filters } });
  assert.equal(plan.dirty, true);
  assert.equal(plan.persist, true);
  assert.equal(plan.route, true);
});

test('emit order = POLICY declaration order, not patch key order', () => {
  const plan = planCommit(base(), { sortBy: 'due', view: 'home', layout: 'kanban' });
  assert.deepEqual(plan.events.map(e => e.name),
    ['view:changed', 'layout:changed', 'sort:changed']);
});

test('every POLICY entry has the full shape', () => {
  for (const [k, p] of Object.entries(POLICY)) {
    assert.equal(typeof p.event, 'string', k);
    assert.equal(typeof p.payload, 'boolean', k);
    assert.equal(typeof p.persisted, 'boolean', k);
    assert.equal(typeof p.routed, 'boolean', k);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../js/UiStatePolicy.js'`

- [ ] **Step 3: Implement `js/UiStatePolicy.js`**

```js
/* UiStatePolicy (CONTEXT.md: Commit) — the single policy for how a uiState
   change becomes observable: which EventBus event each field fires, whether
   the change persists into the last-state blob, and whether the route hash
   re-syncs. AppController._commit(patch) is the only production caller;
   planCommit is pure so Node tests exercise the full policy without a DOM.

   Field facts mirror the pre-seam setters:
   - persisted === the field appears in AppController._persistUiState()'s blob
   - routed === the field is read by AppController._routeFromState()
   - payload === listeners today receive the new value (view/scope/layout/
     search/filtersOpen); the rest emit bare signals.

   Contract: change detection is Object.is per field, so object/Set-valued
   fields (filters, collapsedGroups) must arrive as FRESH instances — in-place
   mutation is invisible. A setter wanting "no event when semantically
   unchanged" for those fields must omit the field from the patch (see
   setGroupBy's collapsedGroups.size check).

   Excluded from _commit by design:
   - setCompany / role preview: emit view:changed as a deliberate force-refresh
     although uiState.view did not change — derived emission would drop it.
   - restoreUiState: silent bulk restore before views first render.
   - initCompanyContext boot path: runs before views exist.
   - creatingTask / bulkMode toggles: tails are pane/DOM choreography, not
     field→event policy. Candidates for a later pass. */

// Declaration order below is the emit order for multi-field commits.
const UI_STATE_POLICY = {
  view:                { event: 'view:changed',            payload: true,  persisted: true,  routed: true  },
  scope:               { event: 'scope:changed',           payload: true,  persisted: true,  routed: false },
  layout:              { event: 'layout:changed',          payload: true,  persisted: true,  routed: true  },
  calendarMode:        { event: 'calendar:changed',        payload: false, persisted: true,  routed: false },
  calendarAnchor:      { event: 'calendar:changed',        payload: false, persisted: false, routed: false },
  calendarSelectedDay: { event: 'calendar:changed',        payload: false, persisted: false, routed: true  },
  sortBy:              { event: 'sort:changed',            payload: false, persisted: true,  routed: false },
  sortDir:             { event: 'sort:changed',            payload: false, persisted: true,  routed: false },
  groupBy:             { event: 'group:changed',           payload: false, persisted: true,  routed: false },
  collapsedGroups:     { event: 'group:collapsed-changed', payload: false, persisted: false, routed: false },
  searchQuery:         { event: 'search:changed',          payload: true,  persisted: false, routed: false },
  selectedTaskId:      { event: 'selection:changed',       payload: false, persisted: false, routed: true  },
  filters:             { event: 'filters:changed',         payload: false, persisted: true,  routed: true  },
  filtersOpen:         { event: 'filters:toggled',         payload: true,  persisted: false, routed: false },
};

const UI_STATE_FIELD_ORDER = Object.keys(UI_STATE_POLICY);

function planCommit(prev, patch) {
  const changed = {};
  for (const k of Object.keys(patch)) {
    if (!UI_STATE_POLICY[k]) throw new Error('[UiStatePolicy] unknown field: ' + k);
    if (!Object.is(prev[k], patch[k])) changed[k] = patch[k];
  }
  const keys = Object.keys(changed);
  const events = [];
  const seen = new Set();
  for (const field of UI_STATE_FIELD_ORDER) {
    if (!(field in changed)) continue;
    const p = UI_STATE_POLICY[field];
    if (seen.has(p.event)) continue;
    seen.add(p.event);
    events.push({ name: p.event, payload: p.payload ? changed[field] : undefined });
  }
  return {
    dirty: keys.length > 0,
    changed,
    events,
    persist: keys.some(k => UI_STATE_POLICY[k].persisted),
    route: keys.some(k => UI_STATE_POLICY[k].routed),
  };
}

if (typeof window !== 'undefined') {
  window.App = window.App || {};
  App.uiStatePolicy = { POLICY: UI_STATE_POLICY, planCommit };
}
if (typeof module !== 'undefined') module.exports = { POLICY: UI_STATE_POLICY, planCommit };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all new tests green, prior 38 untouched.

- [ ] **Step 5: Add the script tag**

In `app.html`, directly after line 265 (`<script defer src="js/directory.js"></script>`), insert:

```html
<script defer src="js/UiStatePolicy.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/UiStatePolicy.js tests/unit/uistate-policy.test.mjs app.html
git ls-files js/UiStatePolicy.js   # MUST print the path — casing check
git commit -m "feat(uistate): UiStatePolicy — declarative field→event/persist/route table + pure planCommit (C5)"
```

---

### Task 2: `_commit()` glue + simple setters (scope, layout, search, sort, group)

**Files:**
- Modify: `js/controllers/AppController.js` — add `_commit` after `_syncRoute()` (~line 374); rewrite `setScope` (~247), `setSearchQuery` (~475), `setLayout` (~480), `setSortBy` (~2497), `setGroupBy` (~2509), `toggleGroupCollapsed` (~2518)

**Interfaces:**
- Consumes: `App.uiStatePolicy.planCommit(prev, patch)` from Task 1
- Produces: `this._commit(patch, opts?) → boolean` (`opts.onApply?: () => void` runs after assignment, before persist/emit/route). Tasks 3–5 call exactly this.

- [ ] **Step 1: Add `_commit` right after `_syncRoute()`**

```js
  /* Apply a uiState patch through UiStatePolicy: diff against current state,
     assign only real changes, then persist / emit / route-sync exactly as the
     policy table dictates — one emit per event, only when a value changed.
     opts.onApply runs after the patch lands but before events fire (setView
     uses it for _togglePanes so listeners see the right pane visibility).
     Returns false (and does nothing) when the patch changes nothing. */
  _commit(patch, opts = {}) {
    const plan = App.uiStatePolicy.planCommit(this.uiState, patch);
    if (!plan.dirty) return false;
    Object.assign(this.uiState, plan.changed);
    if (opts.onApply) opts.onApply();
    if (plan.persist) this._persistUiState();
    plan.events.forEach(ev => App.EventBus.emit(ev.name, ev.payload));
    if (plan.route) this._syncRoute();
    return true;
  }
```

- [ ] **Step 2: Rewrite the five setters**

```js
  setScope(scope) {
    if (scope !== 'mine' && scope !== 'all') return;
    this._commit({ scope });
  }
```

```js
  setSearchQuery(q) {
    this._commit({ searchQuery: q });
  }
```

```js
  setLayout(layout) {
    if (!['table', 'calendar', 'kanban', 'cards'].includes(layout)) return;
    this._commit({ layout });
  }
```

```js
  setSortBy(key) {
    if (!App.SORT_OPTIONS[key]) return;
    if (this.uiState.sortBy === key) {
      this._commit({ sortDir: this.uiState.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      this._commit({ sortBy: key, sortDir: 'asc' });
    }
  }
```

```js
  setGroupBy(key) {
    if (!App.GROUP_OPTIONS[key]) return;
    if (this.uiState.groupBy === key) return;
    const patch = { groupBy: key };
    // Fresh-instance contract: only include the reset when groups are actually
    // collapsed, so group:collapsed-changed doesn't fire for an empty→empty swap.
    if (this.uiState.collapsedGroups.size) patch.collapsedGroups = new Set();
    this._commit(patch);
  }
```

```js
  toggleGroupCollapsed(key) {
    const next = new Set(this.uiState.collapsedGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    this._commit({ collapsedGroups: next });
  }
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit`
Expected: PASS (no unit coverage on AppController — this guards against syntax slips in shared files).

- [ ] **Step 4: Browser sanity check**

Open the app (`app.html` served locally or Vercel preview): toggle Sort (label updates, direction flips on second click), change Group by (regroups, collapsed state resets), collapse/expand one group, switch layout table→kanban→table, type in search, flip My work/Company. Reload — sort/group/layout-relevant state restores as before.

- [ ] **Step 5: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "refactor(controller): route scope/layout/search/sort/group setter tails through _commit (C5)"
```

---

### Task 3: Calendar cluster + selection setters

**Files:**
- Modify: `js/controllers/AppController.js` — `setCalendarMode` (~490), `shiftCalendar` (~502), `resetCalendarToToday` (~517), `selectCalendarDay` (~524), `openCalendarOn` (~534), `selectTask` (~655), `selectAdjacentTask` (~664), `closeDetail` (~682)

**Interfaces:**
- Consumes: `this._commit(patch)` from Task 2
- Produces: unchanged public setter signatures

- [ ] **Step 1: Rewrite the calendar setters**

```js
  setCalendarMode(mode) {
    if (mode !== 'month' && mode !== 'week') return;
    // Guard stays: without it, a same-mode call would still clear the selected
    // day via the cascade below.
    if (this.uiState.calendarMode === mode) return;
    this._commit({ calendarMode: mode, calendarSelectedDay: null });
  }
```

```js
  shiftCalendar(delta) {
    const base = this.uiState.calendarAnchor
      ? new Date(this.uiState.calendarAnchor + 'T00:00:00')
      : new Date();
    if (this.uiState.calendarMode === 'week') {
      base.setDate(base.getDate() + delta * 7);
    } else {
      base.setMonth(base.getMonth() + delta);
    }
    this._commit({ calendarAnchor: App.utils.toISODate(base), calendarSelectedDay: null });
  }
```

```js
  resetCalendarToToday() {
    this._commit({ calendarAnchor: null, calendarSelectedDay: null });
  }
```

```js
  selectCalendarDay(iso) {
    this._commit({
      calendarSelectedDay: this.uiState.calendarSelectedDay === iso ? null : iso,
    });
  }
```

```js
  openCalendarOn(iso) {
    this._commit({ calendarAnchor: iso, calendarSelectedDay: iso });
    this.setView('all');
    this.setLayout('calendar');
  }
```

- [ ] **Step 2: Rewrite the selection setters** (keep `selectAdjacentTask`'s scroll block verbatim after its commit)

```js
  selectTask(id) {
    this._commit({ selectedTaskId: (this.uiState.selectedTaskId === id) ? null : id });
  }
```

```js
  selectAdjacentTask(delta) {
    const tasks = this.getVisibleTasks();
    if (!tasks.length) return;
    const ids = tasks.map(t => t.id);
    const cur = ids.indexOf(this.uiState.selectedTaskId);
    let next;
    if (cur === -1) next = delta > 0 ? 0 : ids.length - 1;
    else next = (cur + delta + ids.length) % ids.length;
    const id = ids[next];
    this._commit({ selectedTaskId: id });
    // Bring the row into view if it scrolled off.
    const safe = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
    const el = document.querySelector(`#listBody [data-id="${safe}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
```

```js
  closeDetail() {
    this._commit({ selectedTaskId: null });
  }
```

- [ ] **Step 3: Run tests + browser check**

Run: `npm run test:unit` → PASS.
Browser: calendar month/week toggle, prev/next arrows, Today button, click a day (select + deselect), Home mini-calendar date → jumps to calendar anchored on that date; open a task, j/k next/prev, Esc closes, task URL hash updates each time.

- [ ] **Step 4: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "refactor(controller): calendar + selection setters through _commit (C5)"
```

---

### Task 4: `setView` — the cascade-heavy setter

**Files:**
- Modify: `js/controllers/AppController.js` — `setView` (~212)

**Interfaces:**
- Consumes: `this._commit(patch, { onApply })` from Task 2
- Produces: unchanged `setView(view)` signature

- [ ] **Step 1: Rewrite `setView`**

The head (guards + cascades) stays imperative and assembles the patch; the tail becomes one commit. `_togglePanes()` must run after the patch lands but **before** events fire — views like ClockDashboardView gate their render on `!wrap.classList.contains('hidden')`, so pane visibility has to be current when `view:changed` lands. That's the `onApply` hook.

```js
  setView(view) {
    if (!this.canView(view)) {
      if (this.toastView) this.toastView.show({ title: 'No access', sub: 'Your role cannot open that view.' });
      return;
    }
    // Navigating anywhere must escape the full-page New-task form. Without this,
    // the top-nav/logo clicks changed the view underneath while the form stayed
    // covering it — the "I want to go home, I can't go home" dead end.
    if (this.uiState.creatingTask) this.closeNewTaskPage();
    if (this.uiState.view === view) return;
    const patch = { view, selectedTaskId: null };
    // All Tasks always OPENS in table view, whatever mode it was left in.
    // Explicit switches after entry (View menu, openCalendarOn) still apply.
    if (view === 'all' && this.uiState.layout !== 'table') patch.layout = 'table';
    // Focus is a shared cross-person list reached via the widget / Sort menu,
    // not tied to any view — so switching views exits Execution-order back to a
    // normal sort. The diff emits sort:changed only when this actually fires.
    if (this.uiState.sortBy === 'focus') patch.sortBy = 'priority';
    this._commit(patch, { onApply: () => this._togglePanes() });
  }
```

- [ ] **Step 2: Run tests + browser check**

Run: `npm run test:unit` → PASS.
Browser (the riskiest task — walk all of it): sidebar through Home / All Tasks / Urgent / Today / a team view / admin views (as admin); All Tasks always lands on table; enter Execution order via Focus widget then switch views (sort exits to Priority, Sort button label updates); open a task then switch views (detail closes); New task page then click logo (form closes, navigation works); reload restores last view.

- [ ] **Step 3: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "refactor(controller): setView assembles cascade patch + onApply pane hook (C5)"
```

---

### Task 5: Filters, saved views, project scope

**Files:**
- Modify: `js/controllers/AppController.js` — `toggleFilters` (~2392), `toggleFilterValue` (~2397), `setFilterDueRange` (~2406), `setCompanyScopeFilter` (~2415), `clearFilters` (~2421), `applySavedView` (~2475), `openProject` (~1640), `clearProjectScope` (~1648)

**Interfaces:**
- Consumes: `this._commit(patch)` from Task 2
- Produces: unchanged public signatures. Every filter mutation now produces a **fresh** `filters` object (reference-equality contract).

- [ ] **Step 1: Rewrite the filter setters**

```js
  toggleFilters() {
    this._commit({ filtersOpen: !this.uiState.filtersOpen });
  }
```

```js
  toggleFilterValue(group, value) {
    const arr = this.uiState.filters[group];
    if (!Array.isArray(arr)) return;
    const next = arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];
    this._commit({ filters: { ...this.uiState.filters, [group]: next } });
  }
```

```js
  setFilterDueRange(range) {
    this._commit({ filters: { ...this.uiState.filters, dueRange: range || 'all' } });
  }
```

```js
  setCompanyScopeFilter(id) {
    this._commit({
      filters: { ...this.uiState.filters, companies: (id && id !== 'all') ? [id] : [] },
    });
  }
```

```js
  clearFilters() {
    // Full replacement (drops projectId too) — matches the pre-seam behavior;
    // the route policy now also heals the stale #/folder hash this used to leave.
    this._commit({ filters: { assignees: [], companies: [], statuses: [], priorities: [], types: [], projects: [], labels: [], dueRange: 'all' } });
  }
```

- [ ] **Step 2: Rewrite project scoping**

```js
  openProject(projectId) {
    this._commit({ filters: { ...(this.uiState.filters || {}), projectId: projectId || null } });
    this.setView('all');
  }
```

```js
  clearProjectScope() {
    if (!this.uiState.filters) return;
    this._commit({ filters: { ...this.uiState.filters, projectId: null } });
  }
```

- [ ] **Step 3: Rewrite `applySavedView`**

```js
  // Apply a saved view: restore its state; _commit re-renders only the
  // surfaces whose state actually changed.
  applySavedView(id) {
    const v = this.getSavedViews().find(x => x.id === id);
    if (!v) return;
    const patch = {};
    if (v.filters && typeof v.filters === 'object') patch.filters = JSON.parse(JSON.stringify(v.filters));
    if (v.sortBy && App.SORT_OPTIONS[v.sortBy]) patch.sortBy = v.sortBy;
    if (v.sortDir === 'asc' || v.sortDir === 'desc') patch.sortDir = v.sortDir;
    if (v.groupBy && App.GROUP_OPTIONS[v.groupBy]) patch.groupBy = v.groupBy;
    if (['table', 'calendar', 'kanban', 'cards'].includes(v.layout)) patch.layout = v.layout;
    if (this.uiState.collapsedGroups.size) patch.collapsedGroups = new Set();
    this._commit(patch);
  }
```

- [ ] **Step 4: Run tests + browser check**

Run: `npm run test:unit` → PASS.
Browser: open filter panel (chip count updates), toggle assignee/status/label chips, due-range, company chip row on the Tasks board, Clear filters; save a view, change everything, apply the saved view (board restores); open a folder from Projects (list scopes + `#/folder/…` hash), clear folder scope; reload mid-filter (filters restore).

- [ ] **Step 5: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "refactor(controller): filters/saved-views/project-scope through _commit — fresh-instance patches (C5)"
```

---

### Task 6: Vocabulary, guard comments, full verification

**Files:**
- Modify: `CONTEXT.md` (add "Commit" term after **PersistenceEngine**)
- Modify: `js/controllers/AppController.js` (one comment line in `restoreUiState`, ~line 295)

- [ ] **Step 1: Add the term to CONTEXT.md**

Insert after the **PersistenceEngine** entry:

```markdown
**Commit (UI state)**:
The single step where a uiState patch becomes observable — diffed, persisted, emitted (one event per field group), and route-synced per the UiStatePolicy table. Setters assemble patches; `_commit` applies them.
_Avoid_: dispatch, setState, reducer
```

- [ ] **Step 2: Guard-comment `restoreUiState`**

Above its first mutation, add:

```js
    // Deliberately bypasses _commit: this is a silent bulk restore that runs
    // before views first render — nothing may emit or route-sync here.
```

- [ ] **Step 3: Full suite + observable-changes QA checklist**

Run: `npm run test:unit` → PASS (48+ tests).

Normalization changes to verify deliberately (everything else must behave identically):
1. Calendar "Today" when already on today → no re-render (was a redundant `calendar:changed`).
2. Esc with no task open → nothing fires (was a redundant `selection:changed`).
3. Saved-view apply → only genuinely changed aspects re-render (was 4 unconditional events).
4. Regrouping with collapsed groups open → collapse state resets AND `group:collapsed-changed` fires (was a silent reset).
5. Clear-filters inside a folder → `#/folder/…` hash also resets (pre-seam stale-route bug, now healed by `filters: routed`).
6. Folder scope now persists across reload deterministically (pre-seam it leaked into the blob only if some other persisting setter ran afterwards).
7. `setView` event order is now view → layout → sort → selection (was layout first); all listeners are idempotent re-renders.
8. Company switcher and role preview still force-refresh correctly (excluded paths — untouched).

- [ ] **Step 4: Commit**

```bash
git add CONTEXT.md js/controllers/AppController.js
git commit -m "docs(context): Commit (UI state) term + restoreUiState bypass note (C5)"
```
