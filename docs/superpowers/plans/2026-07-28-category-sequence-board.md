# Category Sequence Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task list default to a card board grouped by category (Task Type), where each category holds a manually-ordered 1‑2‑3 sequence the user rearranges by dragging or ▲▼ chevrons inline — no focus/execution mode to enter.

**Architecture:** A new `SequenceLayout` adapter renders one rounded card per category, each listing that category's tasks in manual order. Ordering is a pure, unit-tested helper (`App.sequenceOrder`); persistence re-sequences the affected group(s) from final DOM order through the existing `controller.setFocusOrder` seam (reuses `tasks.focus_seq`, no migration). A ported ghost+placeholder pointer-drag engine (`App.makeGroupReorderable`) supports drag *across* categories, which reassigns the task's Type.

**Tech Stack:** Vanilla ES (zero-build static SPA), global `App.*` namespace, Pointer Events, `node --test` unit tests, Playwright/Chromium screenshot harness. CSS in `taskmanagement.css` (theme-aware via `--surface`/`--ink`/`--border` tokens).

## Global Constraints

- **No build step / no framework** — plain browser JS attached to `window.App`; every module is an IIFE that mutates `App`.
- **No DB migration** — reuse `tasks.focus_seq` (nullable float, already exists). Do not alter its semantics elsewhere.
- **Multi-assignee seam** — any "is this mine?" check uses `App.utils.isAssignee(t,id)`, never `t.assignee ===`. (This board relies on upstream `getVisibleTasks()` which already handles it — do not re-filter by `t.assignee`.)
- **Git hygiene (repo rule)** — NEVER `git add -A`/`.`; stage explicit paths only. Commit with `git commit -F <file>` or a heredoc for multi-line messages. Do NOT push unless the user asks.
- **Auto-caps seam** — free-text task fields are upper-cased on save by `updateTaskField`; `type` is a constrained key and is left untouched (relevant to cross-category Type reassignment).
- **Unit test invocation (Windows):** `npm run test:unit` (glob form `node --test "tests/unit/*.test.mjs"`). Run a single file with `node --test tests/unit/<name>.test.mjs`.
- **Screenshot harness gotcha:** launch Chromium by path `C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe`; require `@playwright/test` by absolute path into the project's `node_modules`; force theme with `document.documentElement.setAttribute('data-theme', t)`. A harness MUST mirror the app's `#taskViewWrap` → `#listBody` ID ancestry or the skin CSS won't apply.

---

### Task 1: Pure ordering + grouping helper (`App.sequenceOrder`)

**Files:**
- Create: `js/views/tasklist/sequenceOrder.js`
- Create test: `tests/unit/sequence-order.test.mjs`
- Modify: `app.html` (add `<script defer>` include)

**Interfaces:**
- Produces (consumed by Task 2, 5, 6):
  - `App.sequenceOrder.seqTailCompare(a, b) => number` — fallback comparator (soonest due, then higher priority).
  - `App.sequenceOrder.orderTasks(tasks) => Task[]` — one group's order: `focusSeq`-ranked ascending, then null-seq tasks by `seqTailCompare`.
  - `App.sequenceOrder.sequenceGroups(tasks, { key, order }) => Array<{ key, tasks }>` — bucket into ordered, non-empty groups. `key(task)` defaults to `t => t.type`; `order` is an array of group keys giving desired order (unknown keys appended in first-seen order).
  - `App.sequenceOrder.positionsFor(idsInOrder) => Array<{ id, seq }>` — assign `seq = index + 1` to each id (used to re-sequence a group from DOM order).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sequence-order.test.mjs`:

```javascript
// tests/unit/sequence-order.test.mjs
// Pure ordering/grouping for the Category Sequence Board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/tasklist/sequenceOrder.js');
const S = global.App.sequenceOrder;

const T = (id, over = {}) => ({ id, type: 'invoicing', focusSeq: null, due: null, priority: 'medium', ...over });

test('orderTasks: focusSeq-ranked ascending come before null-seq tail', () => {
  const a = T('a', { focusSeq: 5 });
  const b = T('b', { focusSeq: 1 });
  const c = T('c', { focusSeq: null, due: '2026-08-01', priority: 'high' });
  const d = T('d', { focusSeq: null, due: '2026-07-30', priority: 'low' });
  assert.deepEqual(S.orderTasks([a, b, c, d]).map(t => t.id), ['b', 'a', 'd', 'c']);
});

test('seqTailCompare: soonest due first, then higher priority on a tie', () => {
  const early = T('e', { due: '2026-07-28' });
  const late = T('l', { due: '2026-08-10' });
  assert.ok(S.seqTailCompare(early, late) < 0);
  const hi = T('h', { due: '2026-08-01', priority: 'critical' });
  const lo = T('o', { due: '2026-08-01', priority: 'low' });
  assert.ok(S.seqTailCompare(hi, lo) < 0);
});

test('sequenceGroups: buckets by type in the given order, omits empty groups', () => {
  const tasks = [
    T('a', { type: 'admin' }),
    T('b', { type: 'invoicing' }),
    T('c', { type: 'invoicing', focusSeq: 2 }),
  ];
  const groups = S.sequenceGroups(tasks, { order: ['invoicing', 'admin', 'quotes'] });
  assert.deepEqual(groups.map(g => g.key), ['invoicing', 'admin']); // quotes empty -> omitted
  assert.deepEqual(groups[0].tasks.map(t => t.id), ['c', 'b']); // c has focusSeq, ranks first
});

test('sequenceGroups: unknown group keys are appended after the ordered ones', () => {
  const tasks = [T('a', { type: 'weird' }), T('b', { type: 'admin' })];
  const groups = S.sequenceGroups(tasks, { order: ['admin'] });
  assert.deepEqual(groups.map(g => g.key), ['admin', 'weird']);
});

test('positionsFor: assigns 1-based sequential seq in id order', () => {
  assert.deepEqual(S.positionsFor(['x', 'y', 'z']), [
    { id: 'x', seq: 1 }, { id: 'y', seq: 2 }, { id: 'z', seq: 3 },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/sequence-order.test.mjs`
Expected: FAIL — `Cannot find module '.../sequenceOrder.js'` (file not created yet).

- [ ] **Step 3: Write the module**

Create `js/views/tasklist/sequenceOrder.js`:

```javascript
/* Pure ordering + grouping for the Category Sequence Board. No DOM. Kept
   requireable (attaches to App) so it can be unit-tested in isolation. */
window.App = window.App || {};
(function () {
  'use strict';
  const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  // Fallback order for tasks with no manual position: soonest due, then higher
  // priority. Mirrors the execution-order tail compare.
  function seqTailCompare(a, b) {
    const ad = a.due || '9999-12-31';
    const bd = b.due || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2);
  }

  // One group's display order: manually-positioned tasks (focusSeq set) ranked
  // ascending, then the unpositioned rest by the fallback compare.
  function orderTasks(tasks) {
    const ranked = tasks.filter(t => t.focusSeq != null).sort((a, b) => a.focusSeq - b.focusSeq);
    const tail = tasks.filter(t => t.focusSeq == null).slice().sort(seqTailCompare);
    return ranked.concat(tail);
  }

  // Bucket tasks into ordered, non-empty groups. `key(task)` -> group key
  // (default: task.type). `order` lists the desired group order; unknown keys
  // are appended in first-seen order.
  function sequenceGroups(tasks, { key, order = [] } = {}) {
    const k = key || (t => t.type);
    const buckets = new Map();
    order.forEach(g => buckets.set(g, []));
    tasks.forEach(t => {
      const g = k(t) ?? '';
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(t);
    });
    const out = [];
    buckets.forEach((arr, g) => { if (arr.length) out.push({ key: g, tasks: orderTasks(arr) }); });
    return out;
  }

  // Given an ordered list of ids (final DOM order of a group), the seq value to
  // write for each so the display order persists. 1-based integers per group.
  function positionsFor(idsInOrder) {
    return idsInOrder.map((id, i) => ({ id, seq: i + 1 }));
  }

  App.sequenceOrder = { seqTailCompare, orderTasks, sequenceGroups, positionsFor };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/unit/sequence-order.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the script include**

In `app.html`, after line 312 (`ExecutionLayout.js`), add:

```html
<script defer src="js/views/tasklist/sequenceOrder.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/tasklist/sequenceOrder.js tests/unit/sequence-order.test.mjs app.html
git commit -F - <<'EOF'
feat(sequence): pure ordering/grouping helper for the category sequence board

App.sequenceOrder: orderTasks (focusSeq-ranked then due/priority tail),
sequenceGroups (bucket by type in taxonomy order, omit empties), and
positionsFor (re-sequence a group from DOM order). Unit-tested, no DOM.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `SequenceLayout` render (groups, rows, chevrons, empty state)

**Files:**
- Create: `js/views/tasklist/SequenceLayout.js`
- Modify: `app.html` (add `<script defer>` include)

**Interfaces:**
- Consumes: `App.sequenceOrder.sequenceGroups` (Task 1); `App.TaskListLayouts` registry; `view.body` (`#listBody`), `view.controller`, `view.taskModel`; `App.taxonomy.activeTypes(company)`, `App.taxonomy.statusLabel`, `App.taxonomy.isDone`; `App.PRIORITIES`, `App.utils.formatDue/escapeHtml`; `App.can('tasks.write')`; `view._renderEmpty(...)`.
- Produces (consumed by Task 4, 5): `App.TaskListLayouts.sequence` with `render(view)` / `unmount(view)`; DOM contract — `.seq-group-list[data-cat]` containers whose direct children are `.seq-row[data-id][data-cat]`, each containing `.seq-grip` (drag handle) and `.seq-movers button[data-dir="-1|1"]`.

> **Note on task getter:** use `view.controller.getVisibleTasks()` (same as `ExecutionLayout`). Filter out done/cleared: `!App.taxonomy.isDone(t) && !t.clearedAt`.

- [ ] **Step 1: Write the layout module**

Create `js/views/tasklist/SequenceLayout.js`:

```javascript
/* Category Sequence Board (CONTEXT.md: Layout) — the default list surface.
   One rounded card per category (Task Type); each lists that category's tasks
   in manual order with a 1..n badge. Drag or ▲▼ to reorder inline; drag across
   cards to recategorize. Ordering is App.sequenceOrder; persistence + drag are
   wired in Tasks 4-6. Registered as App.TaskListLayouts.sequence. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  // The visible, active tasks this board sequences (done/cleared excluded).
  function boardTasks(view) {
    return view.controller.getVisibleTasks()
      .filter(t => !App.taxonomy.isDone(t) && !t.clearedAt);
  }

  // Desired category order = the current company's active types, in taxonomy order.
  function typeOrder(view) {
    const company = view.controller.uiState.currentCompany;
    return (App.taxonomy.activeTypes(company) || []).map(t => t.key);
  }

  function typeLabel(view, key) {
    const company = view.controller.uiState.currentCompany;
    const t = (App.taxonomy.activeTypes(company) || []).find(x => x.key === key);
    return (t && t.label) || key || 'Uncategorized';
  }

  function renderRow(view, task, index, canEdit) {
    const priority = App.PRIORITIES[task.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(task.due);
    const row = document.createElement('div');
    row.className = 'seq-row';
    row.dataset.id = task.id;
    row.dataset.cat = task.type;
    row.innerHTML = `
      ${canEdit ? `<button type="button" class="seq-grip" aria-label="Drag to reorder" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></button>` : ''}
      <span class="seq-badge">${index + 1}</span>
      <div class="seq-body">
        <div class="seq-title">${App.utils.escapeHtml(task.title)}</div>
        <div class="seq-meta">
          <span class="seq-pill ${priority.cls}">${App.utils.escapeHtml(priority.label)}</span>
          <span class="due-cell ${due.cls}">${due.text}</span>
        </div>
      </div>
      ${canEdit ? `<div class="seq-movers">
        <button type="button" data-action="seq-move" data-dir="-1" aria-label="Move up"><i class="ti ti-chevron-up"></i></button>
        <button type="button" data-action="seq-move" data-dir="1" aria-label="Move down"><i class="ti ti-chevron-down"></i></button>
      </div>` : ''}`;
    return row;
  }

  function renderGroup(view, group, canEdit) {
    const section = document.createElement('section');
    section.className = 'seq-group';
    section.dataset.cat = group.key;

    const head = document.createElement('div');
    head.className = 'seq-group-head';
    const n = group.tasks.length;
    head.innerHTML =
      `<span class="seq-group-name">${App.utils.escapeHtml(typeLabel(view, group.key))}</span>` +
      `<span class="seq-group-count">${n} task${n === 1 ? '' : 's'}</span>`;
    section.appendChild(head);

    const list = document.createElement('div');
    list.className = 'seq-group-list';
    list.dataset.cat = group.key;
    group.tasks.forEach((t, i) => list.appendChild(renderRow(view, t, i, canEdit)));
    section.appendChild(list);
    return section;
  }

  layouts.sequence = {
    unmount(view) {
      if (view._seqCleanup) { view._seqCleanup(); view._seqCleanup = null; }
    },

    render(view) {
      if (view._seqCleanup) { view._seqCleanup(); view._seqCleanup = null; }
      const canEdit = App.can('tasks.write');
      const tasks = boardTasks(view);
      const groups = App.sequenceOrder.sequenceGroups(tasks, { order: typeOrder(view) });

      view.body.className = 'sequence-board';
      view.body.innerHTML = '';

      // The static column header (table only) has no place on the card board.
      const header = document.querySelector('#taskViewWrap .list-header');
      if (header) header.classList.add('hidden');

      if (!groups.length) {
        view._renderEmpty({
          icon: 'ti-list-numbers',
          title: 'No tasks to sequence',
          sub: 'Tasks assigned here will appear grouped by category so you can order them.',
        });
        return;
      }

      groups.forEach(g => view.body.appendChild(renderGroup(view, g, canEdit)));

      // Drag + chevron wiring is attached in Tasks 4-6 via App.sequenceBoardWire.
      if (App.sequenceBoardWire) view._seqCleanup = App.sequenceBoardWire(view);
    },
  };
})();
```

- [ ] **Step 2: Add the script include**

In `app.html`, after the `sequenceOrder.js` line from Task 1, add:

```html
<script defer src="js/views/tasklist/SequenceLayout.js"></script>
```

- [ ] **Step 3: Sanity-check load (no runtime wiring yet)**

Run: `node -e "global.window={};global.App={TaskListLayouts:{}};require('./js/views/tasklist/SequenceLayout.js');console.log(typeof App.TaskListLayouts.sequence.render)"`
Expected: prints `function` (module registers without throwing).

- [ ] **Step 4: Commit**

```bash
git add js/views/tasklist/SequenceLayout.js app.html
git commit -F - <<'EOF'
feat(sequence): SequenceLayout renders the grouped category board

One card per active Task Type (taxonomy order), each row with grip, 1..n
badge, title, priority pill, due, and ▲▼ movers. Done/cleared excluded;
empty state when nothing to sequence. Drag/chevron wiring lands next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Routing & defaults — make Sequence the default surface

**Files:**
- Modify: `js/controllers/AppController.js` (initial `uiState`: `layout` ~line 36, `groupBy` ~line 46; `setLayout` allowlist ~line 508; route allowlist ~line 447)
- Modify: `js/views/TaskListView.js` (`_layoutKey` ~line 207)
- Modify: `js/views/ToolbarMenuView.js` (View-as list ~line 131; `layoutIcons`/`layoutLabels` ~line 270)

**Interfaces:**
- Consumes: `App.TaskListLayouts.sequence` (Task 2).
- Produces: default `uiState.layout === 'sequence'`, `uiState.groupBy === 'type'`; `'sequence'` accepted by `setLayout` and the hash route; `_layoutKey()` returns `'sequence'` for the default layout; a **Sequence** entry in the View-as menu.

- [ ] **Step 1: Flip the initial uiState defaults**

In `js/controllers/AppController.js`, change:
- `layout: 'table',` → `layout: 'sequence',`
- `groupBy: 'due',` → `groupBy: 'type',`

- [ ] **Step 2: Allow `sequence` in `setLayout`**

In `setLayout(layout)` (~line 508), change the guard:

```javascript
  setLayout(layout) {
    if (!['table', 'calendar', 'kanban', 'cards', 'sequence'].includes(layout)) return;
    this._commit({ layout });
  }
```

- [ ] **Step 3: Allow `sequence` in the hash route**

In the route handler (~line 447), change the fallback list:

```javascript
            this.setLayout(['table', 'calendar', 'kanban', 'cards', 'sequence'].includes(a) ? a : 'sequence');
```

(Also change the trailing `: 'table'` default here to `: 'sequence'` so an unknown layout token lands on the new default.)

- [ ] **Step 4: Route `_layoutKey` to the sequence adapter**

In `js/views/TaskListView.js` `_layoutKey()`, add `'sequence'` to the pass-through list:

```javascript
  _layoutKey() {
    if (this.controller.uiState.view === 'watching') return 'watching';
    const l = this.controller.uiState.layout;
    if (l === 'kanban' || l === 'cards' || l === 'calendar' || l === 'sequence') return l;
    if (this.controller.uiState.sortBy === 'focus') return 'execution';
    return 'table';
  }
```

- [ ] **Step 5: Add Sequence to the View-as menu**

In `js/views/ToolbarMenuView.js`, in the `menuFor === 'view'` branch (~line 131), prepend the Sequence entry:

```javascript
      const layouts = [
        { key: 'sequence', label: 'Sequence', icon: 'ti-list-numbers' },
        { key: 'table',    label: 'Table',    icon: 'ti-table' },
        { key: 'cards',    label: 'Cards',    icon: 'ti-layout-grid' },
        { key: 'calendar', label: 'Calendar', icon: 'ti-calendar' },
        { key: 'kanban',   label: 'Kanban',   icon: 'ti-layout-kanban' },
      ];
```

And in the `viewBtn` label maps (~line 270):

```javascript
      const layoutIcons = { sequence: 'ti-list-numbers', table: 'ti-table', cards: 'ti-layout-grid', calendar: 'ti-calendar', kanban: 'ti-layout-kanban' };
      const layoutLabels = { sequence: 'Sequence', table: 'Table', cards: 'Cards', calendar: 'Calendar', kanban: 'Kanban' };
      const layout = ui.layout || 'sequence';
```

- [ ] **Step 6: Verify existing unit tests still pass**

Run: `npm run test:unit`
Expected: PASS (no regressions; `uistate-policy.test.mjs` in particular still green — it validates `groupBy`/`layout` handling).

- [ ] **Step 7: Commit**

```bash
git add js/controllers/AppController.js js/views/TaskListView.js js/views/ToolbarMenuView.js
git commit -F - <<'EOF'
feat(sequence): default the task list to the category sequence board

New uiState defaults (layout=sequence, groupBy=type); accept 'sequence' in
setLayout + the hash route; _layoutKey dispatches to it; add Sequence to the
View-as menu. Table stays reachable as the fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Board CSS (group cards, rows, badge, pills, movers) — theme-aware

**Files:**
- Modify: `taskmanagement.css` (append a new `/* Category Sequence Board */` block near the `.focus-row` styles, ~line 4936)

**Interfaces:**
- Consumes: the class contract from Task 2 (`.sequence-board`, `.seq-group`, `.seq-group-head`, `.seq-group-name`, `.seq-group-count`, `.seq-group-list`, `.seq-row`, `.seq-grip`, `.seq-badge`, `.seq-body`, `.seq-title`, `.seq-meta`, `.seq-pill`, `.seq-movers`) and existing tokens `--surface`/`--surface-2`/`--ink`/`--ink-2`/`--ink-3`/`--border`/`--line`/`--amber` (defined in both light and dark themes).
- Produces: the mockup's card look; the `.seq-group-list.droptarget` and `.seq-row.dragging` / `.seq-placeholder` styles used by Task 5's drag engine.

- [ ] **Step 1: Append the CSS block**

In `taskmanagement.css`, after the execution-order rules (after line 4936, `.focus-row.exec-unordered:hover { opacity: 1; }`), add:

```css
/* ============================================================
   Category Sequence Board (SequenceLayout) — the default list
   surface: one rounded card per category, rows manually ordered
   with a 1..n badge, drag/▲▼ inline. Theme-aware via tokens.
   ============================================================ */
.sequence-board { display: flex; flex-direction: column; gap: 22px; padding: 8px 0 24px; }

.seq-group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 4px 8px; }
.seq-group-name { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); }
.seq-group-count { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 11px; color: var(--ink-3); }

.seq-group-list { background: var(--surface, #fff); border: 1px solid var(--border, #e2d3bc); border-radius: 12px; overflow: hidden; min-height: 48px; transition: box-shadow .15s; }
.seq-group-list.droptarget { box-shadow: 0 0 0 1.5px var(--amber); }

.seq-row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--line, #e2d3bc); background: var(--surface, #fff); user-select: none; touch-action: none; }
.seq-row:last-child { border-bottom: none; }
.seq-row.dragging { opacity: .35; }

.seq-grip { cursor: grab; background: none; border: 0; color: var(--ink-4, #A59E96); padding: 6px 2px; font-size: 18px; line-height: 0; flex: none; }
.seq-grip:active { cursor: grabbing; }

.seq-badge { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 12px; font-weight: 600; min-width: 26px; height: 26px; border: 1px solid var(--ink); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex: none; color: var(--ink); background: var(--surface, #fff); }

.seq-body { flex: 1 1 auto; min-width: 0; }
.seq-title { font-size: 14px; font-weight: 500; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seq-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.seq-pill { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 10px; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--border, #e2d3bc); color: var(--ink-2, #56504A); }

.seq-movers { display: flex; flex-direction: column; flex: none; }
.seq-movers button { border: none; background: none; color: var(--ink-4, #A59E96); cursor: pointer; padding: 2px 6px; line-height: 0; border-radius: 6px; }
.seq-movers button:hover { color: var(--ink); background: var(--surface-2, #f3f0eb); }
.seq-movers button:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

/* Drag placeholder — a thin insertion line while a row is airborne. */
.seq-placeholder { height: 0; border-top: 2px solid var(--amber); margin: 0 14px; }
.seq-ghost { position: fixed; pointer-events: none; z-index: 100; opacity: .96; box-shadow: var(--shadow-md, 0 10px 30px rgba(0,0,0,.25)); border-radius: 10px; border: 1px solid var(--border, #e2d3bc); background: var(--surface, #fff); }

@media (max-width: 720px) { .seq-row { padding: 12px 14px; } }
```

- [ ] **Step 2: Verify tokens resolve in both themes**

Run the harness measurement from Task 9's script against a stub (or defer full visual check to Task 9). Quick manual check: confirm `--surface`, `--surface-2`, `--line`, `--border`, `--ink*`, `--amber` are all defined under both `body.ui-command-center` (dark, ~line 6184) and `html:not([data-theme="dark"]) body.ui-command-center` (light, ~line 6283) / base `:root` (~line 4998). (They are — `--surface-2`/`--line` were added in commits `a5c9818`.)

- [ ] **Step 3: Commit**

```bash
git add taskmanagement.css
git commit -F - <<'EOF'
feat(sequence): card-board CSS for the category sequence board

Rounded category card, hairline-separated rows, boxed 1..n badge, mono
pills, ▲▼ movers, plus droptarget/dragging/placeholder/ghost states for the
drag engine. Theme-aware via existing surface/ink/border/amber tokens.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Cross-category drag engine + drop persistence

**Files:**
- Create: `js/views/tasklist/sequenceDrag.js` (`App.makeGroupReorderable`)
- Modify: `js/views/tasklist/SequenceLayout.js` (add `App.sequenceBoardWire` that binds drag + persists drops)
- Modify: `app.html` (add `<script defer>` include for `sequenceDrag.js`)

**Interfaces:**
- Consumes: DOM contract from Task 2 (`.seq-group-list[data-cat]` > `.seq-row[data-id]`, handle `.seq-grip`); `App.sequenceOrder.positionsFor`; controller seams `setFocusOrder(id, seq)`, `updateTaskField(id, 'type', newType)`; `view.controller.uiState`; toast via `view.controller.toastView.show({title})`.
- Produces:
  - `App.makeGroupReorderable(board, { groupListSelector, rowSelector, handleSelector, onDrop }) => cleanupFn` — pointer drag with ghost + placeholder that supports moving a row to a **different** group list. Calls `onDrop({ id, fromCat, toCat, orderedIds })` on release, where `orderedIds` is `{ [cat]: string[] }` of the final row order in each affected group list.
  - `App.sequenceBoardWire(view) => cleanupFn` — wires the drag engine (and, after Task 6, the chevron handler) for the board.

- [ ] **Step 1: Write the drag engine**

Create `js/views/tasklist/sequenceDrag.js` (ported from the boss's mockup pointer-drag; supports cross-list drops):

```javascript
/* Pointer drag-to-reorder ACROSS groups for the Category Sequence Board.
   Unlike App.makeReorderable (single container), this tracks a ghost element
   and reparents a row into whichever .seq-group-list the pointer is over, then
   reports the final order of every affected list. Mouse + touch (Pointer
   Events). Ported from the boss's approved mockup. */
window.App = window.App || {};
App.makeGroupReorderable = function (board, opts) {
  const { groupListSelector, rowSelector, handleSelector, onDrop } = opts || {};
  let drag = null;

  function lists() { return Array.from(board.querySelectorAll(groupListSelector)); }
  function rowsIn(list) { return Array.from(list.querySelectorAll(rowSelector)); }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const row = handle.closest(rowSelector);
    if (!row) return;
    e.preventDefault();

    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('seq-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    const ph = document.createElement('div');
    ph.className = 'seq-placeholder';

    drag = {
      row, ghost, ph,
      id: row.dataset.id,
      fromCat: row.dataset.cat,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    row.classList.add('dragging');
    position(e);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }

  function position(e) {
    drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    position(e);
    lists().forEach(l => l.classList.remove('droptarget'));
    drag.ph.remove();

    const target = lists().find(l => {
      const r = l.getBoundingClientRect();
      return e.clientY >= r.top - 14 && e.clientY <= r.bottom + 14;
    });
    if (!target) { drag.over = null; return; }
    target.classList.add('droptarget');

    const siblings = rowsIn(target).filter(r => r.dataset.id !== drag.id);
    let before = null;
    for (const r of siblings) {
      const rect = r.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { before = r; break; }
    }
    if (before) target.insertBefore(drag.ph, before);
    else target.appendChild(drag.ph);
    drag.over = target;
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    if (!drag) return;
    const { id, fromCat, over, ghost, ph, row } = drag;
    row.classList.remove('dragging');
    ghost.remove();

    let toCat = fromCat;
    if (over) {
      toCat = over.dataset.cat;
      over.insertBefore(row, ph); // land the real row where the placeholder is
    }
    ph.remove();
    lists().forEach(l => l.classList.remove('droptarget'));

    // Collect the final order of the affected lists from the live DOM.
    const orderedIds = {};
    const affected = new Set([fromCat, toCat]);
    lists().forEach(l => {
      if (affected.has(l.dataset.cat)) orderedIds[l.dataset.cat] = rowsIn(l).map(r => r.dataset.id);
    });

    const payload = { id, fromCat, toCat, orderedIds };
    drag = null;
    if (typeof onDrop === 'function') onDrop(payload);
  }

  board.addEventListener('pointerdown', onDown);
  return function cleanup() {
    board.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    if (drag) { drag.ghost.remove(); drag.ph.remove(); drag = null; }
  };
};
```

- [ ] **Step 2: Add the wiring function to SequenceLayout**

In `js/views/tasklist/SequenceLayout.js`, inside the IIFE (before the `layouts.sequence = {` block), add:

```javascript
  // Persist a drop: reassign type if it moved categories, then re-sequence the
  // affected group(s) from their final DOM order (1..n) so the display sticks.
  function persistDrop(view, { id, fromCat, toCat, orderedIds }) {
    if (toCat !== fromCat) {
      view.controller.updateTaskField(id, 'type', toCat);
      if (view.controller.toastView) {
        const pos = (orderedIds[toCat] || []).indexOf(id) + 1;
        const label = typeLabel(view, toCat);
        view.controller.toastView.show({ title: `Moved to ${label} — position ${pos}` });
      }
    }
    Object.keys(orderedIds).forEach(cat => {
      App.sequenceOrder.positionsFor(orderedIds[cat])
        .forEach(({ id: rid, seq }) => view.controller.setFocusOrder(rid, seq));
    });
  }

  // Bind drag (and chevrons, added in Task 6) for the current board render.
  App.sequenceBoardWire = function (view) {
    let dragCleanup = null;
    if (App.can('tasks.write') && App.makeGroupReorderable) {
      dragCleanup = App.makeGroupReorderable(view.body, {
        groupListSelector: '.seq-group-list',
        rowSelector: '.seq-row',
        handleSelector: '.seq-grip',
        onDrop: (payload) => persistDrop(view, payload),
      });
    }
    return function cleanup() { if (dragCleanup) dragCleanup(); };
  };
```

> The `layouts.sequence.render` already calls `App.sequenceBoardWire(view)` (Task 2, Step 1). No change needed there.

- [ ] **Step 3: Add the script include**

In `app.html`, after the `SequenceLayout.js` line, add (drag engine must load before or with the layout; both are `defer` so order within the block is fine, but place it just before `SequenceLayout.js` for clarity):

```html
<script defer src="js/views/tasklist/sequenceDrag.js"></script>
```

- [ ] **Step 4: Sanity-check load**

Run: `node -e "global.window={};global.App={};require('./js/views/tasklist/sequenceDrag.js');console.log(typeof App.makeGroupReorderable)"`
Expected: prints `function`.

- [ ] **Step 5: Manual QA (browser)**

Open the app (default view = sequence board). Drag a row within a category → order persists after reload. Drag a row into another category card → it moves there, its Type changes, a toast shows "Moved to <Category> — position N", and both cards renumber. (No automated DOM test — verified here + in Task 9's screenshot.)

- [ ] **Step 6: Commit**

```bash
git add js/views/tasklist/sequenceDrag.js js/views/tasklist/SequenceLayout.js app.html
git commit -F - <<'EOF'
feat(sequence): cross-category drag + drop persistence

App.makeGroupReorderable: ghost+placeholder pointer drag that reparents a
row across .seq-group-lists (ported from the boss's mockup). On drop, reassign
Type if the category changed (toast) and re-sequence affected groups 1..n via
setFocusOrder. Auto-saves through the existing controller seams.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Chevron ▲▼ move (touch-friendly reorder)

**Files:**
- Modify: `js/views/tasklist/SequenceLayout.js` (add a delegated click handler in `App.sequenceBoardWire`)

**Interfaces:**
- Consumes: DOM contract (`.seq-row[data-id][data-cat]`, `button[data-action="seq-move"][data-dir]`); `App.sequenceOrder.positionsFor`; `setFocusOrder`.
- Produces: clicking ▲/▼ swaps a row with its neighbor within the same category and persists the new 1..n order.

- [ ] **Step 1: Add the chevron handler to `App.sequenceBoardWire`**

In `js/views/tasklist/SequenceLayout.js`, extend `App.sequenceBoardWire` to also bind a delegated click handler:

```javascript
  App.sequenceBoardWire = function (view) {
    let dragCleanup = null;
    if (App.can('tasks.write') && App.makeGroupReorderable) {
      dragCleanup = App.makeGroupReorderable(view.body, {
        groupListSelector: '.seq-group-list',
        rowSelector: '.seq-row',
        handleSelector: '.seq-grip',
        onDrop: (payload) => persistDrop(view, payload),
      });
    }

    function onClick(e) {
      const btn = e.target.closest('[data-action="seq-move"]');
      if (!btn || !App.can('tasks.write')) return;
      const row = btn.closest('.seq-row');
      const list = row && row.closest('.seq-group-list');
      if (!list) return;
      const dir = parseInt(btn.dataset.dir, 10);
      const ids = Array.from(list.querySelectorAll('.seq-row')).map(r => r.dataset.id);
      const idx = ids.indexOf(row.dataset.id);
      const target = idx + dir;
      if (target < 0 || target >= ids.length) return;
      [ids[idx], ids[target]] = [ids[target], ids[idx]]; // swap
      App.sequenceOrder.positionsFor(ids)
        .forEach(({ id, seq }) => view.controller.setFocusOrder(id, seq));
    }
    view.body.addEventListener('click', onClick);

    return function cleanup() {
      if (dragCleanup) dragCleanup();
      view.body.removeEventListener('click', onClick);
    };
  };
```

- [ ] **Step 2: Manual QA (browser)**

In a category with 3+ tasks, click ▼ on row 1 → it swaps to position 2 and the badges renumber; reload confirms it stuck. ▲ on the top row and ▼ on the bottom row are no-ops.

- [ ] **Step 3: Commit**

```bash
git add js/views/tasklist/SequenceLayout.js
git commit -F - <<'EOF'
feat(sequence): ▲▼ chevron reorder within a category

Delegated click handler swaps a row with its neighbor and re-sequences the
group 1..n via setFocusOrder — a touch-friendly alternative to dragging.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Remove the FocusWidget strip

**Files:**
- Modify: `js/app.js` (remove the `FocusWidgetView` instantiation, ~line 207)
- Modify: `app.html` (remove the `#focusWidget` mount slot, line 169)

**Interfaces:**
- Consumes: nothing new.
- Produces: the "FOCUS — Showing execution order" page-head strip no longer renders. `#upNextWidget` and `#progressWidget` are untouched.

> Do NOT delete `js/views/FocusWidgetView.js` or the `App.makeReorderable` engine — the flat execution layout still uses them and may be reintroduced. This task only removes the mount.

- [ ] **Step 1: Remove the mount in `js/app.js`**

Delete the line (~207):

```javascript
  new App.FocusWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
```

Leave the `ProgressWidgetView` (line 205) and `UpNextWidgetView` (line 206) lines in place.

- [ ] **Step 2: Remove the slot in `app.html`**

Delete line 169:

```html
          <div class="focus-widget-mount" id="focusWidget"></div>
```

Leave `#upNextWidget` (168) and `#progressWidget` (170).

- [ ] **Step 3: Verify no dangling references break boot**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('js/app.js','utf8');if(/new App\.FocusWidgetView/.test(s))throw new Error('FocusWidgetView mount still present');console.log('ok')"`
Expected: prints `ok`.

Also grep to confirm nothing else instantiates it:
Run: `grep -rn "new App.FocusWidgetView" js/` → Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add js/app.js app.html
git commit -F - <<'EOF'
feat(sequence): remove the FocusWidget "execution order" page-head strip

Inline drag on the sequence board replaces the strip's purpose. Keeps
Up-next + Today's-progress widgets and the FocusWidgetView source (flat
execution layout still references it).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: "Save order" reassurance button + toast

**Files:**
- Modify: `js/views/tasklist/SequenceLayout.js` (render a Save button in the board head; flush + toast on click)
- Modify: `taskmanagement.css` (`.seq-savebar` style — append to the Task 4 block)

**Interfaces:**
- Consumes: `view.controller.persistNow` if it exists, else the debounced save already fired by `setFocusOrder`; `view.controller.toastView.show`.
- Produces: a `.seq-savebar` with a "Save order" button at the top of the board; clicking flushes any pending write and toasts "Order saved". It is reassurance only — order already persists on each drag/chevron.

> **Verify the flush seam during implementation:** search the controller/persistence engine for an explicit flush (`grep -n "saveNow\|flush\|persistNow\|_flush" js/controllers/AppController.js js/services/*.js`). If one exists, call it; if not, the button simply toasts (writes are already in flight). Do NOT invent a new persistence path.

- [ ] **Step 1: Render the Save button**

In `js/views/tasklist/SequenceLayout.js` `render(view)`, after `view.body.innerHTML = '';` and before the empty-state check, insert a save bar:

```javascript
      const savebar = document.createElement('div');
      savebar.className = 'seq-savebar';
      savebar.innerHTML = `<button type="button" class="btn btn-primary" data-action="seq-save">Save order</button>`;
      view.body.appendChild(savebar);
```

(The empty-state early-return still works — the save bar is harmless above an empty board, but to keep it clean, only append the save bar when `groups.length` is truthy: move this block to just before the `groups.forEach(...)` line instead.)

- [ ] **Step 2: Handle the Save click in `App.sequenceBoardWire`**

Extend the `onClick` handler (Task 6) to also catch the save button:

```javascript
      const save = e.target.closest('[data-action="seq-save"]');
      if (save) {
        if (view.controller.persistNow) view.controller.persistNow(); // flush if the seam exists
        if (view.controller.toastView) view.controller.toastView.show({ title: 'Order saved' });
        return;
      }
```

(Place this at the top of `onClick`, before the `seq-move` lookup.)

- [ ] **Step 3: Add the save bar CSS**

Append to the Task 4 CSS block in `taskmanagement.css`:

```css
.seq-savebar { display: flex; justify-content: flex-end; padding: 0 4px 2px; }
.seq-savebar .btn-primary { font-size: 13px; padding: 8px 18px; }
```

- [ ] **Step 4: Manual QA**

Reorder something, click "Save order" → "Order saved" toast appears; reload confirms the order (which was already saved) is intact.

- [ ] **Step 5: Commit**

```bash
git add js/views/tasklist/SequenceLayout.js taskmanagement.css
git commit -F - <<'EOF'
feat(sequence): "Save order" reassurance button + toast

Order already auto-saves on each drag/chevron; the button flushes any pending
write (if the controller exposes a flush seam) and confirms with a toast. Not
a gate. Lives in the board head, not a fixed bottom bar (mobile-nav collision).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Screenshot harness + full verification

**Files:**
- Create: `sequence-preview.html` (committed harness, mirrors `#taskViewWrap` → `#listBody` ancestry)
- (No source changes — this task verifies Tasks 1-8.)

**Interfaces:**
- Consumes: `taskmanagement.css`, `js/views/tasklist/sequenceOrder.js` (for realistic ordering) or static markup mirroring `SequenceLayout` output.
- Produces: PNG renders proving the board looks right in light + dark + mobile, and evidence the Table view is unchanged.

- [ ] **Step 1: Create the harness**

Create `sequence-preview.html` — a static page whose DOM mirrors `SequenceLayout`'s output inside the real ID ancestry (`body.ui-command-center` → `#taskViewWrap` → `#listBody.sequence-board`), linking the real stylesheet. Include at least two category cards with 3-4 rows each (grip, badge, title, pill, due, movers), matching the class contract from Task 2. (Model the markup on the mockup + `renderRow`.)

- [ ] **Step 2: Render light + dark + mobile**

Use a Playwright script (pattern from the screenshot-harness memory: Chromium at `chromium-1223`, `@playwright/test` required by absolute path, force theme via `data-theme`). Capture:
- `seq-light.png` (1280×800, light)
- `seq-dark.png` (1280×800, dark)
- `seq-mobile.png` (390×800, dark)

Assert in the eval: the first `.seq-title` has a non-transparent color with strong contrast against its `.seq-row` background in BOTH themes (regression guard for the invisible-title class of bug), and the board's left edge aligns with the header gutter at ≥1366px (reuse the Task's measurement approach).

- [ ] **Step 3: Confirm the Table view is unchanged**

Render the existing `docs/tasks-board.html` (or the app with `layout=table`) and eyeball that the dense Table skin is visually identical to before this feature. (No pixel diff tooling required — a visual check that qt-skin still renders.)

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — including the new `sequence-order.test.mjs` (5 tests) and all pre-existing tests (no regressions).

- [ ] **Step 5: Commit the harness**

```bash
git add sequence-preview.html
git commit -F - <<'EOF'
test(sequence): committed screenshot harness for the category board

Mirrors the app's #taskViewWrap > #listBody ancestry so a render == the real
view. Verifies card look + legible titles in light/dark/mobile.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage:**
- Reuse `focus_seq`, no migration → Tasks 1, 5 (persistence via `setFocusOrder`). ✓
- Group by category (Type), taxonomy order, per-group 1..n → Tasks 1, 2. ✓
- Drag within group + across groups (reassign Type) + toast → Task 5. ✓
- ▲▼ chevron fallback → Task 6. ✓
- Auto-save + reassurance Save button (not a fixed bottom bar) → Tasks 5, 8. ✓
- Card board becomes default; Table stays via View-as → Task 3. ✓
- New `SequenceLayout` + card CSS reusing fixed `.focus-row`/token styles → Tasks 2, 4. ✓
- Remove `FocusWidgetView` mount only; keep Up-next + Progress → Task 7. ✓
- Populated groups only; empty state; canEdit gating; multi-assignee via upstream getter → Task 2. ✓
- Testing: unit (ordering), screenshot harness mirroring ID ancestry, manual QA → Tasks 1, 5, 6, 8, 9. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The two "verify during implementation" notes (Task 8 flush seam; Task 5 toast seam) are explicit grep-first instructions with a defined fallback, not open placeholders. ✓

**Type consistency:**
- `App.sequenceOrder.{seqTailCompare, orderTasks, sequenceGroups, positionsFor}` — defined Task 1, consumed Tasks 2/5/6 with matching signatures. ✓
- `App.makeGroupReorderable(board, {groupListSelector,rowSelector,handleSelector,onDrop})` → `onDrop({id,fromCat,toCat,orderedIds})` — defined Task 5, consumed same task. ✓
- `App.sequenceBoardWire(view)` — created Task 5, extended Tasks 6/8, called from `render` (Task 2). ✓
- DOM class contract (`.seq-group-list[data-cat]` > `.seq-row[data-id][data-cat]`, `.seq-grip`, `[data-action="seq-move"]`, `[data-action="seq-save"]`) — produced Task 2/8, consumed Tasks 4/5/6/8. ✓
- Controller seams `setFocusOrder(id, seq)` / `updateTaskField(id,'type',v)` — real, verified in the codebase. ✓
