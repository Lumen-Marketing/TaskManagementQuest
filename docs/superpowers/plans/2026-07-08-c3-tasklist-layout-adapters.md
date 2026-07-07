# C3 — TaskList Module + Layout Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,743-line TaskListView into one TaskList module (shared machinery: scroll keep, selection sync, empty states, shared row builder, delegated row events) plus one adapter file per layout behind a `render(view, tasks)` seam, and memoize the controller's visible-tasks computation.

**Architecture:** Strangler-style, one adapter per commit, each visually gated by a new `tasklist-preview.html` harness (stubbed controller + sample tasks — same pattern as taskdetail-preview.html). Adapters register into an `App.TaskListLayouts` registry; TaskListView keeps dispatch + shared helpers and shrinks to ~600 lines. The visible-tasks memo lives in the controller (fingerprint-keyed — safer than per-setter invalidation: no setter can be forgotten). Spec: `docs/superpowers/specs/2026-07-08-mobile-perf-architecture-program-design.md` §C3.

**Tech Stack:** vanilla JS (`App.*` globals, zero-build), Playwright screenshot harness for visual gates, `npm run test:unit` for the memo helper.

## Global Constraints

- **Zero visual change.** Every adapter move is a verbatim relocation (`this.` → `view.`); each task's gate is before/after screenshots of THAT layout in light + dark + 390px mobile via the preview harness. Boss-visible pixels must not move.
- **Spec amendment (reality beat the audit): SIX adapters, not five.** The dispatch in `_renderListInner` (TaskListView.js:295-316) has six paths: `watching` (a *view*), `kanban`/`cards`/`calendar` (layouts), `execution` (when `sortBy === 'focus'`), `table` (default). The spec's five missed execution. Also: `renderWorkerList`/`renderWorkerRow` (lines 651–726) are **dead code — no callers** — delete, don't migrate.
- **Adapter interface (the seam):** `App.TaskListLayouts[key] = { render(view, tasks), mount?(view), unmount?(view) }`. `view` is the TaskListView instance — adapters may call its shared helpers (`view.renderRow`, `view._renderEmpty`, `view.body`, `view.controller`) but must NOT touch each other.
- **Load order:** adapter files load after `TaskListView.js`? **No — before.** TaskListView's constructor calls `render()`; adapters must already be registered. Script order in app.html: the six `js/views/tasklist/*.js` files come BEFORE `js/views/TaskListView.js` (they only touch `App.TaskListLayouts`, no other dependencies).
- Stacked on branch `worktree-c1-mobile-load-path` per user decision; verify branch before every commit.
- Commit after every task; run `npm run test:unit` before every commit.

---

### Task 1: `tasklist-preview.html` harness

**Files:**
- Create: `tasklist-preview.html`

**Interfaces:**
- Consumes: real `js/views/TaskListView.js` + (as they appear) `js/views/tasklist/*.js`, real CSS.
- Produces: a file-loadable page rendering the real list with ~10 stubbed tasks; a `?layout=` query param (`table|kanban|cards|calendar|watching|execution`) selects the path; every later task's visual gate uses it.

- [ ] **Step 1: Write the harness.** Model it directly on `taskdetail-preview.html` (same stub blocks: `App.PEOPLE`, `App.COMPANIES`, `App.PRIORITIES`, `App.TASK_TYPES/LABELS/STATUSES`, `App.taxonomy`, `App.utils`, `App.Motion`, `App.EventBus`). Body must contain the elements TaskListView touches: `#taskViewWrap` (with `.list-header`, `#layoutSwitcher` with six `[data-layout]` buttons, `#pageEyebrow`, `#pageTitle`, the stat ids `stat-open/today/review/done`, `#newTaskBtn`, `#filterBtn`, `#selectBtn`, `#clearDoneBtn`) and `#listBody` inside a `.list-pane`. Stub controller surface (mirror what TaskListView calls): `uiState` (`view:'all'`, `scope:'all'`, `layout` from the query param, `sortBy` = `'focus'` when `?layout=execution`, `searchQuery:''`, `filters:{}`, `bulkMode:false`, `bulkSelected:new Set()`, `selectedTaskId:null`, `groupBy:'none'`, `calendarMode:'month'`, `calendarAnchor: '2026-07-01'`), `getVisibleTasks()` returning 10 sample tasks (varied statuses/priorities/dues/assignees, 2 done, 1 stuck, watchers for the watching panel), and alert-stub actions (`selectTask`, `toggleTimerForTask`, `setLayout`, `setSortBy`, `toggleGroupCollapsed`, `setCompanyScopeFilter`, `toggleFilterValue`, `setFilterDueRange`, `clearFilters`, `openNewTaskPage`, `toggleBulkMode`, `toggleBulkSelect`, `clearDoneTasks`, `setCalendarMode`, `stepCalendar`, `clearProjectScope`, `reorderFocus`, `canView: () => true`, `canDeleteTask: () => true`). Set `window.App.can = () => true`, `currentUser: 'abraham'`. Load `js/views/dragOrder.js` too (execution list needs it). After the stubs: `<script src="js/views/TaskListView.js"></script>` and a boot line `new App.TaskListView({ taskModel, timeModel, controller: App.controller, currentUser: 'abraham' })` with `taskModel.all()` returning the samples and `timeModel.activeFor: () => null, totalForTask: () => 0, entriesForTask: () => []`.
- [ ] **Step 2: Verify all six paths render TODAY (pre-refactor baseline).** Run the screenshot script (shot-c1.js pattern, add `?layout=` arg) for each of the six keys, light theme desktop. Every shot must show a populated list (no blank body, no console errors). These are the BASELINE images every later task diffs against.
- [ ] **Step 3: Commit** — `git add tasklist-preview.html && git commit -m "test(tasklist): preview harness for all six list layouts (baseline for the adapter split)"`

### Task 2: Controller memo for visible tasks

**Files:**
- Modify: `js/controllers/AppController.js:545-557` (`getVisibleTasks`)
- Create: `tests/unit/memo-fingerprint.test.mjs` (for the helper)
- Modify: `js/utils.js` (add `App.utils.fingerprint`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getVisibleTasks()` — same signature, same return, cached until tasks change or any parameter changes. Callers MUST NOT mutate the returned array in place.

- [ ] **Step 1: Audit callers for in-place mutation.** `grep -n "getVisibleTasks()\|getFilteredTasks()" js/ -r` then inspect each site for `.sort(` / `.reverse(` / `.splice(` on the result. Any found gets a local `.slice()` before mutating (renderExecutionList and renderCalendar are the likely offenders). List them in the commit message.
- [ ] **Step 2: Add the helper to `js/utils.js`:**
```js
  // Stable stringify for memo keys: arrays/objects of JSON-safe values only.
  fingerprint(value) { return JSON.stringify(value, (k, v) => (v instanceof Set ? [...v] : v)); },
```
- [ ] **Step 3: Unit-test the helper** (`tests/unit/memo-fingerprint.test.mjs`): equal objects → equal strings; different nesting → different; Set support. (3 asserts, node:test — same import pattern as persistence-engine.test.mjs but require `js/utils.js`… `utils.js` touches `App` global: set `globalThis.App = {}` before requiring, or export-guard it the way PersistenceEngine.js does — do the export-guard.)
- [ ] **Step 4: Memoize in the controller.** In the constructor add `this._visibleCache = { key: null, value: null };` and `App.EventBus.on('tasks:changed', () => { this._visibleCache.key = null; });`. Rewrite `getVisibleTasks()`:
```js
  getVisibleTasks() {
    const role = App.effectiveRole();
    const params = {
      view: this.uiState.view, scope: this.uiState.scope,
      searchQuery: this.uiState.searchQuery, currentUser: this.currentUser,
      activeFilters: this.uiState.filters, currentCompany: this.uiState.currentCompany,
      role, reportMemberIds: this._reportMemberIds(role),
    };
    // Fingerprint-keyed memo: any parameter change (view/scope/search/filters/
    // company/role/reports) changes the key; task-data changes invalidate via
    // the tasks:changed listener in the constructor. No setter can be forgotten.
    const key = App.utils.fingerprint(params);
    if (this._visibleCache.key === key) return this._visibleCache.value;
    const value = this.taskModel.getFiltered(params);
    this._visibleCache = { key, value };
    return value;
  }
```
- [ ] **Step 5: Verify.** `npm run test:unit` green; boot probe (no errors); preview harness table layout renders identically to baseline.
- [ ] **Step 6: Commit** — `refactor(controller): memoize getVisibleTasks behind a fingerprint key — every caller (list, badges, prev/next, export) stops re-filtering per call`

### Task 3: Registry + dispatch + TableLayout (the big one)

**Files:**
- Create: `js/views/tasklist/TableLayout.js`
- Modify: `js/views/TaskListView.js`, `app.html`

**Interfaces:**
- Consumes: Task 1's harness for gating.
- Produces: `App.TaskListLayouts` registry; `view._layoutKey()`; dispatch calling `unmount` on layout switch. Every later adapter follows this file's exact shape.

- [ ] **Step 1: app.html — add the six script tags** (defer, BEFORE TaskListView.js; five are placeholders that 404 harmlessly? NO — never ship 404s: add each tag in the task that creates its file. Here add ONLY TableLayout):
```html
<script defer src="js/views/tasklist/TableLayout.js"></script>
<script defer src="js/views/TaskListView.js"></script>
```
Also add the same tag (non-defer fine) to `tasklist-preview.html` before TaskListView.
- [ ] **Step 2: Create the adapter file skeleton:**
```js
/* Table layout adapter (CONTEXT.md: Layout). Registered into App.TaskListLayouts;
   TaskListView dispatches render(view, tasks) — `view` is the TaskList module,
   whose shared helpers (renderRow, _renderEmpty, body, controller) adapters may
   use. Layout-specific wiring lives here, not in the module. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});
  // ...file-private helpers (moved methods become functions taking `view`)...
  layouts.table = {
    render(view, tasks) { /* body of renderTable */ },
  };
})();
```
- [ ] **Step 3: Move the table cluster verbatim** from TaskListView.js into the file as private functions, rewriting `this.` → `view.` and internal calls `this._qtRow(t)` → `qtRow(view, t)`: `renderTable` (727-789) → `layouts.table.render`, plus `_qtGroupIcon` (790), `_qtChipRow` (800), `_qtColsHeader` (818), `_qtRow` (841), `_prependProjectHeader` (921), and the column-filter cluster `_bindColumnFilters` (56), `_columnFilterModel` (71), `_openColumnFilter` (108), `_renderColumnFilterMenu` (133), `_clearColumnFilter` (166), `_closeColumnFilter` (172), `_syncColumnFilterState` (182). `bindStaticButtons` drops its `this._bindColumnFilters()` call — the table adapter binds its own header buttons on render (it already re-binds at old line 837).
- [ ] **Step 4: Delete dead code:** `renderWorkerList` (651-686) + `renderWorkerRow` (687-726). `grep -rn "renderWorker" js/` afterwards → nothing.
- [ ] **Step 5: Rewrite the dispatch** in TaskListView:
```js
  _layoutKey() {
    if (this.controller.uiState.view === 'watching') return 'watching';
    const l = this.controller.uiState.layout;
    if (l === 'kanban' || l === 'cards' || l === 'calendar') return l;
    if (this.controller.uiState.sortBy === 'focus') return 'execution';
    return 'table';
  }
```
and in `_renderListInner`, replace the six-way if-chain: keep the body-class/qt-skin/focus-cleanup preamble, then
```js
    const key = this._layoutKey();
    const adapter = App.TaskListLayouts[key];
    if (this._activeAdapter && this._activeAdapter !== adapter && this._activeAdapter.unmount) this._activeAdapter.unmount(this);
    if (adapter !== this._activeAdapter && adapter.mount) adapter.mount(this);
    this._activeAdapter = adapter;
    return adapter.render(this, this.getFilteredTasks());
```
During THIS task only `table` is registered — the old methods for the other five stay on the view, so register five thin passthroughs at the bottom of TaskListView.js (removed one per later task):
```js
  // TEMPORARY passthroughs — deleted as each adapter file lands (C3 T4–T7).
  App.TaskListLayouts.kanban = { render: (v) => v.renderKanban() };
  App.TaskListLayouts.cards = { render: (v) => v.renderCards() };
  App.TaskListLayouts.calendar = { render: (v) => v.renderCalendar() };
  App.TaskListLayouts.watching = { render: (v) => v.renderWatching() };
  App.TaskListLayouts.execution = { render: (v) => v.renderExecutionList() };
```
- [ ] **Step 6: Gate.** `node --check` both files; harness shots `?layout=table` (light+dark+mobile) — pixel-match the Task 1 baseline; the other five layouts still render via passthroughs; `npm run test:unit`; boot probe.
- [ ] **Step 7: Commit** — `refactor(tasklist): App.TaskListLayouts registry + dispatch; Table layout moves to its adapter; delete dead renderWorkerList`

### Task 4: Kanban + Cards adapters

**Files:** Create `js/views/tasklist/KanbanLayout.js`, `js/views/tasklist/CardsLayout.js`; modify `js/views/TaskListView.js`, `app.html`, `tasklist-preview.html`.

- [ ] **Step 1:** Move `renderKanban` (941) + `renderKanbanCard` (987) into KanbanLayout.js; `renderCards` (1028) + `renderTaskCard` (1042) into CardsLayout.js — same file shape as Task 3 Step 2. Delete the two passthrough lines. Script tags before TaskListView.js in both HTML files.
- [ ] **Step 2:** Gate: shots `?layout=kanban` and `?layout=cards` vs baseline; `node --check`; tests; commit — `refactor(tasklist): Kanban and Cards layouts move behind the seam`

### Task 5: Calendar adapter

**Files:** Create `js/views/tasklist/CalendarLayout.js`; modify the same three.

- [ ] **Step 1:** Move `renderCalendar` (1089), `_calWeekLabel` (1199), `_calChip` (1211), `_bindCalendar` (1219). Delete passthrough. Tags.
- [ ] **Step 2:** Gate: `?layout=calendar` shots vs baseline (check month grid + chips + nav buttons render); commit — `refactor(tasklist): Calendar layout moves behind the seam`

### Task 6: Watching adapter

**Files:** Create `js/views/tasklist/WatchingLayout.js`; modify the same three.

- [ ] **Step 1:** Move `renderWatching` (343), `_renderWatchedTasksInto` (356), `_renderWatchingTeamInto` (379). These call `view.renderRow` (shared — stays on the view). Delete passthrough. Tags.
- [ ] **Step 2:** Gate: `?layout=watching` shots (both stacked panels present) vs baseline; commit — `refactor(tasklist): Watching layout moves behind the seam`

### Task 7: Execution adapter (drag wiring via mount/unmount)

**Files:** Create `js/views/tasklist/ExecutionLayout.js`; modify the same three.

- [ ] **Step 1:** Move `renderExecutionList` (482), `_execBackBar` (543), `_execTailCompare` (552), `_onExecDrop` (564), `_nearestOrderedSeq` (592), `renderExecRow` (605). The existing `this._focusCleanup` teardown in `_renderListInner`'s preamble becomes this adapter's `unmount(view)` (move the cleanup there; the preamble keeps only a defensive `if (view._focusCleanup)` no-op removal note). Delete the last passthrough block.
- [ ] **Step 2:** Gate: `?layout=execution` shots (ranked section + back bar + drag handles visible) vs baseline; drag smoke: in the harness, assert `App.dragOrder` wired (listeners registered — check `view._focusCleanup` set after render). Commit — `refactor(tasklist): Execution layout moves behind the seam; drag teardown becomes unmount()`

### Task 8: Delegated shared-row events

**Files:** Modify `js/views/TaskListView.js` (renderRow ~1243, `_wrapSwipe`), `js/views/tasklist/TableLayout.js` (`_qtRow` listener block ~old-900), `js/views/tasklist/ExecutionLayout.js` (`renderExecRow` listener ~old-636).

**Interfaces:**
- Produces: ONE delegated `click` listener on `#listBody` (installed once in the constructor) handling `[data-id]` rows and `[data-action]` controls inside them. Row markup unchanged; per-row `.addEventListener` calls for SHARED actions removed.

- [ ] **Step 1: Inventory the shared actions.** Read the three per-row listener blocks; they all branch on `e.target.closest('[data-action]')` with actions like `toggle-timer`, `open-quick`, `bulk-check`, status chip, else → `controller.selectTask(id)`. Write the union down; anything layout-unique (kanban card click at 1018, calendar chips, group headers) STAYS adapter-bound.
- [ ] **Step 2: Install the delegate** in the TaskListView constructor (after `this.body` is set):
```js
    // ONE delegated listener serves every layout's rows: zero re-attach cost on
    // re-render, and one place for shared row behavior. Layout-specific controls
    // (calendar nav, kanban columns, group headers) bind in their adapters.
    this.body.addEventListener('click', (e) => this._onRowClick(e));
```
with `_onRowClick(e)` implementing the Step-1 union (port the branch bodies verbatim; resolve `id` from `e.target.closest('[data-id]')`, bail if none).
- [ ] **Step 3: Remove the now-redundant per-row listeners** in `renderRow`, `_qtRow`, `renderExecRow` (keep `_wrapSwipe`'s touch listeners — they're gesture-specific, per-row by necessity).
- [ ] **Step 4: Interaction gate (behavior, not pixels).** Playwright against the harness, per layout `table|watching|execution`: click a row → `selectTask` alert/stub fires exactly once (no double-fire); click the timer control → `toggleTimerForTask` fires and row click does NOT; repeat after a re-render (call `App.EventBus.emit('tasks:changed')` in-page) → still exactly once (proves no stacking).
- [ ] **Step 5:** tests + boot probe + commit — `perf(tasklist): one delegated row listener replaces per-row wiring in table/exec/shared rows`

### Task 9: Verification sweep + ship gate

- [ ] **Step 1:** All six layouts × light + dark + 390px mobile via the harness — diff against Task 1 baselines; ZERO intended differences.
- [ ] **Step 2:** `npm run test:unit` (24 + new = all green); boot probe on the dev server (no errors, redirect intact).
- [ ] **Step 3:** Measure and record: TaskListView.js line count (expect ~1,743 → ≤700), per-adapter line counts, `grep -c addEventListener js/views/TaskListView.js` before/after (expect large drop).
- [ ] **Step 4:** Re-measure the C6 attrition metric (taskdetail-preview stub member count) — expect unchanged; note in summary.
- [ ] **Step 5:** Report done. C3 merges with the stacked branch whenever the user ships.

## Self-review notes

- **Spec coverage:** seam shape ✓ (registry + render/mount/unmount), module-owns-delegated-rows ✓ (T8), controller memo ✓ (T2, fingerprint variant documented), per-layout files ✓ (T3–T7), no virtualization ✓ (absent). Amendments recorded: six adapters; dead worker-list deletion; memo mechanism is fingerprint-keyed rather than per-setter invalidation (same decided outcome — controller-level, all callers win — but immune to forgotten setters).
- **Ordering risk checked:** adapters before TaskListView in script order (constructor renders immediately); passthroughs bridge T3→T7 so every commit ships all six layouts working.
- **Type consistency:** `App.TaskListLayouts`, `render(view, tasks)`, `mount/unmount(view)`, `_layoutKey`, `_activeAdapter` used identically across tasks.
- **No placeholders:** move-tasks name exact methods + line ranges; new code shown in full.
