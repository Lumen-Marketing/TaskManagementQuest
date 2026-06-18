# Focus List (Execution Order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person pick tasks into a persistent "Focus" list and drag them into the order they should be done (#1, #2, #3…), shown as a Focus view/tab and a compact Focus widget.

**Architecture:** A single nullable `focus_seq REAL` column on `tasks` carries both membership (non-null = in Focus) and order (the value is a float sort-key). Each task belongs to exactly one person's Focus list via its `assignee_id`. The `#N` badge is the row's position, computed at render — stored values never renumber. Drag computes a midpoint between neighbors so each reorder dirties only the moved task, riding the existing 350 ms debounced/optimistic save.

**Tech Stack:** Vanilla JS (zero-build static SPA), `window.App` namespace, EventBus pub/sub, Supabase (Postgres + RLS), CSS in `taskmanagement.css`, Playwright (preview mode) for E2E.

## Global Constraints

- Zero build step — plain `<script>` files attaching to `window.App`; no framework, no bundler, no new npm deps.
- CSS lives in `taskmanagement.css`; mobile breakpoint is `≤720px` (`@media (max-width: 720px)`).
- Mobile-friendliness is the top priority — drag must work with touch (Pointer Events), and the Focus widget must not overflow on phones.
- Feature name in the UI is **"Focus"** (view key `focus`). Do NOT reuse the existing `today` view (that means "due today").
- New JS files must be added to `app.html` in the correct load-order section (Views, before Controllers).
- Permission gate: only the task's assignee OR a manager (`tasks.write` AND able to see the person, i.e. not a plain worker editing someone else's) may change focus order; mirror existing `App.can('tasks.write')` checks.
- All user-facing strings escaped via `App.utils.escapeHtml`.

---

### Task 1: Database migration for `focus_seq`

**Files:**
- Create: `supabase/sql/050_add_task_focus_seq.sql`

**Interfaces:**
- Produces: a nullable `focus_seq` column of type `real` on `public.tasks`.

- [ ] **Step 1: Write the migration**

```sql
-- 050_add_task_focus_seq.sql
-- Focus list / execution order. A task's focus_seq is a float sort-key for the
-- assignee's curated "Focus" queue: NULL = not in Focus; non-null = in Focus at
-- that position. Reorders set a midpoint value so only the moved row changes.
-- Scoped per person implicitly via assignee_id (each task is in one queue).
alter table public.tasks
  add column if not exists focus_seq real;

comment on column public.tasks.focus_seq is
  'Execution-order sort key for the assignee''s Focus list. NULL = not in Focus.';
```

- [ ] **Step 2: Apply it to Supabase**

This project applies migrations manually in the Supabase SQL editor (see project memory). Paste the file's contents and run it. Verify with:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'tasks' and column_name = 'focus_seq';
```
Expected: one row, `focus_seq | real`.

- [ ] **Step 3: Commit**

```bash
git add "supabase/sql/050_add_task_focus_seq.sql"
git commit -m "feat(db): add tasks.focus_seq for Focus list execution order"
```

---

### Task 2: Map `focus_seq` through the data store

**Files:**
- Modify: `js/services/SupabaseDataStore.js` — `_mapTaskRow` (~line 428) and `_taskRow` (~line 172)

**Interfaces:**
- Consumes: `tasks.focus_seq` column (Task 1).
- Produces: in-memory task objects carry `focusSeq` (number | null); saved rows write `focus_seq`.

- [ ] **Step 1: Read `focus_seq` on load** — in `_mapTaskRow`, add `focusSeq` to the returned object (after `clearedAt`):

```javascript
      clearedAt: row.cleared_at || null,
      // Focus list (execution order) sort-key. null = not in the assignee's Focus.
      focusSeq: (row.focus_seq === null || row.focus_seq === undefined) ? null : Number(row.focus_seq),
    };
```

- [ ] **Step 2: Write `focus_seq` on save** — in `_taskRow`, add (after `cleared_at`):

```javascript
      cleared_at: task.clearedAt || null,
      focus_seq: (task.focusSeq === null || task.focusSeq === undefined) ? null : task.focusSeq,
    };
```

- [ ] **Step 3: Sanity-check in the browser console (preview mode)**

Run the app at `app.html?preview=1`. In the console:
```javascript
App.taskModel.all()[0].focusSeq
```
Expected: `null` (seed tasks have no focus_seq). No errors on load/save.

- [ ] **Step 4: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -m "feat(focus): map focus_seq <-> focusSeq in data store"
```

---

### Task 3: TaskModel — focus queries, mutations, and sort comparator

**Files:**
- Modify: `js/models/TaskModel.js` — add `focus` branch to `_comparator` (~line 257), add a `focusList()` query (near other queries ~line 94), add mutation methods (in the mutations section ~line 294)
- Test: `tests/focus-model.spec.js` (Playwright, preview mode — exercises the model via the page context)

**Interfaces:**
- Consumes: `task.focusSeq` (Task 2), `task.assignee`, `task.status`, `task.clearedAt`.
- Produces:
  - `taskModel.focusList(userId)` → array of that user's active (`status !== 'done'`, `!clearedAt`) tasks with non-null `focusSeq`, ascending by `focusSeq`.
  - `taskModel.addToFocus(id)` → sets `focusSeq` to `(max focusSeq among that assignee's focus tasks) + 1` (or `0` if none); marks dirty; emits `tasks:changed`.
  - `taskModel.removeFromFocus(id)` → sets `focusSeq = null`; marks dirty; emits.
  - `taskModel.setFocusOrder(id, newSeq)` → sets `focusSeq = newSeq`; marks dirty; emits.
  - `_comparator('focus', dir)` orders non-null `focusSeq` ascending, nulls last.

- [ ] **Step 1: Write failing tests**

Create `tests/focus-model.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

// Drives the in-memory TaskModel through the preview build (no DB needed).
test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.taskModel);
});

test('addToFocus appends with increasing focusSeq, focusList returns ordered active tasks', async ({ page }) => {
  const result = await page.evaluate(() => {
    const m = window.App.taskModel;
    // kristine's tasks: t2, t13(done), t15 (from seedDefaults)
    m.addToFocus('t15');
    m.addToFocus('t2');
    const first = m.find('t15').focusSeq;
    const second = m.find('t2').focusSeq;
    const list = m.focusList('kristine').map(t => t.id);
    return { first, second, list };
  });
  expect(result.second).toBeGreaterThan(result.first);
  // done task (t13) never appears even if it had a seq; order is t15 then t2
  expect(result.list).toEqual(['t15', 't2']);
});

test('removeFromFocus drops the task; setFocusOrder reorders', async ({ page }) => {
  const result = await page.evaluate(() => {
    const m = window.App.taskModel;
    m.addToFocus('t15');
    m.addToFocus('t2');
    m.removeFromFocus('t15');
    const afterRemove = m.focusList('kristine').map(t => t.id);
    // Move t15 back in, before t2, via a midpoint below t2's seq.
    const t2seq = m.find('t2').focusSeq;
    m.setFocusOrder('t15', t2seq - 1);
    const afterReorder = m.focusList('kristine').map(t => t.id);
    return { afterRemove, afterReorder };
  });
  expect(result.afterRemove).toEqual(['t2']);
  expect(result.afterReorder).toEqual(['t15', 't2']);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx playwright test tests/focus-model.spec.js`
Expected: FAIL — `m.addToFocus is not a function`.

- [ ] **Step 3: Add the query method** — in `js/models/TaskModel.js`, after `byAssignee` (line 94):

```javascript
  byAssignee(userId) { return this.tasks.filter(t => t.assignee === userId); }

  /* The assignee's curated Focus list: active (not done, not soft-cleared)
     tasks with a focus position, ordered by that position. The #N badge a user
     sees is the index in THIS array, not the stored focusSeq. */
  focusList(userId) {
    return this.tasks
      .filter(t => t.assignee === userId && t.focusSeq != null && t.status !== 'done' && !t.clearedAt)
      .sort((a, b) => a.focusSeq - b.focusSeq);
  }
```

- [ ] **Step 4: Add the mutation methods** — in the mutations section, after `setField` (line 377):

```javascript
  /* ---------- Focus list (execution order) ---------- */
  // Add a task to its assignee's Focus list at the bottom. focusSeq is a float
  // sort-key; appending = one past the current max so existing order is kept.
  addToFocus(id) {
    const t = this.find(id);
    if (!t) return;
    const peers = this.tasks.filter(x => x.assignee === t.assignee && x.focusSeq != null && x.id !== id);
    const max = peers.reduce((m, x) => Math.max(m, x.focusSeq), -Infinity);
    t.focusSeq = (max === -Infinity) ? 0 : max + 1;
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }

  removeFromFocus(id) {
    const t = this.find(id);
    if (!t || t.focusSeq == null) return;
    t.focusSeq = null;
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }

  // Set an explicit float position (drag-to-reorder computes a midpoint).
  setFocusOrder(id, newSeq) {
    const t = this.find(id);
    if (!t) return;
    t.focusSeq = newSeq;
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }
```

- [ ] **Step 5: Add the comparator branch** — in `_comparator`, add a `focus` case. Replace the `created` line block (lines 264-266):

```javascript
      else if (sortBy === 'created')  c = (a.id || '').localeCompare(b.id || '');
      else if (sortBy === 'focus') {
        // Nulls (not in Focus) sort last; otherwise ascending by focusSeq.
        const av = a.focusSeq == null ? Infinity : a.focusSeq;
        const bv = b.focusSeq == null ? Infinity : b.focusSeq;
        c = av - bv;
      }
      // Stable tiebreaker by due
      if (c === 0) c = dueKey(a).localeCompare(dueKey(b));
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `npx playwright test tests/focus-model.spec.js`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add js/models/TaskModel.js tests/focus-model.spec.js
git commit -m "feat(focus): TaskModel focus list queries, mutations, comparator"
```

---

### Task 4: AppController — focus commands, permissions, view, reassign reset

**Files:**
- Modify: `js/controllers/AppController.js` — `canView` (~line 60), `applyHeader` is in the view (skip), add focus commands near bulk section (~line 619), reset on `reassignTask` (~line 847), add `focus` to `_persistUiState` restore allowlist is automatic (string view), add `setSortBy` allow `focus` (it gates on `App.SORT_OPTIONS` — see Task 6 which registers it).

**Interfaces:**
- Consumes: `taskModel.addToFocus/removeFromFocus/setFocusOrder/focusList` (Task 3).
- Produces:
  - `controller.canSetFocusFor(task)` → boolean (assignee themselves, or a manager with `tasks.write` who is not a plain worker acting on someone else's task).
  - `controller.addToFocus(ids)` → adds each permitted id; toasts a summary; exits bulk mode if it was on.
  - `controller.removeFromFocus(id)`, `controller.setFocusOrder(id, newSeq)` → permission-checked pass-throughs.
  - `controller.focusOwnerId()` → the member id whose Focus list the current view shows (the `person:<id>` target, else the current user).
  - `canView('focus')` → true when `App.can('tasks.view')`.

- [ ] **Step 1: Allow the focus view** — in `canView`, before the final `return` (line 67):

```javascript
    if (view === 'time:resource') return App.can('time.team');
    if (view === 'focus') return App.can('tasks.view');
    return App.can('tasks.view');
```

- [ ] **Step 2: Add focus commands + permission helper** — after `toggleBulkSelect` / before `bulkSelectAllVisible` is fine, but to keep focus logic together add a new section after `bulkDelete` (after line 733):

```javascript
  /* ---------- Focus list (execution order) ---------- */
  // Which person's Focus list the current surface targets: an explicit
  // person:<id> view shows that person's; everything else shows the viewer's.
  focusOwnerId() {
    const v = this.uiState.view;
    if (v.startsWith('person:')) return v.split(':')[1];
    return this.currentUser;
  }

  // A task's focus order may be changed by its assignee, or by a manager who can
  // write tasks and isn't a plain worker reaching onto someone else's task.
  canSetFocusFor(task) {
    if (!task || !App.can('tasks.write')) return false;
    if (task.assignee === this.currentUser) return true;
    return App.effectiveRole() !== 'worker';
  }

  addToFocus(ids) {
    if (!App.can('tasks.write')) return;
    const list = (Array.isArray(ids) ? ids : [ids]);
    const added = list.filter(id => {
      const t = this.taskModel.find(id);
      if (!t || !this.canSetFocusFor(t) || t.focusSeq != null) return false;
      this.taskModel.addToFocus(id);
      return true;
    });
    if (this.toastView && added.length) {
      this.toastView.show({ title: `Added ${added.length} to Focus`, sub: 'Open Focus to set the order.' });
    }
    if (this.uiState.bulkMode) this.exitBulkMode();
  }

  removeFromFocus(id) {
    const t = this.taskModel.find(id);
    if (!t || !this.canSetFocusFor(t)) return;
    this.taskModel.removeFromFocus(id);
  }

  setFocusOrder(id, newSeq) {
    const t = this.taskModel.find(id);
    if (!t || !this.canSetFocusFor(t)) return;
    this.taskModel.setFocusOrder(id, newSeq);
  }
```

- [ ] **Step 3: Reset focus_seq on reassign** — a reassigned task should leave the old person's Focus. In `reassignTask`, right after the successful `reassign` result (after line 850 `if (!result) return;`):

```javascript
    if (!result) return;
    // Reassigned tasks leave the previous person's Focus list (their queue
    // position is meaningless for the new assignee). They can re-add it.
    if (this.taskModel.find(id).focusSeq != null) this.taskModel.removeFromFocus(id);
```

- [ ] **Step 4: Manual check (preview)** — at `app.html?preview=1&role=admin&member=abraham`, console:

```javascript
App.controller.addToFocus(['t6','t7']); App.taskModel.focusList('abraham').map(t=>t.id)
```
Expected: `['t6','t7']` (both are abraham's). No errors.

- [ ] **Step 5: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "feat(focus): controller focus commands, permissions, reassign reset"
```

---

### Task 5: Shared drag-to-reorder helper (mouse + touch)

**Files:**
- Create: `js/views/dragOrder.js`
- Modify: `app.html` — add `<script src="js/views/dragOrder.js"></script>` in the Views block (e.g. right after `BulkActionsView.js`, line 225)
- Test: `tests/focus-dragorder.spec.js`

**Interfaces:**
- Produces: `App.makeReorderable(container, { onDrop })` where `container` holds direct child rows each with `data-id`. `onDrop(movedId, newIndex)` fires after a drag settles, `newIndex` being the row's target index among siblings (0-based). Uses Pointer Events so it works for mouse and touch. Adds class `dragging` to the active row and `drag-over` is not needed (we reorder the DOM live). Returns a cleanup function.

- [ ] **Step 1: Write a failing test**

Create `tests/focus-dragorder.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test('makeReorderable reports the new index after a pointer drag', async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.makeReorderable);

  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'dragTest';
    box.style.cssText = 'position:fixed;top:0;left:0;width:200px;z-index:99999;background:#fff';
    ['a', 'b', 'c'].forEach((id, i) => {
      const r = document.createElement('div');
      r.dataset.id = id;
      r.textContent = id;
      r.style.cssText = 'height:40px;line-height:40px;';
      box.appendChild(r);
    });
    document.body.appendChild(box);
    window.__dropResult = null;
    window.App.makeReorderable(box, { onDrop: (movedId, newIndex) => { window.__dropResult = { movedId, newIndex }; } });
  });

  // Drag row "a" (top) down past "b" and "c".
  const a = page.locator('#dragTest [data-id="a"]');
  const ab = await a.boundingBox();
  await page.mouse.move(ab.x + 10, ab.y + 20);
  await page.mouse.down();
  await page.mouse.move(ab.x + 10, ab.y + 130, { steps: 8 });
  await page.mouse.up();

  const result = await page.evaluate(() => window.__dropResult);
  expect(result.movedId).toBe('a');
  expect(result.newIndex).toBe(2);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx playwright test tests/focus-dragorder.spec.js`
Expected: FAIL — `window.App.makeReorderable` never becomes defined (timeout).

- [ ] **Step 3: Implement the helper**

Create `js/views/dragOrder.js`:

```javascript
window.App = window.App || {};

/* Pointer-based vertical drag-to-reorder for a list of rows. Works for mouse
   AND touch (Pointer Events), so it's phone-friendly. The caller passes a
   container whose direct children each carry data-id; while dragging we move the
   dragged row among its siblings live, and on release call
   onDrop(movedId, newIndex). Keep rows as direct children (no wrappers). */
App.makeReorderable = function makeReorderable(container, { onDrop, handleSelector } = {}) {
  let dragEl = null;       // the row being dragged
  let startY = 0;          // pointer Y at drag start
  let pointerId = null;

  const rows = () => Array.from(container.children).filter(el => el.dataset && el.dataset.id != null);

  const onPointerDown = (e) => {
    // Primary button / single touch only. Respect an optional drag handle.
    if (e.button != null && e.button !== 0) return;
    const row = e.target.closest('[data-id]');
    if (!row || row.parentElement !== container) return;
    if (handleSelector && !e.target.closest(handleSelector)) return;
    dragEl = row;
    pointerId = e.pointerId;
    startY = e.clientY;
    row.classList.add('dragging');
    // Capture so we keep getting moves even if the pointer leaves the row.
    try { row.setPointerCapture(pointerId); } catch (_) {}
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragEl || e.pointerId !== pointerId) return;
    e.preventDefault();
    const y = e.clientY;
    // Find the sibling whose vertical midpoint the pointer has crossed and
    // insert the dragged row before/after it.
    const siblings = rows().filter(r => r !== dragEl);
    let placed = false;
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (y < mid) { container.insertBefore(dragEl, sib); placed = true; break; }
    }
    if (!placed) container.appendChild(dragEl);
  };

  const finish = (e) => {
    if (!dragEl || (e && e.pointerId !== pointerId)) return;
    const moved = dragEl;
    moved.classList.remove('dragging');
    try { moved.releasePointerCapture(pointerId); } catch (_) {}
    const newIndex = rows().indexOf(moved);
    dragEl = null;
    pointerId = null;
    if (typeof onDrop === 'function') onDrop(moved.dataset.id, newIndex);
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);

  return function cleanup() {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', finish);
    container.removeEventListener('pointercancel', finish);
  };
};
```

- [ ] **Step 4: Add the script tag** — in `app.html`, after line 225 (`BulkActionsView.js`):

```html
<script src="js/views/BulkActionsView.js"></script>
<script src="js/views/dragOrder.js"></script>
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx playwright test tests/focus-dragorder.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/views/dragOrder.js app.html tests/focus-dragorder.spec.js
git commit -m "feat(focus): pointer-based drag-to-reorder helper"
```

---

### Task 6: Register the Focus sort option + Focus view header

**Files:**
- Modify: `js/constants.js` — add `focus` to `App.SORT_OPTIONS` (~line 67)
- Modify: `js/views/TaskListView.js` — `applyHeader` titles map (~line 61) add `focus`

**Interfaces:**
- Consumes: nothing new.
- Produces: `App.SORT_OPTIONS.focus = { label: 'Execution order' }` so `controller.setSortBy('focus')` is accepted; the Focus view shows a proper page title.

- [ ] **Step 1: Register the sort option** — in `js/constants.js`, inside `App.SORT_OPTIONS`, after `created`:

```javascript
  created:  { label: 'Created' },
  focus:    { label: 'Execution order' },
};
```

- [ ] **Step 2: Add the view header** — in `TaskListView.applyHeader`, in the `titles` map after `watching`:

```javascript
      'watching':  { eyebrow: 'Tasks you\'re watching', title: 'Watching' },
      'focus':     { eyebrow: 'Set the order to tackle them', title: 'Focus' },
```

- [ ] **Step 3: Commit**

```bash
git add js/constants.js js/views/TaskListView.js
git commit -m "feat(focus): register Execution-order sort + Focus view header"
```

---

### Task 7: Focus view rendering in TaskListView (sequenced, draggable)

**Files:**
- Modify: `js/views/TaskListView.js` — route the `focus` view in `_renderListInner` (~line 138), add `renderFocusList()` and `renderFocusRow(t, index)`, wire drag via `App.makeReorderable`.

**Interfaces:**
- Consumes: `controller.focusOwnerId()`, `taskModel.focusList(userId)`, `controller.canSetFocusFor(task)`, `controller.setFocusOrder`, `controller.removeFromFocus`, `App.makeReorderable` (Tasks 3-5).
- Produces: the `focus` view renders an ordered, drag-reorderable list with #N badges.

- [ ] **Step 1: Route the focus view** — in `_renderListInner`, after the `watching` early-return (line 138):

```javascript
    if (this.controller.uiState.view === 'watching') return this.renderWatchingTeam();
    if (this.controller.uiState.view === 'focus') return this.renderFocusList();
```

- [ ] **Step 2: Implement `renderFocusList` + `renderFocusRow`** — add these methods (place them right after `renderWatchingTeam`, before `renderWorkerList`, ~line 270):

```javascript
  /* The Focus view: the target person's curated execution-order list. Rows are
     drag-reorderable (mouse + touch); the #N badge is the position. The target
     person is the viewer, or the person: view's subject when a manager browses. */
  renderFocusList() {
    const ownerId = this.controller.focusOwnerId();
    const owner = App.PEOPLE[ownerId] || { name: ownerId };
    const tasks = this.taskModel.focusList(ownerId);
    const canEdit = tasks.length
      ? this.controller.canSetFocusFor(tasks[0])
      : (ownerId === this.currentUser || App.effectiveRole() !== 'worker');

    this.body.className = 'focus-list';
    this.body.innerHTML = '';

    const header = document.querySelector('#taskViewWrap .list-header');
    if (header) header.classList.add('hidden');

    if (tasks.length === 0) {
      this._renderEmpty({
        icon: 'ti-list-numbers',
        title: 'No focus tasks yet',
        sub: `Pick tasks with Select → "Add to Focus", then drag them into the order to tackle them.`,
      });
      return;
    }

    tasks.forEach((t, i) => this.body.appendChild(this.renderFocusRow(t, i, canEdit)));

    if (canEdit && App.makeReorderable) {
      // On drop, translate the row's new index into a midpoint focusSeq between
      // its new neighbors so only the moved task is written.
      this._focusCleanup = App.makeReorderable(this.body, {
        handleSelector: '.focus-drag',
        onDrop: (movedId, newIndex) => {
          const ordered = this.taskModel.focusList(ownerId).filter(t => t.id !== movedId);
          const before = ordered[newIndex - 1];   // neighbor above the drop slot
          const after = ordered[newIndex];         // neighbor below the drop slot
          let seq;
          if (!before && !after) seq = 0;
          else if (!before) seq = after.focusSeq - 1;
          else if (!after) seq = before.focusSeq + 1;
          else seq = (before.focusSeq + after.focusSeq) / 2;
          this.controller.setFocusOrder(movedId, seq);
        },
      });
    }
  }

  renderFocusRow(t, index, canEdit) {
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', color: '#E8A03A' };
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(t.due);
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const selected = this.controller.uiState.selectedTaskId === t.id;

    const row = document.createElement('div');
    row.className = 'focus-row' + (selected ? ' selected' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      ${canEdit ? `<button type="button" class="focus-drag" aria-label="Drag to reorder" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></button>` : ''}
      <span class="focus-rank">${index + 1}</span>
      <div class="focus-main">
        <div class="focus-title">${App.utils.escapeHtml(t.title)}</div>
        <div class="focus-meta">
          <span class="priority-block ${priority.cls}">${priority.label}</span>
          <span class="due-cell ${due.cls}">${due.text}</span>
        </div>
      </div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Pause — back to General shift' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play'}"></i>
      </button>
      ${canEdit ? `<button type="button" class="focus-remove" data-action="remove-focus" aria-label="Remove from Focus" title="Remove from Focus"><i class="ti ti-x"></i></button>` : ''}
    `;

    row.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (target) {
        e.stopPropagation();
        if (target.dataset.action === 'toggle-timer') this.controller.toggleTimerForTask(t.id);
        else if (target.dataset.action === 'remove-focus') this.controller.removeFromFocus(t.id);
        return;
      }
      // A click that isn't part of a drag opens the detail.
      if (row.classList.contains('dragging')) return;
      this.controller.selectTask(t.id);
    });
    return row;
  }
```

- [ ] **Step 3: Manual check (preview)** — at `app.html?preview=1&role=admin&member=abraham`, console:

```javascript
App.controller.addToFocus(['t6','t7','t3']); App.controller.setView('focus');
```
Expected: the main pane shows a "Focus" list with rows #1 #2 #3 (t6, t7, t3 — note t3 is abraham's). Dragging a row by its grip on desktop reorders and the numbers update after release. Clicking the × removes a row.

- [ ] **Step 4: Commit**

```bash
git add js/views/TaskListView.js
git commit -m "feat(focus): Focus view with sequenced, drag-reorderable rows"
```

---

### Task 8: "Add to Focus" bulk action + sidebar nav entry

**Files:**
- Modify: `js/views/BulkActionsView.js` — add an "Add to Focus" button (~line 38)
- Modify: `app.html` — add a `Focus` sidebar item in the Workspace group (~line 97)

**Interfaces:**
- Consumes: `controller.addToFocus(ids)` (Task 4), `controller._bulkIds()` is private — use the existing pattern: the bulk bar calls a controller method that reads `uiState.bulkSelected`. Add `controller.bulkAddToFocus()`.
- Produces: a bulk button that adds the selection to Focus; a sidebar link that opens the Focus view.

- [ ] **Step 1: Add a controller bulk wrapper** — in `js/controllers/AppController.js`, in the Focus section (after `addToFocus`), add:

```javascript
  bulkAddToFocus() {
    if (!App.can('tasks.write')) return;
    this.addToFocus(this._bulkIds());
  }
```

- [ ] **Step 2: Add the bulk button** — in `BulkActionsView.render`, add a button after the Complete button (line 38):

```javascript
        ${canWrite ? `<button class="btn btn-sm" data-bulk="complete" ${count ? '' : 'disabled'}><i class="ti ti-circle-check"></i>Complete</button>` : ''}
        ${canWrite ? `<button class="btn btn-sm" data-bulk="focus" ${count ? '' : 'disabled'}><i class="ti ti-list-numbers"></i>Add to Focus</button>` : ''}
```

- [ ] **Step 3: Wire it** — in the same file's click handler (line 42), add a branch:

```javascript
      if (a === 'cancel') this.controller.exitBulkMode();
      else if (a === 'all') this.controller.bulkSelectAllVisible();
      else if (a === 'complete') this.controller.bulkComplete();
      else if (a === 'focus') this.controller.bulkAddToFocus();
      else if (a === 'delete') this.controller.bulkDelete();
```

- [ ] **Step 4: Add the sidebar item** — in `app.html`, in the Workspace `side-group`, after the `watching` item (line 97):

```html
        <div class="side-item" data-view="watching" title="Watching"><i class="ti ti-eye"></i><span class="side-item-label">Watching</span><span class="side-count" id="cnt-watching">0</span></div>
        <div class="side-item" data-view="focus" title="Focus — set execution order"><i class="ti ti-list-numbers" style="color: var(--blue);"></i><span class="side-item-label">Focus</span><span class="side-count" id="cnt-focus">0</span></div>
```

- [ ] **Step 5: Manual check (preview)** — reload `app.html?preview=1&role=admin&member=abraham`. Click **Focus** in the sidebar → empty-state copy appears. Click **Select**, tick two tasks, click **Add to Focus** → toast; open **Focus** → the two tasks are listed and draggable.

- [ ] **Step 6: Commit**

```bash
git add js/views/BulkActionsView.js js/controllers/AppController.js app.html
git commit -m "feat(focus): Add-to-Focus bulk action + Focus sidebar nav"
```

---

### Task 9: Focus count badge in the sidebar

**Files:**
- Modify: `js/views/SidebarView.js` — wherever the workspace counts (`cnt-all`, `cnt-today`, etc.) are computed, add `cnt-focus` = current user's focus list length.

**Interfaces:**
- Consumes: `taskModel.focusList(currentUser)`.
- Produces: the Focus sidebar count reflects the viewer's focus list size.

- [ ] **Step 1: Find the count-setting code**

Run: `npx playwright test --list` is irrelevant; instead grep:
Search `cnt-today` in `js/views/SidebarView.js` to locate the counts block.

- [ ] **Step 2: Add the focus count** — alongside the other `cnt-*` assignments, mirroring their style. Example (adapt to the file's exact helper — it likely uses a `set(id, n)` helper or direct `textContent`):

```javascript
    set('cnt-focus', this.taskModel.focusList(this.currentUser).length);
```

If the file has no `currentUser`/`taskModel` handy in that method, use `App.taskModel.focusList(App.CURRENT_USER).length`.

- [ ] **Step 3: Manual check (preview)** — after adding tasks to Focus as abraham, the sidebar **Focus** count shows the number of his active focus tasks.

- [ ] **Step 4: Commit**

```bash
git add js/views/SidebarView.js
git commit -m "feat(focus): sidebar Focus count"
```

---

### Task 10: Focus widget in the page head

**Files:**
- Create: `js/views/FocusWidgetView.js`
- Modify: `app.html` — add a mount `<div id="focusWidget">` in `.page-head-widgets` (~line 135) and a `<script>` include in the Views block (after `UpNextWidgetView.js`, line 242)
- Modify: `js/app.js` — construct the view (~line 171, next to `UpNextWidgetView`)

**Interfaces:**
- Consumes: `taskModel.focusList`, `controller.focusOwnerId`, `controller.setFocusOrder`, `controller.setView`, `App.makeReorderable`.
- Produces: a compact, draggable Focus widget showing the top focus tasks; clicking the header opens the Focus view; clicking a row opens that task.

- [ ] **Step 1: Create the widget**

Create `js/views/FocusWidgetView.js`:

```javascript
window.App = window.App || {};

/* FocusWidgetView — a compact, drag-reorderable peek at the current person's
   Focus list (execution order), in the page head beside Up next. Header opens
   the full Focus view; rows open their task. Hidden when the list is empty so
   it never shows dead chrome. */
App.FocusWidgetView = class FocusWidgetView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;
    this.mount = document.getElementById('focusWidget');
    if (!this.mount) return;
    this.MAX = 5; // keep the head widget compact; full list lives in the Focus view
    this.subscribe();
    this.render();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.render());
    App.EventBus.on('view:changed',  () => this.render());
  }

  render() {
    if (!this.mount) return;
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    // The Focus view itself already shows the full list — don't double up.
    if (this.controller.uiState.view === 'focus') { this.mount.innerHTML = ''; return; }

    const ownerId = this.controller.focusOwnerId();
    const all = this.taskModel.focusList(ownerId);
    if (!all.length) { this.mount.innerHTML = ''; return; }

    const shown = all.slice(0, this.MAX);
    const canEdit = this.controller.canSetFocusFor(shown[0]);
    const extra = all.length - shown.length;

    this.mount.innerHTML = `
      <div class="focus-widget">
        <button type="button" class="focus-widget-head" data-action="open-focus">
          <span class="focus-widget-eyebrow"><i class="ti ti-list-numbers"></i> Focus</span>
          <span class="focus-widget-open">Open</span>
        </button>
        <div class="focus-widget-rows"></div>
        ${extra > 0 ? `<div class="focus-widget-more">+${extra} more</div>` : ''}
      </div>
    `;

    const rowsEl = this.mount.querySelector('.focus-widget-rows');
    shown.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'focus-widget-row';
      row.dataset.id = t.id;
      row.innerHTML = `
        <span class="focus-widget-rank">${i + 1}</span>
        <span class="focus-widget-title" title="${App.utils.escapeHtml(t.title)}">${App.utils.escapeHtml(t.title)}</span>
      `;
      row.addEventListener('click', () => {
        if (row.classList.contains('dragging')) return;
        this.controller.selectTask(t.id);
      });
      rowsEl.appendChild(row);
    });

    this.mount.querySelector('[data-action="open-focus"]').addEventListener('click', () => this.controller.setView('focus'));

    if (canEdit && App.makeReorderable) {
      this._cleanup = App.makeReorderable(rowsEl, {
        onDrop: (movedId, newIndex) => {
          const ordered = this.taskModel.focusList(ownerId).filter(t => t.id !== movedId);
          const before = ordered[newIndex - 1];
          const after = ordered[newIndex];
          let seq;
          if (!before && !after) seq = 0;
          else if (!before) seq = after.focusSeq - 1;
          else if (!after) seq = before.focusSeq + 1;
          else seq = (before.focusSeq + after.focusSeq) / 2;
          this.controller.setFocusOrder(movedId, seq);
        },
      });
    }
  }
};
```

- [ ] **Step 2: Add the mount + script** — in `app.html`:

In `.page-head-widgets` (after line 135):
```html
          <div class="up-next-mount" id="upNextWidget"></div>
          <div class="focus-widget-mount" id="focusWidget"></div>
```
In the Views script block (after line 242):
```html
<script src="js/views/UpNextWidgetView.js"></script>
<script src="js/views/FocusWidgetView.js"></script>
```

- [ ] **Step 3: Construct it** — in `js/app.js`, after the `UpNextWidgetView` line (171):

```javascript
  new App.UpNextWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.FocusWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
```

- [ ] **Step 4: Manual check (preview)** — as abraham with a few focus tasks, the page head (on the All view) shows a compact "Focus" widget listing #1..#5; "Open" switches to the Focus view; dragging a widget row reorders. On the Focus view itself the widget is empty (no duplication).

- [ ] **Step 5: Commit**

```bash
git add js/views/FocusWidgetView.js app.html js/app.js
git commit -m "feat(focus): compact Focus widget in the page head"
```

---

### Task 11: Styles (Focus view, rows, widget, drag, mobile)

**Files:**
- Modify: `taskmanagement.css` — append a Focus section near the other view styles.

**Interfaces:** none (CSS only). Class names must match Tasks 7 & 10: `.focus-list`, `.focus-row`, `.focus-drag`, `.focus-rank`, `.focus-main`, `.focus-title`, `.focus-meta`, `.focus-remove`, `.dragging`, `.focus-widget*`.

- [ ] **Step 1: Append the styles** — add to `taskmanagement.css`:

```css
/* ===== Focus list (execution order) ===== */
.focus-list { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.focus-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--surface, #fff);
  border: 1px solid var(--line, #e2d3bc); border-radius: 8px;
  touch-action: none; /* let the drag helper own vertical gestures */
}
.focus-row.selected { outline: 2px solid var(--amber); }
.focus-row.dragging { opacity: .85; box-shadow: 0 8px 24px rgba(46,31,17,.18); }
.focus-drag { cursor: grab; background: none; border: 0; color: var(--ink-3); padding: 4px; font-size: 18px; }
.focus-drag:active { cursor: grabbing; }
.focus-rank {
  flex: 0 0 auto; min-width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 700; font-size: 13px;
  background: var(--blue, #185FA5); color: #fff;
}
.focus-main { flex: 1 1 auto; min-width: 0; }
.focus-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.focus-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; font-size: 12px; }
.focus-remove { background: none; border: 0; color: var(--ink-3); padding: 4px; cursor: pointer; }
.focus-remove:hover { color: var(--rust); }

/* Focus widget in the page head */
.focus-widget-mount { min-width: 0; }
.focus-widget {
  border: 1px solid var(--line, #e2d3bc); border-radius: 10px;
  padding: 8px 10px; background: var(--surface, #fff); min-width: 200px;
}
.focus-widget-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; background: none; border: 0; cursor: pointer; padding: 0 0 6px; }
.focus-widget-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); display: flex; align-items: center; gap: 5px; }
.focus-widget-open { font-size: 11px; color: var(--blue); }
.focus-widget-rows { display: flex; flex-direction: column; gap: 4px; }
.focus-widget-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; border-radius: 6px; cursor: pointer; touch-action: none; }
.focus-widget-row:hover { background: var(--hover, rgba(0,0,0,.04)); }
.focus-widget-row.dragging { opacity: .85; }
.focus-widget-rank { flex: 0 0 auto; min-width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: var(--blue, #185FA5); color: #fff; }
.focus-widget-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
.focus-widget-more { font-size: 11px; color: var(--ink-3); padding-top: 4px; }

@media (max-width: 720px) {
  /* The full Focus view is the primary surface on phones; keep the head widget
     from crowding the title by letting it wrap to its own row and span wide. */
  .focus-widget { width: 100%; }
  .focus-row { padding: 12px; }       /* roomier touch targets */
  .focus-drag { font-size: 22px; padding: 6px; }
}
```

- [ ] **Step 2: Manual check (preview, phone size)** — at `app.html?preview=1&role=admin&member=abraham`, open DevTools device toolbar at 390px width. The Focus view rows are comfortably tappable; the grip drags with touch (use device emulation touch); the widget on the All view spans the width without overflowing.

- [ ] **Step 3: Commit**

```bash
git add taskmanagement.css
git commit -m "feat(focus): styles for Focus view, rows, widget, mobile"
```

---

### Task 12: End-to-end test — pick, order, persist (preview mode)

**Files:**
- Create: `tests/focus-e2e.spec.js`

**Interfaces:** exercises the full UI through the preview build.

- [ ] **Step 1: Write the test**

Create `tests/focus-e2e.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html?preview=1&role=admin&member=abraham');
  await page.waitForFunction(() => window.App && window.App.controller);
});

test('add tasks to Focus, reorder by drag, removal updates ranks', async ({ page }) => {
  // Seed three of abraham's tasks into Focus directly, then open the view.
  await page.evaluate(() => window.App.controller.addToFocus(['t6', 't7', 't3']));
  await page.evaluate(() => window.App.controller.setView('focus'));

  const ranks = page.locator('.focus-row .focus-rank');
  await expect(ranks).toHaveCount(3);
  const idsBefore = await page.locator('.focus-row').evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsBefore).toEqual(['t6', 't7', 't3']);

  // Drag row #1 (t6) to the bottom.
  const first = page.locator('.focus-row[data-id="t6"] .focus-drag');
  const box = await first.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + 200, { steps: 10 });
  await page.mouse.up();

  const idsAfter = await page.locator('.focus-row').evaluateAll(els => els.map(e => e.dataset.id));
  expect(idsAfter[idsAfter.length - 1]).toBe('t6');

  // Remove the now-first task; count drops to 2 and ranks renumber from 1.
  await page.locator('.focus-row').first().locator('.focus-remove').click();
  await expect(page.locator('.focus-row')).toHaveCount(2);
  const firstRank = await page.locator('.focus-row .focus-rank').first().textContent();
  expect(firstRank.trim()).toBe('1');
});
```

- [ ] **Step 2: Run it, verify it passes**

Run: `npx playwright test tests/focus-e2e.spec.js`
Expected: PASS. (If the dev server isn't auto-started by the Playwright config, serve the folder first — see existing `tests/` setup / `playwright.config`.)

- [ ] **Step 3: Run the whole focus suite + the existing responsive suite (no regressions)**

Run: `npx playwright test tests/focus-model.spec.js tests/focus-dragorder.spec.js tests/focus-e2e.spec.js tests/responsive.spec.js`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/focus-e2e.spec.js
git commit -m "test(focus): e2e add/reorder/remove in preview mode"
```

---

## Self-Review

**Spec coverage:**
- Data model `focus_seq` real, null = not in focus → Task 1; mapped → Task 2. ✓
- Membership + order in one column, #N computed → Tasks 3 (focusList), 7 (rank = index). ✓
- Add via bulk select + (per-task remove in the row) → Tasks 4, 8 (add); 4, 7 (remove). NOTE: the spec also mentioned a single-task "Add to Focus" from the row/detail menu — deferred to keep scope tight; bulk + the Focus view's remove cover the core workflow. Add-from-detail can be a fast follow. (Logged here so it isn't a silent cut.)
- Focus tab/view, sequenced + draggable, active-only, permission-gated → Task 7. ✓
- Focus widget, compact, responsive, hidden when empty / on the focus view → Tasks 10, 11. ✓
- Shared drag helper, mouse + touch → Task 5. ✓
- Reassign resets focus → Task 4. Delete/clear leave naturally (focusList filters cleared; remove() drops the row) → covered by existing model behavior. ✓
- Concurrency via existing updated_at optimistic lock → unchanged save path (Tasks 2, model emits tasks:changed → app.js debounced save). ✓
- Testing: midpoint/add unit-ish (Task 3), drag helper (Task 5), e2e (Task 12). ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. The only deferral (add-from-detail) is explicitly flagged above, not left as a vague gap.

**Type consistency:** `focusSeq` (JS) ↔ `focus_seq` (DB) used consistently across Tasks 2-10. Methods `addToFocus`/`removeFromFocus`/`setFocusOrder`/`focusList` named identically in model (Task 3), controller wrappers (Task 4), and views (Tasks 7, 10). `App.makeReorderable(container, { onDrop, handleSelector })` signature matches all call sites. `focusOwnerId()` / `canSetFocusFor(task)` consistent. Sort key `'focus'` registered (Task 6) before `setSortBy('focus')` could be used.

**RLS note (verify at Task 1 apply time):** `focus_seq` is a normal column updated via the existing task UPDATE path. Confirm the assignee's own task-update RLS and the manager update RLS both permit it (they should — no column-level grants are used here). If a worker can't update `focus_seq` on a task they're assigned, that's a pre-existing task-update RLS gap, not specific to this feature.
