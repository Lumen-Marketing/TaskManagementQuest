# Task Taxonomy — Phase 3 (Admin UI + "Done" Refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or
> subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Zero-build vanilla-JS
> SPA — there is no unit-test runner and Chromium must NOT be installed, so each task's
> verification is `node --check` (syntax) + a logic/self review + the described manual
> browser check, then a commit. This mirrors the Phase 1/2 verification approach.

**Goal:** Make the per-company taxonomy actually *customizable at runtime* — (A) route every
task-completion decision through `App.taxonomy.isDone(task)` so a non-`done` done-key works,
and (B) add a gated **Settings → Task setup** admin screen to add / rename / recolor / reorder
/ soft-delete types, per-type statuses, and labels, and to set each type's one *done* and one
*default* status. After a save the taxonomy re-hydrates live and the app re-renders.

**Architecture:** Builds directly on Phase 2's `App.taxonomy` (loader + `isDone/doneStatus/
defaultStatus` + per-company accessors + `taxonomy:changed` event). **Part A** swaps ~45
literal `status === 'done'` / `!== 'done'` completion checks (and the 3 status *writes*) for
the taxonomy helpers — behaviour-preserving today because every seeded type's done key is still
`'done'`. **Part B** adds one full-page surface (`TaskSetupAdminView`) mounted like Reports,
new `SupabaseDataStore` CRUD methods against the Phase-1 tables, and thin `AppController`
methods that persist a change, re-hydrate `App.taxonomy`, and emit `taxonomy:changed`.

**Tech Stack:** Vanilla JS classes on `window.App`; Supabase JS client; `App.EventBus`;
CSS in `taskmanagement.css`. No new dependencies.

## Global Constraints

- **Base branch:** cut an **isolated git worktree** off `feat/taxonomy-phase2` (which has
  `js/taxonomy.js`) named `feat/taxonomy-phase3`. Do NOT work in the primary dir (it holds the
  user's unrelated `feat/home-blocked-align` WIP). Never assume `main`.
- **No DB schema changes.** Phase 1 already created `task_types`, `task_type_statuses`,
  `task_labels` with RLS and the partial unique indexes `task_status_one_done` /
  `task_status_one_default` on the PRODUCTION project `qqvmcsvdxhgjooirznrj`. Phase 3 only
  reads/writes rows through those tables' existing policies.
- **RLS is the wall:** writes to the 3 tables succeed only for `current_profile_role()` in
  (`developer`,`admin`,`construction_supervisor`) whose companies include the row's
  `company_id`. The UI gate MUST match this exactly (see Task B1) so no one sees a screen whose
  saves would 403.
- **Behaviour/appearance-preserving for Part A:** `App.taxonomy.isDone(t)` === `t.status ===
  'done'` for all current data (every seeded done key is `done`; `doneStatus` falls back to
  `'done'` and `defaultStatus` to `'todo'` when a lookup misses, so the refactor degrades to
  exactly today's behaviour even for a task with an unknown company/type).
- **Refactor completion *semantics* only.** Leave code that iterates *all* statuses (e.g. the
  Reports status-distribution chart, status dropdown option lists) alone — it already reads the
  data-driven `App.STATUSES`. Only `=== 'done'` / `!== 'done'` **completion** checks and the 3
  status *writes* change.
- **`'done'` that is NOT a status:** `AppController.js:652` `_revertToGeneralShift(user,'done')`
  and `:671` `reason === 'done'` are clock-out *reason* strings — **do not touch them**.
- **Soft-delete only:** the admin "remove" sets `active=false`; never `DELETE` a taxonomy row
  (historical tasks must keep resolving their type/status/label for display).
- **One done / one default:** the DB indexes forbid *two* trues but allow *zero*. So "set done"
  = clear the current done row (`is_done=false`) **then** set the new one (`is_done=true`), in
  that order; same for default. The UI forbids unsetting the *only* done/default (must always
  have exactly one) and forbids removing a type's last active status.
- **Single concrete company per edit:** `uiState.currentCompany` may be `'*'` ("all", for
  developers / multi-company users). The admin screen edits **one** company; when current is
  `'*'` it defaults its own selector to the first real company the user can manage.
- **Design taste (user, strict):** warm-flat "panze" look — reuse the existing `.qhq-page` /
  panze surface + pill/chip classes; **NO hairline borders**, no generic-admin/AI-slop tells;
  orange `#ED4E0D` accents, Hanken headings. Match the Home / Reports / Approvals surfaces.
  Separate rows with spacing + faint warm background, not lines. Eyeball on a Vercel preview
  before merge (no local Chromium).
- **Ship order:** Part A first (behaviour-preserving, independently committable + verifiable),
  then Part B (which only becomes *safe to expose* once completion is data-driven).

## File Structure

- **Modify** `js/models/TaskModel.js` — completion write in `toggleDone`; ~8 read checks.
- **Modify** `js/controllers/AppController.js` — 2 status-transition detectors; ~4 read checks;
  add taxonomy CRUD methods + `openTaskSetup()`/route + `_togglePanes` handling.
- **Modify** these read-only completion sites: `js/services/ReminderEngine.js`,
  `js/views/HomeView.js`, `js/views/ProjectsView.js`, `js/views/ReportsView.js`,
  `js/views/TaskDetailView.js`, `js/views/TaskListView.js`, `js/views/UpNextWidgetView.js`,
  `js/views/SidebarView.js`, `js/views/WallboardView.js`.
- **Modify** `js/constants.js` — add `task-setup.manage` permission + `construction_supervisor`
  role row.
- **Modify** `js/services/SupabaseDataStore.js` — CRUD for the 3 tables + `loadTaxonomy()`.
- **Modify** `js/views/SidebarView.js` — gated "Task setup" nav item.
- **Modify** `app.html` — `#taskSetupWrap` section + `<script src="js/views/TaskSetupAdminView.js">`.
- **Modify** `js/app.js` — instantiate `App.TaskSetupAdminView`.
- **Create** `js/views/TaskSetupAdminView.js` — the admin screen.
- **Modify** `taskmanagement.css` — `.tsetup-*` panze styles.

---

# PART A — "Done" completion refactor

### Task A1: Route completion *writes* through the taxonomy

**Files:** Modify `js/models/TaskModel.js` (`toggleDone`, ~lines 341-342); Modify
`js/controllers/AppController.js` (status-transition detectors at ~1026 and ~1142).

**Interfaces consumed (from Phase 2 `App.taxonomy`):**
- `App.taxonomy.doneStatus(company, type) -> statusKey` (falls back to `'done'`)
- `App.taxonomy.defaultStatus(company, type) -> statusKey` (falls back to `'todo'`)
- `App.taxonomy.isDone(task) -> boolean`

- [ ] **Step 1 — `TaskModel.toggleDone` write.** Find the two lines:

```js
const becomingDone = t.status !== 'done';
t.status = becomingDone ? 'done' : 'todo';
```

Replace with (uses the task's own type/company so a custom pipeline resolves correctly;
falls back to `'done'`/`'todo'` exactly as before when the lookup misses):

```js
const becomingDone = !App.taxonomy.isDone(t);
t.status = becomingDone
  ? App.taxonomy.doneStatus(t.company, t.type)
  : App.taxonomy.defaultStatus(t.company, t.type);
```

Leave the rest of `toggleDone` (the `becomingDone` return, `completedAt` stamping, etc.)
unchanged. `toggleTaskDone`/`completeTask` in AppController call this and read
`result.becomingDone` — that contract is unchanged.

- [ ] **Step 2 — `AppController` inline status→done detector (~line 1026).** Find:

```js
if (field === 'status' && value === 'done' && prev !== 'done') {
```

Replace with (compare against the task's *type* done key, not the literal):

```js
const doneKey = App.taxonomy.doneStatus(task.company, task.type);
if (field === 'status' && value === doneKey && prev !== doneKey) {
```

(`task` is already in scope at line ~1024: `const prev = task[field];`.)

- [ ] **Step 3 — `AppController` full-save status→done detector (~line 1142).** Find:

```js
if (status === 'done' && prevStatus !== 'done') this._revertToGeneralShiftIfOnTask(id);
```

Replace with (resolve the done key from the task being saved; `id`, `status`, `prevStatus`
are in scope — read the task for its company/type):

```js
const task142 = this.taskModel.find(id);
const doneKey142 = task142 ? App.taxonomy.doneStatus(task142.company, task142.type) : 'done';
if (status === doneKey142 && prevStatus !== doneKey142) this._revertToGeneralShiftIfOnTask(id);
```

(If a `task`/company/type variable already exists in that method's scope, reuse it instead of
re-finding — check the surrounding lines; the intent is "did this save move the task into its
type's done state?")

- [ ] **Step 4 — Do NOT touch** `AppController.js:652` (`_revertToGeneralShift(this.currentUser,
  'done')`) or `:671` (`reason === 'done'`). Those are clock-out *reason* strings.

- [ ] **Step 5 — Verify.** `node --check js/models/TaskModel.js && node --check
  js/controllers/AppController.js`. Manual (preview): mark a task complete then reopen — status
  toggles, the "still clocked in" toast fires on complete, and the task leaves/returns to open
  lists. Behaviour identical to before.

- [ ] **Step 6 — Commit.**

```bash
git add js/models/TaskModel.js js/controllers/AppController.js
git commit -m "refactor(taxonomy): route completion writes through App.taxonomy done/default"
```

---

### Task A2: Route completion *reads* through `App.taxonomy.isDone`

**Files:** Modify `js/models/TaskModel.js`, `js/controllers/AppController.js`,
`js/services/ReminderEngine.js`, `js/views/HomeView.js`, `js/views/ProjectsView.js`,
`js/views/ReportsView.js`, `js/views/TaskDetailView.js`, `js/views/TaskListView.js`,
`js/views/UpNextWidgetView.js`, `js/views/SidebarView.js`, `js/views/WallboardView.js`.

**The rule (apply at every site below):** at each listed line, replace the *completion*
comparison, keeping everything else on the line intact and using whatever the task variable is
named there (usually `t`, sometimes `task`):
- `X.status === 'done'`  →  `App.taxonomy.isDone(X)`
- `X.status !== 'done'`  →  `!App.taxonomy.isDone(X)`
- `const isDone = X.status === 'done';`  →  `const isDone = App.taxonomy.isDone(X);`

Do **not** change lines where `'done'` is a group key for *non-completion* iteration, a swipe/
menu `data-*` action id, or a status-distribution loop over all statuses — those are called out
as "leave" below.

- [ ] **Step 1 — `js/models/TaskModel.js`** (completion reads):
  - `:103` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:139` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:140` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:141` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:185` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:225` grouping into the Done bucket: `if (t.status === 'done') ensure('done','Done',
    colorFor('done'),6).items.push(t);` → change **only** the test:
    `if (App.taxonomy.isDone(t)) ensure('done','Done',colorFor('done'),6).items.push(t);`
    (the `'done'` *bucket key/label* stays — that's the display bucket, not a task comparison).
  - `:297` `if (t.status === 'done') groups.done.push(t);` → `if (App.taxonomy.isDone(t))
    groups.done.push(t);` (bucket name `groups.done` unchanged).
  - `:358` `.filter(t => t.status === 'done' && !t.clearedAt)` → `.filter(t =>
    App.taxonomy.isDone(t) && !t.clearedAt)`.

- [ ] **Step 2 — `js/controllers/AppController.js`** (completion reads only; A1 already did the
  writes):
  - `:74` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:903` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:1007` `t.status === 'done' && !t.clearedAt` → `App.taxonomy.isDone(t) && !t.clearedAt`
  - `:1527` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - **Leave** `:652`, `:671` (reason strings).

- [ ] **Step 3 — `js/services/ReminderEngine.js`**:
  - `:46` `t.status === 'done'` → `App.taxonomy.isDone(t)`

- [ ] **Step 4 — `js/views/HomeView.js`**:
  - `:72` `t.status === 'done'` → `App.taxonomy.isDone(t)`
  - `:99` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:101` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:123` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`

- [ ] **Step 5 — `js/views/ProjectsView.js`**:
  - `:27` both halves: `t.status !== 'done'` → `!App.taxonomy.isDone(t)` and `t.status ===
    'done'` → `App.taxonomy.isDone(t)`.

- [ ] **Step 6 — `js/views/ReportsView.js`**:
  - `:42` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - **Leave** `:45` (`t.completedAt`-based, not a status compare) and `:64` (distribution over
    all statuses).

- [ ] **Step 7 — `js/views/TaskDetailView.js`**:
  - `:213` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
    (line `:215` overdue uses the local `isDone` — no change; `:284` button uses `isDone` — no
    change).

- [ ] **Step 8 — `js/views/TaskListView.js`** (every `const isDone = t.status === 'done'` →
  `const isDone = App.taxonomy.isDone(t)`; every bare `t.status !== 'done'` → `!App.taxonomy.
  isDone(t)`; every bare `t.status === 'done'` → `App.taxonomy.isDone(t)`):
  - `:46` `.some(t => t.status === 'done')` → `.some(t => App.taxonomy.isDone(t))`
  - `:263` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:266` `t.status === 'done'` → `App.taxonomy.isDone(t)`
  - `:348` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:391` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:479` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:675` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - `:831` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - `:884` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - `:1045` `const done = t.status === 'done';` → `const done = App.taxonomy.isDone(t);`
  - `:1086` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - `:1198` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - `:1456` `const isDone = t.status === 'done';` → `const isDone = App.taxonomy.isDone(t);`
  - **Leave** the `data-swipe="done"` (`:1204`) and `data-q="done"` (`:1461`) action ids — the
    handlers they trigger set status via `toggleDone`/`completeTask`, already fixed in A1.

- [ ] **Step 9 — `js/views/UpNextWidgetView.js`**:
  - `:30` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`

- [ ] **Step 10 — `js/views/SidebarView.js`**:
  - `:319` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`

- [ ] **Step 11 — `js/views/WallboardView.js`**:
  - `:131` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:157` `t.status !== 'done'` → `!App.taxonomy.isDone(t)`
  - `:158` `t.status === 'done'` → `App.taxonomy.isDone(t)`

- [ ] **Step 12 — Re-grep to confirm none missed.** From repo root:
  `grep -rn "status === 'done'\|status !== 'done'" js/` — expect **zero** hits except the
  explicitly-left non-status ones (there are none of those in this pattern; the reason strings
  use `reason ===`/`, 'done')`, not `.status`). If any remain, apply the rule.

- [ ] **Step 13 — Verify.** `node --check` each modified file. Manual (preview): Overdue/Done
  counts in the sidebar, Home KPIs, Reports, Wallboard, and per-view lists match what they
  showed before; a done task is struck-through/hidden as before. Numbers must be identical to
  pre-refactor.

- [ ] **Step 14 — Commit.**

```bash
git add js/
git commit -m "refactor(taxonomy): route completion reads through App.taxonomy.isDone"
```

---

# PART B — Settings → Task setup admin screen

### Task B1: Permission, route, and empty full-page surface

**Files:** Modify `js/constants.js`, `app.html`, `js/controllers/AppController.js`,
`js/views/SidebarView.js`.

**Interfaces produced:** view id `'admin:task-setup'`; permission `'task-setup.manage'`;
`AppController.openTaskSetup()`; DOM `#taskSetupWrap`.

- [ ] **Step 1 — Permission + role (`js/constants.js`).** In `App.ROLE_PERMISSIONS`, append
  `'task-setup.manage'` to the `admin` and `developer` arrays, and add a
  `construction_supervisor` row (supervisor perms + the new permission) so the UI gate matches
  the RLS write policy exactly:

```js
admin:     [ /* …existing… */ , 'task-setup.manage'],
developer: [ /* …existing… */ , 'task-setup.manage'],
construction_supervisor: ['app.use','tasks.view','tasks.write','clock.use','time.own',
  'time.team','team.view','home.view','reports.view','task-setup.manage'],
```

- [ ] **Step 2 — Surface element (`app.html`).** After the `wallboardWrap`/`projectsWrap`
  sections inside `<main id="mainPane">`, add:

```html
<section id="taskSetupWrap" class="qhq-page hidden" aria-label="Task setup"></section>
```

  And add the view script near the other view `<script>` tags (after `SidebarView.js`, before
  the bootstrap/controller scripts):

```html
<script src="js/views/TaskSetupAdminView.js"></script>
```

- [ ] **Step 3 — Routing (`js/controllers/AppController.js` `_togglePanes`).** (a) add
  `'admin:task-setup'` to the `isPageView` disjunction so the list pane hides; (b) after the
  `wallboardWrap` toggle, add:

```js
const taskSetupWrap = document.getElementById('taskSetupWrap');
if (taskSetupWrap) taskSetupWrap.classList.toggle('hidden', v !== 'admin:task-setup');
```

  Add a convenience method used by the nav:

```js
openTaskSetup() { this.setView('admin:task-setup'); }
```

  (`setView` already sets `uiState.view`, calls `_togglePanes()`, and emits `view:changed`.)

- [ ] **Step 4 — Nav item (`js/views/SidebarView.js` `_buildSections`).** In the `team`
  section builder, after the `approvals`/`admin:clock` items, add:

```js
if (App.can('task-setup.manage'))
  teamItems.push({ view: 'admin:task-setup', label: 'Task setup', icon: 'ti-adjustments' });
```

  (Items with `data-view` are already wired to `controller.setView(...)` by the existing
  `_makeActivatable` loop — no extra binding needed.)

- [ ] **Step 5 — Stub view.** Create `js/views/TaskSetupAdminView.js` with just enough to prove
  routing: a class whose `render()` writes a heading into `#taskSetupWrap`, gated on
  `App.can('task-setup.manage')` (full body arrives in B4). Instantiate it in `js/app.js`
  alongside the other views (e.g. `App.taskSetupAdminView = new App.TaskSetupAdminView({
  controller: App.controller });`).

- [ ] **Step 6 — Verify.** `node --check` the changed JS. Manual (preview): as an admin, a
  "Task setup" item appears in the sidebar Team group and opens a full-page surface (list pane
  hidden); as a worker it is absent, and navigating to it directly shows the access-denied
  state.

- [ ] **Step 7 — Commit.**

```bash
git add js/constants.js app.html js/controllers/AppController.js js/views/SidebarView.js js/views/TaskSetupAdminView.js js/app.js
git commit -m "feat(taxonomy): gated Task setup route + empty admin surface"
```

---

### Task B2: DataStore CRUD + taxonomy refetch

**Files:** Modify `js/services/SupabaseDataStore.js`.

**Interfaces produced (all reject via `_throwIfError`):**
- `loadTaxonomy() -> {types:[], statuses:[], labels:[]}` (all companies; same shape the boot
  `load()` returns under `taxonomy`)
- `createTaskType(row)`, `updateTaskType(id, patch)`  (soft-delete = `updateTaskType(id,
  {active:false})`)
- `createTaskStatus(row)`, `updateTaskStatus(id, patch)`
- `createTaskLabel(row)`, `updateTaskLabel(id, patch)`

- [ ] **Step 1 — `loadTaxonomy()`.** Mirror the three `select('*')` queries the Phase-2
  `load()` already added, returning `{types, statuses, labels}` so `App.taxonomy.hydrate(...)`
  can consume it directly:

```js
async loadTaxonomy() {
  const [t, s, l] = await Promise.all([
    this.supabase.from('task_types').select('*'),
    this.supabase.from('task_type_statuses').select('*'),
    this.supabase.from('task_labels').select('*'),
  ]);
  this._throwIfError(t, 'task types');
  this._throwIfError(s, 'task statuses');
  this._throwIfError(l, 'task labels');
  return { types: t.data || [], statuses: s.data || [], labels: l.data || [] };
}
```

- [ ] **Step 2 — CRUD methods** (INSERT `.select().single()` to return the new row; UPDATE by
  `id`; soft-delete via the same UPDATE). Follow the store's existing `createProject` /
  `_throwIfError` conventions:

```js
async createTaskType(row) {
  const res = await this.supabase.from('task_types').insert(row).select('*').single();
  this._throwIfError(res, 'creating task type'); return res.data;
}
async updateTaskType(id, patch) {
  const res = await this.supabase.from('task_types').update(patch).eq('id', id).select('*').single();
  this._throwIfError(res, 'updating task type'); return res.data;
}
async createTaskStatus(row) {
  const res = await this.supabase.from('task_type_statuses').insert(row).select('*').single();
  this._throwIfError(res, 'creating status'); return res.data;
}
async updateTaskStatus(id, patch) {
  const res = await this.supabase.from('task_type_statuses').update(patch).eq('id', id).select('*').single();
  this._throwIfError(res, 'updating status'); return res.data;
}
async createTaskLabel(row) {
  const res = await this.supabase.from('task_labels').insert(row).select('*').single();
  this._throwIfError(res, 'creating label'); return res.data;
}
async updateTaskLabel(id, patch) {
  const res = await this.supabase.from('task_labels').update(patch).eq('id', id).select('*').single();
  this._throwIfError(res, 'updating label'); return res.data;
}
```

- [ ] **Step 3 — Verify.** `node --check js/services/SupabaseDataStore.js`. (Live round-trip is
  exercised via the controller in B3/B4.)

- [ ] **Step 4 — Commit.**

```bash
git add js/services/SupabaseDataStore.js
git commit -m "feat(taxonomy): dataStore CRUD + loadTaxonomy refetch for task setup"
```

---

### Task B3: Controller taxonomy operations (persist → re-hydrate → emit)

**Files:** Modify `js/controllers/AppController.js`.

**Interfaces produced (each returns a Promise; on success re-hydrates `App.taxonomy` and lets
the `taxonomy:changed` emit re-render every subscriber):**
`addType`, `renameType`, `recolorType`, `removeType`, `moveType`;
`addStatus`, `renameStatus`, `recolorStatus`, `removeStatus`, `moveStatus`, `setDoneStatus`,
`setDefaultStatus`; `addLabel`, `renameLabel`, `recolorLabel`, `removeLabel`, `moveLabel`.

- [ ] **Step 1 — Shared refetch helper.** After any successful write, reload the whole taxonomy
  and re-hydrate (this re-runs `applyGlobals()` and emits `taxonomy:changed`):

```js
async _reloadTaxonomy() {
  const raw = await this.dataStore.loadTaxonomy();
  App.taxonomy.hydrate(raw);          // re-applies globals + emits 'taxonomy:changed'
  App.EventBus.emit('tasks:changed'); // so list/count views recompute against new labels
}
```

- [ ] **Step 2 — Guard + slug + sort helpers.**

```js
_assertCanTaxonomy() { if (!App.can('task-setup.manage')) throw new Error('Not allowed.'); }
_slugify(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40) || 'item'; }
// next sort_order = max(existing)+1; midpoint for a move handled in moveType/moveStatus/moveLabel.
```

- [ ] **Step 3 — Types.** `addType(company,label,color)` inserts `{company_id:company,
  key:_uniqueKey, label, color, sort_order:max+1, active:true}`; `renameType(id,label)` /
  `recolorType(id,color)` patch; `removeType(id)` → `updateTaskType(id,{active:false})`;
  `moveType(id,dir)` swaps `sort_order` with the adjacent active sibling (write both). Each:
  `_assertCanTaxonomy()` → await dataStore call → `await this._reloadTaxonomy()`. **New-type
  seeding:** after inserting a type, insert a starter status set so the type is usable — a
  single default+done status is the minimum; create `{key:'todo',label:'To do',
  is_default:true}` and `{key:'done',label:'Done',is_done:true}` for it (matches the seeded
  shape) so invariants hold immediately.

- [ ] **Step 4 — Statuses (per type).** `addStatus(company,typeKey,label,color)` inserts into
  `task_type_statuses` with `type_key:typeKey`, `sort_order:max+1`, `is_done:false,
  is_default:false, active:true`; `rename/recolor/move` as above; `removeStatus(id)` →
  `active:false` **but refuse if it is the type's only active status, or the current done, or
  the current default** (throw a clear Error the view surfaces as a toast).
  `setDoneStatus(company,typeKey,id)`: **first** patch the existing `is_done` row (if any and
  different) to `is_done:false`, **then** patch `id` to `is_done:true` (order matters — the
  `task_status_one_done` index allows zero-true, not two). `setDefaultStatus` is identical with
  `is_default`. Then `_reloadTaxonomy()`.

- [ ] **Step 5 — Labels.** `addLabel/renameLabel/recolorLabel/removeLabel/moveLabel` against
  `task_labels` (no done/default concept). `removeLabel` = `active:false`.

- [ ] **Step 6 — Verify.** `node --check js/controllers/AppController.js`. Logic review the
  set-done/default ordering and the removeStatus guards against the DB indexes.

- [ ] **Step 7 — Commit.**

```bash
git add js/controllers/AppController.js
git commit -m "feat(taxonomy): controller CRUD ops with invariants + live re-hydrate"
```

---

### Task B4: `TaskSetupAdminView` — the master-detail screen

**Files:** Replace the B1 stub `js/views/TaskSetupAdminView.js` with the full view.

**Layout (panze, no hairlines):** header row = `Task setup` heading + a **company selector**
(options = the real companies the user can manage: `uiState.companies` minus `'*'`; default =
`currentCompany` unless it's `'*'`, then the first). Two columns: **Types** (left, selectable
list; selected type drives the right) and **Statuses for “<type>”** (right). Below, a full-width
**Labels** row of chips. Every row: name, a color swatch (`<input type="color">` bound to the
row's hex), and small icon actions (rename ✎, move ▲/▼, remove ✕); status rows also show
**default** and **done** toggle pills. `+ Add …` buttons open the small modal.

- [ ] **Step 1 — Lifecycle** (mirror `ReportsView` + `ApprovalView`):

```js
App.TaskSetupAdminView = class TaskSetupAdminView {
  constructor({ controller }) {
    this.controller = controller;
    this.dataStore = controller.dataStore;
    this.wrap = document.getElementById('taskSetupWrap');
    this.company = null;      // concrete company being edited
    this.selectedType = null; // type key selected in the left column
    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('taxonomy:changed', rerender);
    App.EventBus.on('company:changed', () => { this.company = null; rerender(); });
  }
  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }
  _companies() { return (this.controller.uiState.companies || []).filter(c => c !== '*'); }
  _resolveCompany() {
    if (this.company && this._companies().includes(this.company)) return this.company;
    const cur = this.controller.uiState.currentCompany;
    this.company = (cur && cur !== '*') ? cur : (this._companies()[0] || null);
    return this.company;
  }
  render() { /* Steps 2-4 */ }
};
```

- [ ] **Step 2 — Access gate + empty states.** At the top of `render()`:

```js
if (!App.can('task-setup.manage')) {
  this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><p>Only admins can edit task setup.</p></div>`;
  return;
}
const company = this._resolveCompany();
if (!company) { this.wrap.innerHTML = `<div class="empty"><p>No editable company.</p></div>`; return; }
```

- [ ] **Step 3 — Build the HTML** from `App.taxonomy.activeTypes(company)`,
  `App.taxonomy.activeStatuses(company, this.selectedType)` (default `selectedType` to the first
  type when unset/absent), and `App.taxonomy.activeLabels(company)`. Render into `.tsetup-*`
  containers (see Task B5 for classes). Show which status is `isDefault` / `isDone` as active
  pills. Include the company `<select>`, the two columns, the labels chips, and the three `+
  Add` buttons.

- [ ] **Step 4 — `bindEvents()`** (delegate off `this.wrap`): company select →
  `this.company = value; this.selectedType = null; this.render()`; type row click → set
  `selectedType` + re-render; each action button → the matching `controller.*` op wrapped in a
  small async runner that disables the control, shows a `toastView` success/failure, and lets
  `taxonomy:changed` re-render:

```js
async _run(fn, okTitle) {
  try { await fn(); this.controller.toastView.show({ title: okTitle }); }
  catch (e) { this.controller.toastView.show({ title: 'Could not save', sub: (e && e.message) || 'Try again.' }); }
}
```

  Rename uses an inline text editor (or a prompt-style small modal) submitting to
  `controller.renameType/renameStatus/renameLabel`; color swatch `change` →
  `recolor*`; ▲/▼ → `move*(id, -1|+1)`; ✕ → confirm then `remove*`; default/done pills →
  `setDefaultStatus/setDoneStatus`. `+ Add` opens the modal.

- [ ] **Step 5 — Add modal** (mirror `ApprovalView.openAddPerson`): a `.modal-backdrop` with a
  name field + `<input type="color">`, Cancel/Add; on Add call the matching
  `controller.add{Type,Status,Label}(company[, selectedType], name, color)` via `_run`, then
  close. Guard against duplicate modals with an instance flag.

- [ ] **Step 6 — Verify.** `node --check js/views/TaskSetupAdminView.js`. Manual (preview) —
  full CRUD round-trip for one company: add a type (starter statuses appear); add/rename/recolor
  a status; set a different status as done, then as default (old flags clear, no DB error);
  reorder with ▲/▼; soft-remove a label; confirm the last-status / only-done / only-default
  removals are refused with a toast; switch the company selector and see that company's sets.
  After each save, task lists/labels re-render with the new labels/colors.

- [ ] **Step 7 — Commit.**

```bash
git add js/views/TaskSetupAdminView.js
git commit -m "feat(taxonomy): Task setup admin screen (types/statuses/labels CRUD)"
```

---

### Task B5: Panze styling

**Files:** Modify `taskmanagement.css`.

- [ ] **Step 1 — Add `.tsetup-*` styles** scoped under `#taskSetupWrap`, **reusing** existing
  panze tokens/surfaces (same warm background, radius, and shadow as `.qhq-page` cards; the
  same pill styling used elsewhere). Two-column grid (`minmax(0,1fr) minmax(0,1.2fr)`) that
  collapses to one column ≤720px (mobile is the standing priority). Rows separated by spacing +
  a faint warm hover fill — **no hairline borders**. The selected type row and active
  default/done pills use the orange `#ED4E0D` accent. Color swatches are compact. Match the
  Home/Reports/Approvals look so it reads as the same app.

- [ ] **Step 2 — Verify.** Manual (preview): the screen looks native to the app (warm-flat, no
  borders, orange accents), is legible, and is usable at ≤720px. Eyeball against the design
  taste before merge.

- [ ] **Step 3 — Commit.**

```bash
git add taskmanagement.css
git commit -m "style(taxonomy): panze warm-flat styling for Task setup"
```

---

## Testing (whole phase)

- **Parity (Part A):** Overdue/Done counts (sidebar, Home, Reports, Wallboard, per-view stat
  strips), the Done grouping/bucket, "Clear done", complete→reopen, and the clock-revert side
  effect all behave exactly as before the refactor for current data.
- **Admin CRUD (Part B):** add/rename/recolor/reorder/soft-delete round-trip for types,
  statuses, labels per company; exactly-one done + one default enforced (old flag clears first —
  no unique-index 409); a type's last status, its only done, and its only default cannot be
  removed; new type gets a usable starter pipeline.
- **Divergence smoke test:** in the admin screen, mark a *non-`done`* status as a type's done
  status for one type; create a task of that type; mark it complete — it uses the new done key
  and still counts as complete everywhere (this is the whole point of Part A). Then revert.
- **RLS/role:** worker sees no nav item and is denied the screen; admin can edit only their
  companies; a save that violates RLS surfaces a toast, not a silent failure.
- **Mobile:** admin screen + toggles usable ≤720px.

## Delivery / risk

- Everything runs on the **live production tables** (Phase 1). Part A is behaviour-preserving;
  Part B writes are RLS-guarded and soft (no hard deletes, no schema change) — worst case an
  admin mis-edits *labels/order*, fixable in the same screen. The `tasks_backup_20260702`
  snapshot from Phase 1 still exists as a longstop.
- Ship Part A, verify parity, **then** Part B — Part B is only safe to expose once completion is
  data-driven.
- Merge `feat/taxonomy-phase3` (which includes Phase 2) to `main` once verified on a Vercel
  preview; Vercel auto-deploys `main`.

## Deferred to Phase 4 (unchanged by this plan)

Dependent new-task/detail Status dropdowns (options = the selected type's statuses; type/company
switch resets to default), inline per-row taxonomy **colours** rendered on task cards/pills
(today colours still come from the preserved `cls` classes), and the new-task/detail
visual-hierarchy layout redesign.
