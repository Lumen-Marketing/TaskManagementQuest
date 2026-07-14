# "Overall" Company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Overall" company that belongs to all companies — selectable when creating/editing a task, surfacing under every company view plus its own, and rendering an OVERALL pill everywhere a company is shown.

**Architecture:** `overall` is a pseudo-company in `App.COMPANIES` flagged `all: true`, stored on tasks as `company_id = 'overall'`. A single `App.utils.taskInCompany(task, companyId)` helper makes an Overall task match any real-company filter (and, when the scope *is* `overall`, match only Overall tasks). `App.taxonomy` synthesizes a cross-company union for `overall` via one change to its internal `co()` accessor. Visibility is unchanged: migration-028 RLS still gates on `profiles.company_ids`, so only users granted `'overall'` see/create these tasks (a data step, no migration).

**Tech Stack:** Zero-build static SPA (vanilla JS, no framework). Unit tests: `node --test` (`tests/unit/*.test.mjs`). CSS in `taskmanagement.css` / tokens in `tokens.css`.

## Global Constraints

- No build step; plain browser JS loaded via `<script>` in `app.html`. No new dependencies.
- CSS: tokens only, **no hardcoded hex**, **no hairline borders** (color + contrast do the work).
- Spec: `docs/superpowers/specs/2026-07-15-overall-company-design.md`.
- Semantics: `overall` = belongs to all companies. Visibility: only users whose `profiles.company_ids` includes `'overall'` (no migration).
- Taxonomy for `overall` = union of all real companies' active types/labels, deduped by `key` (first wins). Statuses for a type come from the first real company that defines it.
- Assignee/watcher roster and project list for an Overall task = full cross-company set (same as the `'*'` path).
- Git: stage **explicit paths only** (never `git add -A`/`.`). On Windows, `git add js/Directory.js` may silently stage nothing due to lowercase tracking — verify with `git status` after staging.
- Run unit tests on Windows with the glob quoted: `npm run test:unit`.

---

### Task 1: Overall pseudo-company + pill styling

**Files:**
- Modify: `js/constants.js:12-16` (add `overall` to `App.COMPANIES`)
- Modify: `taskmanagement.css:958-961` (add `.pill-overall`)

**Interfaces:**
- Produces: `App.COMPANIES.overall = { id:'overall', label:'Overall', pill:'pill-overall', all:true }`. Consumed by Tasks 2, 4, 5, 6, 7. `App.directory.company('overall')` returns this object (existing `Directory.company` already reads `App.COMPANIES`).

- [ ] **Step 1: Add the pseudo-company to constants**

In `js/constants.js`, change the `App.COMPANIES` block to:

```js
App.COMPANIES = {
  roofing:  { id: 'roofing',  label: 'Roofing',  pill: 'pill-roof'    },
  drafting: { id: 'drafting', label: 'Drafting', pill: 'pill-draft'   },
  lumen:    { id: 'lumen',    label: 'Lumen',    pill: 'pill-lumen'   },
  // "Overall" spans every company. `all: true` marks it as the spans-all
  // sentinel so code special-cases it without string-matching 'overall'.
  // Visibility is still RLS-gated on profiles.company_ids (migration 028):
  // only users granted 'overall' ever see or create Overall tasks.
  overall:  { id: 'overall',  label: 'Overall',  pill: 'pill-overall', all: true },
};
```

- [ ] **Step 2: Add the pill style**

In `taskmanagement.css`, immediately after the `.pill-website` line (`:961`), add:

```css
.pill-overall { background: var(--pastel-lilac); color: var(--pastel-lilac-ink); }
```

- [ ] **Step 3: Verify in a browser**

Run: `npm run dev`, open the app signed in as a developer (developers get all companies incl. `overall` via `initCompanyContext`). Open the New Task page and confirm an "Overall" row appears in the COMPANY dropdown with a lilac square. (Deeper wiring lands in later tasks; this is a smoke check that the constant + CSS are wired.)
Expected: "Overall" is listed; no JS console errors.

- [ ] **Step 4: Commit**

```bash
git add js/constants.js taskmanagement.css
git commit -m "feat(company): add Overall pseudo-company + pill"
```

---

### Task 2: `taskInCompany` helper + route client-side company filters through it

**Files:**
- Modify: `js/utils.js` (add `taskInCompany` method to the `App.utils` object)
- Test: `tests/unit/task-in-company.test.mjs` (create)
- Modify: `js/controllers/AppController.js:104`
- Modify: `js/models/TaskModel.js:107,134,160,193`
- Modify: `js/views/tasklist/WatchingLayout.js:19`

**Interfaces:**
- Produces: `App.utils.taskInCompany(task, companyId) -> boolean`. Consumed by AppController, TaskModel, WatchingLayout, and Task 7's filters.
- Contract: `'*'` or empty → always true (no filter). A real company id → true for that company OR for `overall` tasks. `companyId === 'overall'` → true **only** for `overall` tasks (the two `overall` terms collapse to a strict match, which gives the "Overall chip shows only Overall tasks" behavior for free).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/task-in-company.test.mjs`:

```js
// tests/unit/task-in-company.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const U = global.App.utils;

const roofing = { company: 'roofing' };
const overall = { company: 'overall' };

test("'*' and empty match everything (no filter)", () => {
  assert.equal(U.taskInCompany(roofing, '*'), true);
  assert.equal(U.taskInCompany(overall, '*'), true);
  assert.equal(U.taskInCompany(roofing, ''), true);
  assert.equal(U.taskInCompany(roofing, null), true);
});

test('a real-company scope matches that company AND overall tasks', () => {
  assert.equal(U.taskInCompany(roofing, 'roofing'), true);
  assert.equal(U.taskInCompany(overall, 'roofing'), true);   // spans all
  assert.equal(U.taskInCompany({ company: 'drafting' }, 'roofing'), false);
});

test("the 'overall' scope matches only overall tasks", () => {
  assert.equal(U.taskInCompany(overall, 'overall'), true);
  assert.equal(U.taskInCompany(roofing, 'overall'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/task-in-company.test.mjs`
Expected: FAIL — `U.taskInCompany is not a function`.

- [ ] **Step 3: Add the helper**

In `js/utils.js`, inside the `App.utils = { ... }` object (place it directly above `peopleInCompany`), add:

```js
  /* Does `companyId` (a scope/filter) select this task? '*' or empty means
     no company filter. A real company also matches Overall tasks (they span
     every company). When the scope IS 'overall', only Overall tasks match. */
  taskInCompany(task, companyId) {
    if (!companyId || companyId === '*') return true;
    const c = task && task.company;
    return c === companyId || c === 'overall';
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/task-in-company.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Route AppController's scope filter through the helper**

In `js/controllers/AppController.js:104`, replace:

```js
    if (cur && cur !== '*') base = base.filter(t => t.company === cur);
```

with:

```js
    if (cur && cur !== '*') base = base.filter(t => App.utils.taskInCompany(t, cur));
```

- [ ] **Step 6: Route TaskModel's four filters through the helper**

In `js/models/TaskModel.js`:

`:107` — `byCompany`:
```js
  byCompany(companyId) { return this.tasks.filter(t => App.utils.taskInCompany(t, companyId)); }
```

`:134` — replace `t.company === currentCompany || t.id === clockTaskId` with:
```js
      tasks = tasks.filter(t => App.utils.taskInCompany(t, currentCompany) || t.id === clockTaskId);
```

`:160` — replace `t.company === c` with:
```js
      tasks = tasks.filter(t => App.utils.taskInCompany(t, c));
```

`:193` — the multi-select company filter; replace
`if (f.companies && f.companies.length) tasks = tasks.filter(t => f.companies.includes(t.company));`
with:
```js
      if (f.companies && f.companies.length) {
        tasks = tasks.filter(t => f.companies.some(c => App.utils.taskInCompany(t, c)));
      }
```

- [ ] **Step 7: Route WatchingLayout through the helper**

In `js/views/tasklist/WatchingLayout.js:19`, replace `watched = watched.filter(t => t.company === cur)` with:

```js
    if (cur && cur !== '*') watched = watched.filter(t => App.utils.taskInCompany(t, cur));
```

- [ ] **Step 8: Run the full unit suite + manual scope check**

Run: `npm run test:unit`
Expected: PASS (all suites, including the new one).
Manual: with `npm run dev`, as a developer create a task with company Overall (picker wiring may be partial until Task 5 — you can also temporarily set a task's company to 'overall' in the DB), then switch the company scope between Roofing/Drafting/Lumen and confirm the Overall task shows under each; switch to the Overall scope and confirm only Overall tasks show.

- [ ] **Step 9: Commit**

```bash
git add js/utils.js tests/unit/task-in-company.test.mjs js/controllers/AppController.js js/models/TaskModel.js js/views/tasklist/WatchingLayout.js
git commit -m "feat(company): Overall tasks match every company filter via taskInCompany"
```

---

### Task 3: Full roster for Overall in `peopleInCompany`

**Files:**
- Modify: `js/utils.js:187-208` (`peopleInCompany`)
- Test: `tests/unit/people-in-company-overall.test.mjs` (create)

**Interfaces:**
- Consumes: `App.utils.activePeople` (existing).
- Produces: `peopleInCompany('overall', includeIds)` returns the full active roster (same as `'*'`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/people-in-company-overall.test.mjs`:

```js
// tests/unit/people-in-company-overall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const U = global.App.utils;

// Two people, each scoped to a different single company.
global.App.PROFILES = [
  { member_id: 'a', company_ids: ['roofing'] },
  { member_id: 'b', company_ids: ['drafting'] },
];
U.activePeople = () => [
  { id: 'a', company_ids: ['roofing'] },
  { id: 'b', company_ids: ['drafting'] },
];

test("'overall' returns the full roster (like '*')", () => {
  const all = U.peopleInCompany('overall').map(p => p.id).sort();
  assert.deepEqual(all, ['a', 'b']);
});

test('a real company still scopes to its members', () => {
  const roof = U.peopleInCompany('roofing').map(p => p.id);
  assert.deepEqual(roof, ['a']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/people-in-company-overall.test.mjs`
Expected: FAIL — `'overall'` currently intersects on a literal `'overall'` no profile has, so `peopleInCompany('overall')` returns only `includeIds` (here `[]`), not the full roster.

- [ ] **Step 3: Extend the early return**

In `js/utils.js:189`, replace:

```js
    if (!companyId || companyId === '*') return base;
```

with:

```js
    // 'overall' spans all companies → full roster, same as the '*' no-filter path.
    if (!companyId || companyId === '*' || companyId === 'overall') return base;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/people-in-company-overall.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add js/utils.js tests/unit/people-in-company-overall.test.mjs
git commit -m "feat(company): Overall tasks offer the full cross-company roster"
```

---

### Task 4: Taxonomy union for Overall

**Files:**
- Modify: `js/taxonomy.js:16` (the `co` accessor) + add a `unionCo()` helper
- Test: `tests/unit/taxonomy-overall.test.mjs` (create)

**Interfaces:**
- Produces: `App.taxonomy.activeTypes('overall')`, `activeLabels('overall')`, `activeStatuses('overall', type)`, `typeLabel/statusLabel/labelLabel('overall', ...)`, `defaultStatus/doneStatus('overall', type)` all resolve against a synthesized union. Because every accessor funnels through `co()`, one change covers them all.
- Contract: types/labels deduped by `key`, first real company wins; `statusesByType[type]` taken from the first real company that defines `type`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/taxonomy-overall.test.mjs`:

```js
// tests/unit/taxonomy-overall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {
  COMPANIES: { roofing: { id: 'roofing' }, drafting: { id: 'drafting' } },
  EventBus: { emit() {} },
};
require('../../js/taxonomy.js');
const T = global.App.taxonomy;

// roofing defines type 'lead'; drafting defines type 'bid' (+ a shared 'lead'
// with a different label to prove first-wins dedup).
T.hydrate({
  types: [
    { company_id: 'roofing',  key: 'lead', label: 'Lead',        sort_order: 0 },
    { company_id: 'drafting', key: 'lead', label: 'Draft Lead',  sort_order: 0 },
    { company_id: 'drafting', key: 'bid',  label: 'Bid',         sort_order: 1 },
  ],
  statuses: [
    { company_id: 'roofing',  type_key: 'lead', key: 'todo', label: 'To do', sort_order: 0, is_default: true },
    { company_id: 'roofing',  type_key: 'lead', key: 'done', label: 'Done',  sort_order: 1, is_done: true },
    { company_id: 'drafting', type_key: 'bid',  key: 'open', label: 'Open',  sort_order: 0, is_default: true },
  ],
  labels: [
    { company_id: 'roofing',  key: 'urgent', label: 'Urgent', sort_order: 0 },
    { company_id: 'drafting', key: 'urgent', label: 'RUSH',   sort_order: 0 },
    { company_id: 'drafting', key: 'perm',   label: 'Permit', sort_order: 1 },
  ],
});

test('activeTypes(overall) unions + dedupes by key (first wins)', () => {
  const keys = T.activeTypes('overall').map(t => t.key).sort();
  assert.deepEqual(keys, ['bid', 'lead']);
  assert.equal(T.typeLabel('overall', 'lead'), 'Lead'); // roofing wins
});

test('activeLabels(overall) unions + dedupes by key', () => {
  const keys = T.activeLabels('overall').map(l => l.key).sort();
  assert.deepEqual(keys, ['perm', 'urgent']);
});

test('activeStatuses(overall, type) resolves per originating company', () => {
  assert.deepEqual(T.activeStatuses('overall', 'lead').map(s => s.key), ['todo', 'done']);
  assert.deepEqual(T.activeStatuses('overall', 'bid').map(s => s.key), ['open']);
  assert.equal(T.defaultStatus('overall', 'lead'), 'todo');
  assert.equal(T.doneStatus('overall', 'lead'), 'done');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/taxonomy-overall.test.mjs`
Expected: FAIL — `activeTypes('overall')` returns `[]` (no `idx['overall']`).

- [ ] **Step 3: Add `unionCo()` and special-case `co('overall')`**

In `js/taxonomy.js`, replace line 16:

```js
  const co = (c) => idx[c] || empty();
```

with:

```js
  const co = (c) => (c === 'overall' ? unionCo() : (idx[c] || empty()));

  // Overall spans every company: merge each real company's taxonomy into one
  // index. Types/labels dedupe by key (first real company wins); a type's
  // statuses come from the first company that defines that type. Computed on
  // demand from `idx` so it always reflects the latest hydrate().
  function unionCo() {
    const out = empty();
    const seenType = new Set(), seenLabel = new Set();
    Object.keys(idx).forEach(cid => {
      if (cid === 'overall') return;
      const c = idx[cid];
      c.types.forEach(t => { if (!seenType.has(t.key)) { seenType.add(t.key); out.types.push(t); } });
      c.labels.forEach(l => { if (!seenLabel.has(l.key)) { seenLabel.add(l.key); out.labels.push(l); } });
      Object.keys(c.statusesByType).forEach(tk => {
        if (!out.statusesByType[tk]) out.statusesByType[tk] = c.statusesByType[tk];
      });
    });
    out.types.sort(bySort); out.labels.sort(bySort);
    return out;
  }
```

(Function declarations hoist, so referencing `unionCo` on the `co` line is fine even though it's defined just below.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/taxonomy-overall.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite (guard against regressions)**

Run: `npm run test:unit`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add js/taxonomy.js tests/unit/taxonomy-overall.test.mjs
git commit -m "feat(company): taxonomy union for Overall (types/labels/statuses)"
```

---

### Task 5: New Task page — Overall option, all-company projects, fallback guard

**Files:**
- Modify: `js/views/NewTaskPageView.js:74-80` (`_companyChoices`), `:264` (project items)

**Interfaces:**
- Consumes: `App.COMPANIES.overall` (Task 1), `App.taxonomy.*('overall')` (Task 4), `peopleInCompany('overall')` (Task 3 — already called via `_peopleFor`).
- Behavior: "Overall" shows in the COMPANY dropdown only when the user's accessible companies include it; selecting it populates Type/Label/Assignee/Watcher (already company-driven) and shows **all** projects.

- [ ] **Step 1: Guard the fallback so Overall never leaks to users without access**

`_companyChoices()` (`:74-80`) returns `uiState.companies` (which already contains `overall` only when the user was granted it, via `initCompanyContext`), falling back to `Object.keys(App.COMPANIES)` when empty. That fallback would leak `overall`. Read the current method, then change the fallback line:

```js
    if (!ids.length) ids = Object.keys(App.COMPANIES || {});
```

to:

```js
    if (!ids.length) ids = Object.keys(App.COMPANIES || {}).filter(id => id !== 'overall');
```

(The primary path — `uiState.companies` — is already correctly gated by `company_ids`, so no change there. The Overall option appears automatically for granted users.)

- [ ] **Step 2: Show all projects when company is Overall**

At `:264`:

```js
    const list = Object.values(App.projects || {}).filter(p => p.companyId === this.S.company);
```

replace with:

```js
    // Overall spans all companies → offer every project, not one company's.
    const list = this.S.company === 'overall'
      ? Object.values(App.projects || {})
      : Object.values(App.projects || {}).filter(p => p.companyId === this.S.company);
```

- [ ] **Step 3: Manual QA (as a user granted `'overall'`)**

Run: `npm run dev`. Sign in as a developer (has `overall`). New Task → COMPANY → pick **Overall**. Verify:
- Preview COMPANY row shows an OVERALL pill.
- ASSIGNEE / WATCHER lists show people from all companies.
- TYPE / LABEL dropdowns are populated (the union).
- PROJECT dropdown lists projects from every company.
- Fill title + assignee + due, create the task; it saves without an RLS error and appears in the list with an OVERALL pill (relies on Task 1 + the developer having `overall` access).

Then sign in / preview as a single-company **worker** (no `overall`): confirm **Overall is absent** from the COMPANY dropdown.
Expected: all of the above hold; no console errors.

- [ ] **Step 4: Commit**

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(newtask): Overall company option + all-company project picker"
```

---

### Task 6: Task Detail — Overall in the company-edit dropdown

**Files:**
- Modify: `js/views/TaskDetailView.js` (the company inline-edit menu builder)

**Interfaces:**
- Consumes: `App.COMPANIES`, `uiState.companies`.
- Behavior: the company chip's edit menu lists Overall only when the user's accessible companies include it; the chip/pill renders OVERALL for an Overall task (already works via `App.directory.company('overall')` from Task 1).

- [ ] **Step 1: Locate the company options builder**

Run: `grep -n "company" js/views/TaskDetailView.js` and find where the company inline-edit menu enumerates choices (the company chip → menu). Read that block.

- [ ] **Step 2: Gate the option list on accessible companies**

Build the company option list from `this.controller.uiState.companies` (filtered to real descriptors via `App.directory.company(id)`) rather than a hardcoded `App.COMPANIES` enumeration, so Overall appears exactly when the user has access — mirroring `NewTaskPageView._companyChoices`. Concretely, where the menu maps company ids to `<button>`s, source the ids from:

```js
    const companyIds = (this.controller.uiState.companies || [])
      .filter(id => id !== '*' && App.directory.company(id));
```

and map over `companyIds`. If the existing code already iterates `uiState.companies`, only add the `id !== '*'` guard and confirm `overall` flows through.

- [ ] **Step 3: Manual QA**

Run: `npm run dev`. Open an existing task as a developer, click the Company chip, and confirm **Overall** is in the menu; pick it and confirm the chip re-renders as an OVERALL pill and the change persists after reload. As a single-company worker, confirm Overall is absent from the menu.
Expected: holds; no console errors.

- [ ] **Step 4: Commit**

```bash
git add js/views/TaskDetailView.js
git commit -m "feat(task-detail): Overall option in the company edit menu"
```

---

### Task 7: Table + FilterBar — Overall chip / filter option

**Files:**
- Modify: `js/views/tasklist/TableLayout.js:29-34` (company chip row)
- Modify: `js/views/FilterBarView.js:45` (company filter group)

**Interfaces:**
- Consumes: `uiState.companies` (already contains `overall` when granted), `App.utils.taskInCompany` (Task 2).
- Behavior: an "Overall" chip appears (when the user has access) and, when selected, shows only Overall tasks (via `taskInCompany`'s strict-overall behavior — already wired in Task 2). No new filter logic needed here beyond surfacing the option.

- [ ] **Step 1: Confirm the table company chips include Overall**

Read `TableLayout.js:29-34`. The chip list is built from `uiState.companies` filtered by `App.directory.company(id)`. Since `overall` is a valid descriptor (Task 1) and is present in `uiState.companies` only when granted, the Overall chip appears automatically. Verify no code excludes `all`-flagged companies. If a `.sq` color is needed for the chip square, it inherits the pill palette; no change required.

- [ ] **Step 2: Confirm the FilterBar company group includes Overall**

Read `FilterBarView.js` around `:45` (`active: f.companies.includes(c.id)`) and find where `c` (the company list) is sourced. If it iterates `App.directory.companies()` (all of `App.COMPANIES`), that would show Overall to everyone — gate it to accessible companies:

```js
    const companyList = (this.controller.uiState.companies || [])
      .filter(id => id !== '*' && App.directory.company(id))
      .map(id => App.directory.company(id));
```

and iterate `companyList`. If it already sources from `uiState.companies`, leave as-is. The multi-select match logic was already routed through `taskInCompany` in Task 2 Step 6 (`:193`).

- [ ] **Step 3: Manual QA**

Run: `npm run dev` as a developer. In the Table view: confirm an **Overall** company chip is present; click it and confirm only Overall tasks show. Click **Roofing** and confirm Overall tasks *also* show (spans-all). In the FilterBar multi-select: select only Roofing and confirm Overall tasks appear; select only Overall and confirm just Overall tasks appear. As a single-company worker, confirm no Overall chip/option is shown.
Expected: holds; no console errors.

- [ ] **Step 4: Commit**

```bash
git add js/views/tasklist/TableLayout.js js/views/FilterBarView.js
git commit -m "feat(tasks): Overall chip in table + filter bar"
```

---

### Task 8: Display audit + CSV + setup SQL + final QA

**Files:**
- Modify (as needed): `js/services/CsvExport.js` (or wherever CSV company column renders — locate first)
- Modify (as needed): any Home/Reports company-breakdown renderer that enumerates `App.COMPANIES` and would now show a stray Overall bucket
- Modify: `docs/superpowers/specs/2026-07-15-overall-company-design.md` is the reference; add the grant SQL to a short `docs/overall-company-setup.md` runbook

**Interfaces:**
- Consumes: `App.directory.company('overall')` (renders OVERALL everywhere).

- [ ] **Step 1: Audit company render sites**

Run: `grep -rn "App.directory.company\|App.COMPANIES\|companyFallback" js/` and review each hit. For every site that renders a task's company as a pill/label, confirm an Overall task shows `OVERALL` (it will, since `directory.company('overall')` returns the descriptor). For every site that *enumerates all companies* to build a fixed UI (e.g., a Reports per-company column, a company legend), decide whether an Overall column belongs there; if not, filter it out with `.filter(c => !c.all)`.

- [ ] **Step 2: Verify CSV export**

Locate the CSV company column: `grep -rn "company" js/services/CsvExport.js` (and `tests/unit/csv-export.test.mjs`). Confirm it renders `App.directory.company(t.company)?.label` (or equivalent) so an Overall task exports `Overall`, not a raw id. If it maps a fixed company set, add `overall`. Run `node --test tests/unit/csv-export.test.mjs` and, if the export is label-driven, add/extend a case asserting an `overall` task exports `Overall`.
Expected: PASS.

- [ ] **Step 3: Write the setup runbook**

Create `docs/overall-company-setup.md`:

```markdown
# Enabling the "Overall" company

"Overall" tasks are gated by the same company RLS as every other task
(migration 028): a user only sees/creates them when `profiles.company_ids`
contains `'overall'`. There is no schema migration — this is a data grant.

Grant a user access (run in the Supabase SQL editor):

```sql
update public.profiles
set company_ids = array_append(company_ids, 'overall')
where id = '<auth-uuid>'
  and not ('overall' = any(company_ids));
```

Developers already see all companies (god-mode bypass in RLS), so they can
create Overall tasks without this grant. Single-company users without the
grant will not see the Overall option or Overall tasks — by design.
```

- [ ] **Step 4: Full regression + end-to-end QA**

Run: `npm run test:unit`
Expected: PASS (all suites).
Manual, as a granted user: create an Overall task; confirm OVERALL pill in the table row, task detail chip, New Task preview, and CSV export; confirm it appears under Roofing, Drafting, Lumen, and the Overall chip; confirm Type/Label/Assignee/Project were all selectable. As an ungranted single-company user: confirm the option is hidden and Overall tasks are not visible.

- [ ] **Step 5: Commit**

```bash
git add docs/overall-company-setup.md js/services/CsvExport.js
# plus any Home/Reports files touched in Step 1
git commit -m "feat(company): OVERALL display audit, CSV, and setup runbook"
```

---

## Self-Review

**Spec coverage:**
- Storage / pseudo-company → Task 1. ✓
- No-migration visibility + grant SQL → Task 8 Step 3 + noted in Tasks 5/6/7 gating. ✓
- Company picker gated on access (New Task + Task Detail) → Tasks 5, 6. ✓
- "Belongs to all companies" filter routing → Task 2. ✓
- Overall chip / explicit Overall view → Tasks 2 (strict-overall behavior) + 7 (surface the chip). ✓
- Display pills everywhere → Task 1 (pill) + Task 8 (audit incl. CSV/Home/Reports). ✓
- Taxonomy union → Task 4. ✓
- Assignee/Watcher full roster → Task 3. ✓
- All-company projects → Task 5 Step 2. ✓
- Tests → Tasks 2, 3, 4 (unit), 8 (CSV); UI tasks use manual QA (matches the repo's pure-logic-only unit harness). ✓

**Placeholder scan:** Tasks 6, 7, 8 contain "locate/read first" steps because the exact lines in `TaskDetailView.js`, `FilterBarView.js`, `CsvExport.js`, and Home/Reports aren't pinned in the spec; each still specifies the exact change and the concrete code to source ids from. No "TBD/handle edge cases" left. Acceptable.

**Type consistency:** `taskInCompany(task, companyId)`, `unionCo()`, `co(c)`, `peopleInCompany(companyId, includeIds)`, `App.COMPANIES.overall` used consistently across tasks.
