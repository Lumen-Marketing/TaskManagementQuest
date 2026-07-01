# Project Folders — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Author:** Claude + Shan
**Source:** Developer handoff doc ("Quest HQ — Project Folders") reconciled against the production repo. The handoff targets the `quest-hq-app.zip` prototype (`src/app.js`, hash routes, `quest-new-task.html`); this spec adapts its intent to the real Supabase + MVC codebase.

---

## 1. Goal

Let a task belong to a **project folder** so every task for one job (e.g. Mesa ADU, CNL Job) is grouped and managed together. One project → many tasks. Deliver the full feature in one spec: reconciliation migration, data loading, a reusable folder picker (file + inline-create), filing on the task surfaces, a Projects grid, and a project detail view.

## 2. Starting point (what already exists)

Migration `006_add_projects_schedules_and_unverified_profiles.sql` already shipped, so this is **not greenfield**:

- `public.projects` table exists, **company-scoped** (`company_id text not null references companies(id)`), with seed data (CNL Job, Paradise Valley Demo, Mesa Material Handoff, DraftTrack QA, Lumen Operations).
- `public.tasks.project_id text references projects(id)` exists + index `tasks_project_idx`.
- `public.schedules` exists and references `projects(id) on delete cascade` (not surfaced in this feature; left untouched).
- The app **round-trips** the link but never surfaces it: [`SupabaseDataStore.js:228`](../../../js/services/SupabaseDataStore.js) writes `project_id: task.project`, [`:493`](../../../js/services/SupabaseDataStore.js) reads it back as `task.project` (the id slug).

What is missing / wrong for this feature:

- The app **never loads the `projects` table** — `SupabaseDataStore.load()` fetches 6 tables, not projects. There is no `App.projects`, no picker, no grid, no detail.
- `projects` RLS is mig-006's **"any approved user"** (cross-company leak) — inconsistent with the company-scoped task policies.
- No `color` / `client` columns for the card UI.
- `tasks.project_id` FK is `NO ACTION` — deleting a folder would be blocked.
- Task search matches the raw `project` slug, not a human name ([`TaskModel.js:162`](../../../js/models/TaskModel.js)).
- "Projects overview" on the Home screen is a mislabeled status donut, unrelated to folders.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Scope | **Full feature in one spec** (migration + loading + picker + filing surfaces + grid + detail) |
| RLS | **Company-scoped**, mirroring the task policies (`company_id = any(current_company_ids())`, developer bypass) |
| Schema adds | `color` (folder swatch), `client` (card line), FK → **`on delete set null`** |
| Status enum | **Keep existing** `lead/active/hold/complete/cancelled`; treat `complete`/`cancelled` as "not active". No `archived` state. |
| Permissions | **Anyone can do anything** within their company — any company member may create, rename, recolor, delete, and file. No role gating beyond the company window. |
| Picker | **Dedicated reusable component** (Approach A), not an extension of the status/priority menu |

## 4. Data model (final, after migration 055)

```
projects
  id           text primary key          -- existing slugs; new folders get a generated text id
  company_id   text not null → companies -- existing; drives RLS + picker option scoping
  name         text not null
  color        text not null default '#8f867b'   -- NEW: swatch + task chip tint
  client       text                              -- NEW: "Client · …" card line (nullable)
  status       text default 'active'     -- lead | active | hold | complete | cancelled
  address      text
  budget       numeric(12,2)
  start_date   date
  due_date     date
  created_at   timestamptz
  updated_at   timestamptz               -- maintained by existing set_updated_at trigger

tasks.project_id  text → projects(id) ON DELETE SET NULL   -- CHANGED from NO ACTION
```

In-memory shape (`App.projects[id]`):

```js
{ id, name, color, client, status, address, dueDate, companyId }
// taskCount / openCount / doneCount are COMPUTED at render time, never stored.
```

## 5. Migration `supabase/sql/055_project_folders.sql`

Additive + policy rewrite, transaction-wrapped, idempotent. Applied **manually via the Supabase MCP** (like every other migration here) — not auto-run. Must also be applied to the **test** Supabase project.

1. `alter table public.projects add column if not exists color text not null default '#8f867b';`
2. `alter table public.projects add column if not exists client text;`
3. Re-point the FK:
   ```sql
   alter table public.tasks drop constraint if exists tasks_project_id_fkey;
   alter table public.tasks
     add constraint tasks_project_id_fkey
     foreign key (project_id) references public.projects(id) on delete set null;
   ```
   (Confirm the real constraint name via `list_tables` / `pg_constraint` first; `tasks_project_id_fkey` is the Postgres default for the mig-006 inline reference.)
4. Drop mig-006's four `"approved users can … projects"` policies and create company-scoped ones using the **existing** `public.current_company_ids()` helper (from mig 028):
   ```sql
   -- pattern for each verb (select/insert/update/delete); update also gets a matching with check
   using (
     public.current_profile_role() = 'developer'
     or company_id = any(public.current_company_ids())
   )
   ```
   No role gate beyond company membership (per "anyone can do anything"). The UPDATE `with check` uses the same predicate so a folder can't be moved into a company the caller doesn't belong to.

`schedules` policies and the `on delete cascade` from schedules → projects are left unchanged.

## 6. Data loading

- Add `this.supabase.from('projects').select('*').order('created_at', { ascending: true })` to the parallel fetch in [`SupabaseDataStore.load()`](../../../js/services/SupabaseDataStore.js) and return it in the result bag.
- Hydrate `App.projects` in [`js/app.js`](../../../js/app.js) exactly where `App.PEOPLE` is hydrated — a map keyed by `id`, values mapped to the in-memory shape above (`project_id`→`id`, `due_date`→`dueDate`, `company_id`→`companyId`).
- Add `dataStore.reloadProjects()` (re-fetch `projects`, rebuild `App.projects`) and a controller method that calls it then emits **`projects:changed`** on the EventBus. Views that render folders (grid, detail header, pickers, task chips) subscribe and re-render — mirroring how task/notification changes propagate today.
- **Counts computed at render time** from the already-loaded tasks (`open = tasks.filter(t => t.project === id && t.status !== 'done')`, `done = … === 'done'`). Never persist a counter.

## 7. `ProjectPickerView` (new component)

**One job:** pick or create a folder for one company and report the choice back. Location: `js/views/ProjectPickerView.js`.

**Interface:**
```js
open({ anchor, companyId, currentId, onSelect })
// anchor    — element to position against
// companyId — restricts the option list to this company's folders
// currentId — currently-filed project id (or null); shown checked
// onSelect(projectIdOrNull) — called with the chosen/created folder id, or null for "unfiled"
```

**Behavior:**
- Body-mounted `position:fixed` popover reusing the status menu's anchor + flip-above-when-no-room logic and outside-click / Esc / scroll dismissal.
- Contents: a **search input**, a **"No project (unfiled)"** row, then the company's folders as rows (**color dot · name · `N open`**). Current selection shows a check.
- Typing filters the list by name. If the query matches no existing folder, a **"Create '<query>'"** row appears; clicking it or pressing **Enter** creates the folder.
- Options are **company-scoped**: only `App.projects` whose `companyId === companyId`. RLS enforces the same server-side.
- Keyboard-operable (arrows / Enter / Esc), matching the status menu.

**Inline create** (`controller.createProject({ name, companyId })`):
1. Build a new folder: client-generated text `id` (slug of `name` + short unique suffix), `company_id = companyId`, `color =` default swatch (or next from a small rotating palette), `status = 'active'`.
2. Insert via the data store; on success `reloadProjects()` so `App.projects` includes it.
3. Resolve the picker's `onSelect(newId)`.

**Depends on:** `App.projects` (options), `controller.createProject` (create), the shared popover positioning helper. It does **not** know which surface invoked it.

## 8. Task-filing surfaces

Filing writes through the existing `updateTaskField(id, 'project', value)` path (the data store already maps `task.project` ↔ `project_id`); `value = null` unfiles.

1. **Create / Edit task form** — [`NewTaskPageView.js`](../../../js/views/NewTaskPageView.js) and the edit form in [`TaskDetailView.js`](../../../js/views/TaskDetailView.js): a **Project** field that opens `ProjectPickerView`, scoped to the form's selected **company**. On the create form you may pick an existing folder *or* type a new name; **on submit, if a new name was entered the project is created first (to obtain its id), then the task is created already filed into it.** A new inline folder inherits the task's company.
2. **Task detail** — a project chip (color dot + name, or a **"+ Project"** affordance when unfiled) in the meta area; click → picker.
3. **List row** — a compact `.projtag` chip (color dot + name) in the title cell of [`TaskListView.js`](../../../js/views/TaskListView.js) `_listRow`; click → picker to re-file. Shown only when filed; unfiled rows expose filing via the row's quick actions / detail (no always-on clutter in the dense list).

**Read-only elsewhere:** kanban cards, task cards, and calendar entries render a read-only color `.projtag` chip only (reusing the same style) — no picker in those layouts this pass.

## 9. Projects grid view

New top-level view, same pattern as `HomeView` / `ReportsView`.

- **Nav:** add a **"Projects"** item to [`SidebarView.js`](../../../js/views/SidebarView.js) and register the view / route in [`AppController.js`](../../../js/controllers/AppController.js).
- **Cards:** `.proj-grid` of `.proj-card`, one per company-visible folder: folder icon in the project `color`, `name`, `client` (or "No client"), `N open · M done`, and an optional progress bar + `due_date`.
- **Default filter:** show non-terminal folders (`status in ('lead','active','hold')`); a toggle reveals `complete` / `cancelled`.
- **New folder** button (anyone may create): a small create flow (name, **company**, color). Company defaults to the sidebar's currently-selected company; if that is "All companies" and the user belongs to several, show a company select (single-company users get their one company auto-selected). Calls `controller.createProject`.
- Clicking a card → the project detail (Section 10).

## 10. Project detail view

Reuse the existing task list rather than building a second task renderer.

- Add a single-value **`filters.projectId`** to the controller's filter state.
- When `filters.projectId` is set, the **List layout** renders a **project header** above the list — folder name, color, client, progress (open/done), due — and scopes the list to that folder's tasks (`t.project === projectId`).
- A **"New task"** button in the header opens the create form with the project **and its company** pre-selected.
- A card click sets `filters.projectId` and switches to the List layout; a **"← Projects"** / clear control resets `filters.projectId` and returns to the grid.

## 11. Search + filter integration

- Fix [`TaskModel.js:162`](../../../js/models/TaskModel.js) so task search matches the folder **name** via `App.projects[t.project]?.name`, not the raw slug.
- Add a **"Project"** column filter to the list header (multi-select), following the existing **Company** filter pattern in [`TaskListView.js`](../../../js/views/TaskListView.js) — options come from `App.projects`.

## 12. Permissions summary

All gated by the single **company-membership** window (developer = god mode), matching Section 5 RLS:

| Action | Who |
|---|---|
| See folders / file tasks | Any member of the folder's company |
| Create folder (grid button + inline) | Any company member |
| Rename / recolor / change status / delete | Any company member |

The UI shows create/edit/delete affordances to anyone with `tasks.write` in-company; RLS is the real enforcement.

## 13. Out of scope (this pass)

- The `schedules` table and any scheduling UI.
- Picker (re-file) on kanban / cards / calendar layouts — read-only chip only.
- Role-based folder guardrails (deliberately declined — "anyone can do anything").
- Backfilling project *names* on legacy tasks (mig 006 already backfilled `project_id`; new tasks store ids directly).
- Budget / start_date surfacing (columns exist; not shown yet).

## 14. Units (isolation view)

| Unit | Purpose | Interface | Depends on |
|---|---|---|---|
| `055_project_folders.sql` | Reconcile schema + RLS | SQL migration | `current_company_ids()` (mig 028) |
| Projects loading | Make folders available client-side | `App.projects`, `dataStore.reloadProjects()`, `projects:changed` | `SupabaseDataStore.load()`, `app.js` hydrate |
| `ProjectPickerView` | Pick/create a folder for one company | `open({anchor, companyId, currentId, onSelect})` | `App.projects`, `controller.createProject` |
| `controller.createProject` | Persist a new folder | `createProject({name, companyId}) → id` | data store insert, `reloadProjects()` |
| Task-filing surfaces | Set/clear a task's folder | `updateTaskField(id,'project',value)` | `ProjectPickerView`, existing task write path |
| `ProjectsView` (grid) | Browse folders as cards | nav view render | `App.projects`, tasks (counts), `createProject` |
| Project detail | Scope the task list to one folder | `filters.projectId` + header | `TaskListView`, filter state |
| Search / filter | Find + filter by folder | search match + column filter | `App.projects` |

## 15. Testing

- **E2E (Playwright, existing suite):**
  - Create a task with an inline-new project → task is filed into the new folder.
  - Re-file a task via the list-row chip and via the detail chip.
  - Delete a folder → its tasks become unfiled (not deleted).
  - Projects grid shows correct `open/done` counts; toggling reveals terminal folders.
  - Project detail scopes the list to one folder; "New task" pre-selects it.
- **Manual (`tests/manual-test-checklist.csv`):** add rows for the above, plus **manually verify cross-company folders are not visible** (RLS) — hard to assert in the JS suite.
- Apply migration 055 to the **test** Supabase project before running.

## 16. Notes / open items for Abraham

- Default folder `color` when created inline — single neutral default vs. a small rotating palette. Spec assumes a neutral default with room for a palette; confirm preferred swatches.
- Whether the Home "Projects overview" donut should be relabeled (it's a status donut, not folders) — cosmetic, deferred.
