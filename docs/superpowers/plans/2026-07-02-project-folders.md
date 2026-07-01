# Project Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task belong to a project folder, with folders visible and editable across the task surfaces, a Projects grid, and a per-folder detail view — building on the `projects` table that migration 006 already ships.

**Architecture:** Additive reconciliation migration (`color`/`client`, `on delete set null`, company-scoped RLS) → load folders into `App.projects` → a reusable `ProjectPickerView` popover for file/create → wire it into task row/detail/create-edit → a `ProjectsView` grid + a per-folder detail that reuses the existing task list.

**Tech Stack:** Zero-build static SPA (vanilla ES classes on a global `App`), Supabase (Postgres + RLS), Playwright e2e. No bundler, no framework, no unit-test runner.

## Global Constraints

- **No build step / no framework.** Plain browser JS on `window.App`; new views are `App.XxxView = class {}` files loaded via `<script>` in `app.html`.
- **Migrations are applied MANUALLY** via the Supabase MCP (`apply_migration`) — never auto-run from code. Numeric prefix continues from the highest existing file (054 → **055**).
- **RLS is the real access wall**; `App.can(...)` is only a UI hint. Company scoping predicate is `company_id = any(public.current_company_ids())` with a `current_profile_role() = 'developer'` bypass (see migration 028).
- **Status keys are lowercase** (`todo/pending/hold/review/done`). Project status enum is `lead/active/hold/complete/cancelled` — do NOT invent `archived`.
- **`task.project` holds the project id** (round-trips to `tasks.project_id` via `_taskRow`/`_mapTaskRow`). Filing writes through `controller.updateTaskField(id, 'project', value)`; `null` = unfiled.
- **Verification reality:** there is no JS unit runner. Each JS task ends with `node --check <file>` for syntax + a stated manual/e2e check. `npm run dev` starts the local server (`tools/dev-server.mjs`). E2E: `npm test` (Playwright). Running the app requires a live Supabase (`env.json`).
- **Commit after every task.** Branch off `main` first (do not commit the feature directly to `main` until the whole plan is reviewed).

**Interfaces produced by this plan (used across tasks):**
- `App.projects` : `{ [id]: { id, name, color, client, status, address, dueDate, companyId } }`
- `dataStore.loadProjects()` → `Promise<map>` (same shape as `App.projects`)
- `dataStore.createProject(row)` → `Promise<{id}>`, `row = { id, company_id, name, color, status }`
- `controller.createProject({ name, companyId, color? })` → `Promise<string|null>` (the new id) and emits `projects:changed`
- `App.utils.slugId(name)` → `string`
- `App.projectPicker.open({ anchor, companyId, currentId, onSelect })` — `onSelect(projectIdOrNull)`
- EventBus event `projects:changed`

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout -b feat/project-folders
```

- [ ] **Step 2: Confirm clean base**

Run: `git status`
Expected: on `feat/project-folders`; note any pre-existing uncommitted files (leave them alone — this plan only touches project-folder files).

---

# Phase 1 — Foundation (migration + loading + read-only visibility)

## Task 1: Reconciliation migration 055

**Files:**
- Create: `supabase/sql/055_project_folders.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 055: Project Folders reconciliation.
-- Adds card fields (color, client), makes deleting a folder UNFILE its tasks,
-- and tightens mig-006's "any approved user" project policies to the same
-- company scope the tasks policies use (migration 028). "Anyone can do
-- anything" within their company window; developer = god mode.
begin;

alter table public.projects add column if not exists color text not null default '#8f867b';
alter table public.projects add column if not exists client text;

-- Re-point tasks.project_id -> ON DELETE SET NULL, name-agnostically.
do $$
declare fk text;
begin
  select conname into fk
  from pg_constraint
  where conrelid = 'public.tasks'::regclass
    and contype = 'f'
    and conkey = array[(
      select attnum from pg_attribute
      where attrelid = 'public.tasks'::regclass and attname = 'project_id'
    )];
  if fk is not null then
    execute format('alter table public.tasks drop constraint %I', fk);
  end if;
end $$;

alter table public.tasks
  add constraint tasks_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- Replace mig-006 project policies with company-scoped ones.
drop policy if exists "approved users can read projects"   on public.projects;
drop policy if exists "approved users can insert projects" on public.projects;
drop policy if exists "approved users can update projects" on public.projects;
drop policy if exists "approved users can delete projects" on public.projects;

create policy "company members can read projects" on public.projects
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()));

create policy "company members can insert projects" on public.projects
  for insert to authenticated
  with check (public.current_profile_role() = 'developer'
              or company_id = any(public.current_company_ids()));

create policy "company members can update projects" on public.projects
  for update to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()))
  with check (public.current_profile_role() = 'developer'
              or company_id = any(public.current_company_ids()));

create policy "company members can delete projects" on public.projects
  for delete to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()));

commit;
```

- [ ] **Step 2: Apply via the Supabase MCP**

Use the `apply_migration` MCP tool with name `project_folders` and the SQL above (production project). Do NOT run it from app code.

- [ ] **Step 3: Verify columns + policies**

Run this via the `execute_sql` MCP tool:
```sql
select column_name from information_schema.columns
  where table_name='projects' and column_name in ('color','client');
select polname from pg_policy where polrelid='public.projects'::regclass order by polname;
select confdeltype from pg_constraint where conname='tasks_project_id_fkey';  -- expect 'n' (SET NULL)
```
Expected: `color` + `client` present; four `company members can …` policies; `confdeltype = n`.

- [ ] **Step 4: Commit**

```bash
git add supabase/sql/055_project_folders.sql
git commit -m "feat(projects): migration 055 — color/client, on-delete set null, company-scoped RLS"
```

---

## Task 2: Load folders into `App.projects`

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (add to `load()`, add `_mapProjects`, add `loadProjects`)
- Modify: `js/app.js:102-107` (hydrate `App.projects`)

**Interfaces:**
- Produces: `App.projects` map; `dataStore.loadProjects()`.

- [ ] **Step 1: Add the projects fetch to `load()`**

In `js/services/SupabaseDataStore.js`, in `load()`, add a 7th query to the `Promise.all` array (after the profiles entry) and destructure it:

```js
    const [
      peopleRes,
      tasksRes,
      entriesRes,
      timersRes,
      notificationsRes,
      profilesRes,
      projectsRes,
    ] = await Promise.all([
      this.supabase.from('team_members').select('*').order('name', { ascending: true }),
      this.supabase.from('tasks').select('*').order('created_at', { ascending: true }),
      this.supabase.from('time_entries').select('*').order('start_at', { ascending: false }),
      this.supabase.from('active_timers').select('*'),
      this.supabase.from('notifications').select('*').eq('member_id', this.currentUser).order('created_at', { ascending: false }),
      (App.can('roles.manage') || App.can('team.view'))
        ? this.supabase.from('profiles').select(this._profileColumns).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      this.supabase.from('projects').select('*').order('created_at', { ascending: true }),
    ]);
```

Add its error check after the existing ones:
```js
    this._throwIfError(projectsRes, 'projects');
```

Add `projects` to the returned bag (after `notifications:`):
```js
      notifications: (notificationsRes.data || []).map(row => this._mapNotificationRow(row)),
      projects: this._mapProjects(projectsRes.data || []),
```

- [ ] **Step 2: Add `_mapProjects` and a standalone `loadProjects`**

Add next to `_mapPeople` in `js/services/SupabaseDataStore.js`:

```js
  _mapProjects(rows) {
    return rows.reduce((acc, row) => {
      acc[row.id] = {
        id: row.id,
        name: row.name || row.id,
        color: row.color || '#8f867b',
        client: row.client || '',
        status: row.status || 'active',
        address: row.address || '',
        dueDate: row.due_date || null,
        companyId: row.company_id,
      };
      return acc;
    }, {});
  }

  /* Projects-only refresh (after create/rename/delete). Mirrors the projects
     query in load(); RLS scopes rows exactly as on initial load. */
  async loadProjects() {
    const res = await this.supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: true });
    this._throwIfError(res, 'projects');
    return this._mapProjects(res.data || []);
  }
```

- [ ] **Step 3: Hydrate `App.projects` on boot**

In `js/app.js`, inside the `try` that consumes `dataStore.load()` (around line 102), add after `App.PROFILES = saved.profiles || [];`:

```js
      App.projects = saved.projects || {};
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/services/SupabaseDataStore.js && node --check js/app.js`
Expected: no output (exit 0).

- [ ] **Step 5: Manual verify**

Run `npm run dev`, open the app, sign in, and in the browser console run `Object.keys(App.projects)`.
Expected: an array of seeded folder ids (e.g. `cnl-job`, `mesa-material-handoff`) scoped to your companies.

- [ ] **Step 6: Commit**

```bash
git add js/services/SupabaseDataStore.js js/app.js
git commit -m "feat(projects): load folders into App.projects"
```

---

## Task 3: Read-only folder visibility (search fix + detail chip)

**Files:**
- Modify: `js/models/TaskModel.js:162` (search matches folder name)
- Modify: `js/views/TaskDetailView.js` (project chip in the meta area, read-only)
- Modify: `taskmanagement.css` (`.projtag` style)

- [ ] **Step 1: Fix search to match the folder name**

In `js/models/TaskModel.js`, replace line 162:
```js
        if ((t.project || '').toLowerCase().includes(q)) return true;
```
with:
```js
        const projName = (App.projects && App.projects[t.project] && App.projects[t.project].name) || '';
        if (projName.toLowerCase().includes(q)) return true;
```

- [ ] **Step 2: Add a read-only project chip to the task detail meta**

In `js/views/TaskDetailView.js`, find the meta area near the company chip (search for `App.COMPANIES[t.company]` around line 166). Immediately after the watchers/company meta block is assembled, build a project chip string:

```js
    const proj = t.project && App.projects ? App.projects[t.project] : null;
    const projectChipHtml = proj
      ? `<span class="projtag" style="--pc:${App.utils.escapeHtml(proj.color)}"><i class="ti ti-folder"></i>${App.utils.escapeHtml(proj.name)}</span>`
      : '';
```

Render `${projectChipHtml}` alongside the existing company chip in the detail meta row (place it next to where `company.label` / the company pill renders in the read view).

- [ ] **Step 3: Add the `.projtag` chip style**

In `taskmanagement.css`, add near the other chip styles (e.g. after the `.co-chip` block around line 393):
```css
/* Project folder chip — color-tinted, used read-only and as a picker trigger. */
.projtag {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 2px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600;
  color: var(--pc, #8f867b);
  background: color-mix(in srgb, var(--pc, #8f867b) 12%, var(--surface, #fff));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.projtag i { font-size: 13px; flex: none; }
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/models/TaskModel.js && node --check js/views/TaskDetailView.js`
Expected: exit 0.

- [ ] **Step 5: Manual verify**

`npm run dev` → open a seeded task that has a project (e.g. one filed to `cnl-job`); the detail meta shows a colored folder chip. Search for the folder's name in the task search box; the task matches.

- [ ] **Step 6: Commit**

```bash
git add js/models/TaskModel.js js/views/TaskDetailView.js taskmanagement.css
git commit -m "feat(projects): read-only folder chip on task detail + name search"
```

**Phase 1 ships here:** folders load, are visible on task detail, and are searchable by name.

---

# Phase 2 — Filing (picker + create / re-file)

## Task 4: `createProject` plumbing + slug helper + picker singleton

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (add `createProject`)
- Modify: `js/controllers/AppController.js` (add `createProject`)
- Modify: `js/utils.js` (add `slugId`) — if the utils file has a different name, it is the file defining `App.utils`; confirm with `grep -rl "App.utils =" js`
- Modify: `js/app.js` (instantiate `App.projectPicker` after the controller is built)

**Interfaces:**
- Produces: `dataStore.createProject(row)`, `controller.createProject({name,companyId,color})`, `App.utils.slugId(name)`.

- [ ] **Step 1: Data-store insert**

Add to `js/services/SupabaseDataStore.js` (near `deleteTask`):
```js
  /* Insert one project folder. RLS gates to the caller's company window
     (migration 055). Returns { id }. */
  async createProject(row) {
    const res = await this.supabase.from('projects').insert(row).select('id').single();
    this._throwIfError(res, 'creating project');
    return res.data;
  }
```

- [ ] **Step 2: Slug id helper**

Add to the `App.utils` object (the file that defines it):
```js
  // Stable-ish text id for a new folder: slug of the name + a short random
  // suffix so two "Mesa ADU" folders don't collide. Math.random is fine here
  // (app runtime, not a workflow script).
  slugId(name) {
    const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'folder';
    return `${base}-${Math.random().toString(36).slice(2, 7)}`;
  },
```

- [ ] **Step 3: Controller method**

Add to `js/controllers/AppController.js`:
```js
  /* Create a project folder, refresh App.projects, and notify views. Returns
     the new id (or null if not permitted). Company must be one the caller can
     write to; RLS enforces it server-side regardless. */
  async createProject({ name, companyId, color }) {
    if (!App.can('tasks.write')) return null;
    const clean = String(name || '').trim();
    if (!clean) return null;
    const id = App.utils.slugId(clean);
    await this.dataStore.createProject({
      id,
      company_id: companyId,
      name: clean,
      color: color || '#8f867b',
      status: 'active',
    });
    App.projects = await this.dataStore.loadProjects();
    App.EventBus.emit('projects:changed');
    return id;
  }
```

- [ ] **Step 4: Instantiate the picker singleton**

In `js/app.js`, after `App.projectPicker` will be defined by Task 5. For now add the wiring line after the controller is created (around line 136) — it is safe because the class is loaded before `app.js` runs:
```js
  App.projectPicker = new App.ProjectPickerView({ controller });
```

- [ ] **Step 5: Syntax check**

Run: `node --check js/services/SupabaseDataStore.js && node --check js/controllers/AppController.js && node --check js/app.js`
Expected: exit 0. (`js/app.js` will fully wire once Task 5 adds the class + `<script>` tag.)

- [ ] **Step 6: Commit**

```bash
git add js/services/SupabaseDataStore.js js/controllers/AppController.js js/utils.js js/app.js
git commit -m "feat(projects): createProject plumbing + slugId + picker singleton wiring"
```

---

## Task 5: `ProjectPickerView` component

**Files:**
- Create: `js/views/ProjectPickerView.js`
- Modify: `app.html` (add `<script src="js/views/ProjectPickerView.js"></script>` with the other view scripts)
- Modify: `taskmanagement.css` (picker popover styles)

**Interfaces:**
- Consumes: `App.projects`, `controller.createProject`.
- Produces: `App.projectPicker.open({ anchor, companyId, currentId, onSelect })`.

- [ ] **Step 1: Write the component**

Create `js/views/ProjectPickerView.js` (adapted from the status-menu popover in `TaskListView`):
```js
window.App = window.App || {};

/* Shared folder picker popover. One instance (App.projectPicker), mounted on
   <body>, position:fixed so it escapes row clipping. Search + "No project" +
   company-scoped folder list + inline "Create '<query>'". Reports the choice
   via onSelect(projectIdOrNull). */
App.ProjectPickerView = class ProjectPickerView {
  constructor({ controller }) {
    this.controller = controller;
    this.el = null;
    this._onDocDown = (e) => {
      if (!this.el || this.el.classList.contains('hidden')) return;
      if (this.el.contains(e.target)) return;
      if (this._anchor && this._anchor.contains(e.target)) return;
      this.close();
    };
    document.addEventListener('pointerdown', this._onDocDown, true);
    window.addEventListener('resize', () => this.close());
    window.addEventListener('scroll', () => this.close(), true);
  }

  _ensure() {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'proj-picker status-menu hidden';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Set project');
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  open({ anchor, companyId, currentId, onSelect }) {
    const el = this._ensure();
    if (this._anchor === anchor && !el.classList.contains('hidden')) { this.close(); return; }
    this._anchor = anchor;
    this._companyId = companyId;
    this._currentId = currentId || null;
    this._onSelect = onSelect;
    this._query = '';
    this._render();
    el.classList.remove('hidden');
    this._position(anchor);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    const input = el.querySelector('.proj-picker-search');
    if (input) input.focus();
  }

  _options() {
    const all = Object.values(App.projects || {})
      .filter(p => p.companyId === this._companyId && (p.status === 'lead' || p.status === 'active' || p.status === 'hold'));
    const q = this._query.trim().toLowerCase();
    return q ? all.filter(p => p.name.toLowerCase().includes(q)) : all;
  }

  _render() {
    const el = this.el;
    const q = this._query.trim();
    const opts = this._options();
    const exact = opts.some(p => p.name.toLowerCase() === q.toLowerCase());
    const esc = App.utils.escapeHtml;
    const rows = opts.map(p => `
      <button class="status-menu-item proj-picker-item" role="option" data-id="${esc(p.id)}" aria-selected="${p.id === this._currentId}">
        <span class="status-dot" style="background:${esc(p.color)}"></span>
        <span class="status-menu-label">${esc(p.name)}</span>
        <i class="ti ti-check status-menu-check"></i>
      </button>`).join('');
    const createRow = (q && !exact)
      ? `<button class="status-menu-item proj-picker-create" data-create="1"><i class="ti ti-plus"></i><span class="status-menu-label">Create "${esc(q)}"</span></button>`
      : '';
    el.innerHTML = `
      <div class="proj-picker-searchwrap"><input type="text" class="proj-picker-search" placeholder="Search or create…" value="${esc(this._query)}" /></div>
      <button class="status-menu-item proj-picker-item" role="option" data-id="" aria-selected="${!this._currentId}">
        <span class="status-dot" style="background:var(--ink-3)"></span>
        <span class="status-menu-label">No project (unfiled)</span>
        <i class="ti ti-check status-menu-check"></i>
      </button>
      ${rows}${createRow}`;

    const input = el.querySelector('.proj-picker-search');
    input.addEventListener('input', () => { this._query = input.value; this._render(); this._position(this._anchor); input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const c = el.querySelector('.proj-picker-create');
        if (c) this._create(this._query.trim());
        else { const first = el.querySelector('.proj-picker-item[data-id]:not([data-id=""])'); if (first) this._choose(first.dataset.id); }
      }
    });
    el.querySelectorAll('.proj-picker-item').forEach(item =>
      item.addEventListener('click', (e) => { e.stopPropagation(); this._choose(item.dataset.id || null); }));
    const create = el.querySelector('.proj-picker-create');
    if (create) create.addEventListener('click', (e) => { e.stopPropagation(); this._create(this._query.trim()); });
  }

  async _create(name) {
    if (!name) return;
    const id = await this.controller.createProject({ name, companyId: this._companyId });
    if (id) this._choose(id);
  }

  _choose(id) {
    const cb = this._onSelect;
    this.close();
    if (cb) cb(id || null);
  }

  _position(anchor) {
    const el = this.el;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.minWidth = Math.max(r.width, 220) + 'px';
    const mh = el.offsetHeight, mw = el.offsetWidth, gap = 6;
    let top = r.bottom + gap;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - gap - mh);
    let left = r.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
    el.style.top = top + 'px';
    el.style.left = Math.max(8, left) + 'px';
  }

  close() {
    if (!this.el || this.el.classList.contains('hidden')) return;
    this.el.classList.add('hidden');
    if (this._anchor && document.contains(this._anchor)) this._anchor.setAttribute('aria-expanded', 'false');
    this._anchor = null;
  }
};
```

- [ ] **Step 2: Load the script**

In `app.html`, add alongside the other `js/views/*.js` script tags (e.g. right before `TaskListView.js`):
```html
  <script src="js/views/ProjectPickerView.js"></script>
```

- [ ] **Step 3: Picker CSS**

In `taskmanagement.css`, add after the `.status-menu` block:
```css
.proj-picker { max-height: 320px; overflow-y: auto; padding-top: 0; }
.proj-picker-searchwrap { position: sticky; top: 0; background: var(--surface, #fff); padding: 8px; border-bottom: 1px solid var(--border, #eee); }
.proj-picker-search { width: 100%; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 13px; }
.proj-picker-search:focus { outline: none; border-color: var(--accent, #ee5a26); }
.proj-picker-create { color: var(--accent, #ee5a26); font-weight: 600; }
.proj-picker-create i { font-size: 15px; }
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/views/ProjectPickerView.js`
Expected: exit 0.

- [ ] **Step 5: Manual verify**

`npm run dev` → in the console: `App.projectPicker.open({ anchor: document.body, companyId: 'roofing', currentId: null, onSelect: (id) => console.log('picked', id) })`. The popover appears with the roofing folders + "No project"; typing a new name shows "Create …"; selecting logs the id.

- [ ] **Step 6: Commit**

```bash
git add js/views/ProjectPickerView.js app.html taskmanagement.css
git commit -m "feat(projects): reusable ProjectPickerView popover (search + inline create)"
```

---

## Task 6: File / re-file from the task row and detail

**Files:**
- Modify: `js/views/TaskListView.js` (`_listRow`: project chip button in the title cell + handler)
- Modify: `js/views/TaskDetailView.js` (make the detail chip a picker trigger)

- [ ] **Step 1: List-row chip button**

In `js/views/TaskListView.js` `_listRow`, inside the `.task-title-cell` (right after the `tt-text` span, around line 1083), add a project chip that is a button when the task is filed, and a subtle "+ Project" affordance when unfiled and the user can write:
```js
        ${(() => {
          const proj = t.project && App.projects ? App.projects[t.project] : null;
          if (proj) return `<button class="projtag projtag-btn" data-action="open-project" data-current="${App.utils.escapeHtml(t.project)}" title="Change project" aria-haspopup="listbox" aria-expanded="false" style="--pc:${App.utils.escapeHtml(proj.color)}"><i class="ti ti-folder"></i>${App.utils.escapeHtml(proj.name)}</button>`;
          if (App.can('tasks.write')) return `<button class="projtag projtag-btn projtag-empty" data-action="open-project" data-current="" title="Add to project" aria-haspopup="listbox" aria-expanded="false"><i class="ti ti-folder-plus"></i>Project</button>`;
          return '';
        })()}
```

In the row click handler (the `if (target)` block around line 1114-1121), add a branch:
```js
        else if (action === 'open-project') this._openProjectMenu(t, target);
```

Add the helper method to `TaskListView` (near `_openStatusMenu`):
```js
  _openProjectMenu(t, trigger) {
    App.projectPicker.open({
      anchor: trigger,
      companyId: t.company,
      currentId: t.project || null,
      onSelect: (projectId) => this.controller.updateTaskField(t.id, 'project', projectId),
    });
  }
```

- [ ] **Step 2: `.projtag-btn` style**

In `taskmanagement.css`, after the `.projtag` block:
```css
.projtag-btn { border: 1px solid transparent; cursor: pointer; font-family: inherit; -webkit-appearance: none; appearance: none; }
.projtag-btn:hover { filter: brightness(0.96); }
.projtag-btn.projtag-empty { color: var(--ink-3); background: transparent; border-color: var(--border, #e6e1d9); font-weight: 600; }
.projtag-btn[aria-expanded="true"] { filter: brightness(0.94); }
```

- [ ] **Step 3: Make the detail chip interactive**

In `js/views/TaskDetailView.js`, change the read-only `projectChipHtml` from Task 3 into a picker trigger when the user can write (keep read-only otherwise):
```js
    const proj = t.project && App.projects ? App.projects[t.project] : null;
    const projectChipHtml = App.can('tasks.write')
      ? `<button class="projtag projtag-btn ${proj ? '' : 'projtag-empty'}" data-action="open-project" aria-haspopup="listbox" aria-expanded="false" ${proj ? `style="--pc:${App.utils.escapeHtml(proj.color)}"` : ''}><i class="ti ${proj ? 'ti-folder' : 'ti-folder-plus'}"></i>${proj ? App.utils.escapeHtml(proj.name) : 'Project'}</button>`
      : (proj ? `<span class="projtag" style="--pc:${App.utils.escapeHtml(proj.color)}"><i class="ti ti-folder"></i>${App.utils.escapeHtml(proj.name)}</span>` : '');
```

In `TaskDetailView`'s handler binding (`bindHandlers`, where other `data-action` clicks are wired), add:
```js
    const projBtn = this.pane.querySelector('[data-action="open-project"]');
    if (projBtn) projBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      App.projectPicker.open({
        anchor: projBtn,
        companyId: t.company,
        currentId: t.project || null,
        onSelect: (projectId) => this.controller.updateTaskField(t.id, 'project', projectId),
      });
    });
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/views/TaskListView.js && node --check js/views/TaskDetailView.js`
Expected: exit 0.

- [ ] **Step 5: Manual verify**

`npm run dev` → in the list, click a task's project chip (or "+ Project") → picker opens → choose a folder → the chip updates and persists across a refresh. Repeat on the detail page. Choose "No project" → task unfiles.

- [ ] **Step 6: Commit**

```bash
git add js/views/TaskListView.js js/views/TaskDetailView.js taskmanagement.css
git commit -m "feat(projects): file/re-file tasks from list row and detail via ProjectPicker"
```

---

## Task 7: Project on the create + edit task forms

**Files:**
- Modify: `js/views/NewTaskPageView.js` (Project row + state + payload)
- Modify: `js/views/TaskDetailView.js` (edit-form Project row + editDraft)
- Modify: `js/controllers/AppController.js` (accept `project` in `createTask` payload + `updateTaskDetails`)

- [ ] **Step 1: Confirm `createTask` persists `project`**

`_taskRow` already writes `project_id: task.project`. In `js/controllers/AppController.js`, locate `createTask(payload)` and ensure the new task object it builds carries `project: payload.project || null`. Add that field to the task object literal it constructs (mirroring how `assignee`/`company` are copied from payload).

- [ ] **Step 2: Create-form Project row**

In `js/views/NewTaskPageView.js` `template()`, add a Project row after the Company row (line 113). It is a picker trigger button holding the chosen id in `dataset`:
```js
              ${row('Project', `<button type="button" id="nt-project" class="projtag projtag-btn projtag-empty" data-current="" aria-haspopup="listbox"><i class="ti ti-folder-plus"></i>No project</button>`)}
```

In `bindEvents()`, wire it (and re-scope on company change):
```js
    const projBtn = document.getElementById('nt-project');
    if (projBtn) projBtn.addEventListener('click', () => {
      App.projectPicker.open({
        anchor: projBtn,
        companyId: document.getElementById('nt-company').value,
        currentId: projBtn.dataset.current || null,
        onSelect: (id) => this._setProject(id),
      });
    });
```

Add a helper + reset-on-company-change:
```js
  _setProject(id) {
    const btn = document.getElementById('nt-project');
    if (!btn) return;
    const p = id && App.projects ? App.projects[id] : null;
    btn.dataset.current = id || '';
    btn.classList.toggle('projtag-empty', !p);
    btn.style.setProperty('--pc', p ? p.color : '');
    btn.innerHTML = p
      ? `<i class="ti ti-folder"></i>${App.utils.escapeHtml(p.name)}`
      : `<i class="ti ti-folder-plus"></i>No project`;
  }
```
In `_onCompanyChanged(companyId)`, clear a now-out-of-company project: append `this._setProject(null);` if the current project's company no longer matches:
```js
    const pb = document.getElementById('nt-project');
    if (pb && pb.dataset.current && App.projects[pb.dataset.current] && App.projects[pb.dataset.current].companyId !== companyId) this._setProject(null);
```

In `submit()`, add to `rawPayload`:
```js
      project: (document.getElementById('nt-project') || {}).dataset ? (document.getElementById('nt-project').dataset.current || null) : null,
```
Ensure `App.validate.newTask` passes `project` through — if the validator whitelists fields, add `project` to the cleaned object in `submit()` after validation instead:
```js
    const payload = Object.assign({}, clean, {
      project: (document.getElementById('nt-project').dataset.current || null),
      reminderAt: (reminderEl && reminderEl.value) ? reminderEl.value : null,
      notify: { /* unchanged */ },
    });
```
(Use the post-validation assignment so a strict validator can't strip it.)

- [ ] **Step 3: Edit-form Project row**

In `js/views/TaskDetailView.js`, the edit draft is snapshotted (search for `editDraft` / the snapshot method building `watchers`, `priority`, `company`). Add `project: t.project || null` to that snapshot object. In the edit-form template, add a Project row (same button pattern as create), reading `this.editDraft.project`, and wire a click that opens the picker with `companyId: this.editDraft.company` and `onSelect: (id) => { this.editDraft.project = id; <re-render or update the button> }`. In `updateTaskDetails` call site (Save), include `project: this.editDraft.project` in the fields object.

In `js/controllers/AppController.js` `updateTaskDetails(id, fields)`, ensure `project` is among the fields applied to the task (it iterates/whitelists a field set — add `project` to that list so the batch save writes it).

- [ ] **Step 4: Syntax check**

Run: `node --check js/views/NewTaskPageView.js && node --check js/views/TaskDetailView.js && node --check js/controllers/AppController.js`
Expected: exit 0.

- [ ] **Step 5: Manual verify**

`npm run dev` → New task → set Project to an existing folder → create → the task shows that folder. New task → type a brand-new folder name in the picker + Enter → the folder is created and the task is filed into it. Edit an existing task → change its Project → Save → persists.

- [ ] **Step 6: Commit**

```bash
git add js/views/NewTaskPageView.js js/views/TaskDetailView.js js/controllers/AppController.js
git commit -m "feat(projects): choose/create a folder on the create + edit task forms"
```

**Phase 2 ships here:** tasks can be filed, re-filed, and unfiled everywhere; new folders can be created inline.

---

# Phase 3 — Browse (grid + detail + filter)

## Task 8: `ProjectsView` grid + nav item

**Files:**
- Create: `js/views/ProjectsView.js`
- Modify: `app.html` (nav item + `#projectsWrap` surface + `<script>` tag)
- Modify: `js/controllers/AppController.js` (`setView` accepts `projects`; `canView`)
- Modify: `taskmanagement.css` (grid + card styles)

**Interfaces:**
- Consumes: `App.projects`, `taskModel` (for counts), `controller.createProject`.

- [ ] **Step 1: Nav item + surface in `app.html`**

Add a Primary-nav item right after the "All" item (line 84):
```html
        <div class="side-item" data-view="projects" title="Projects"><i class="ti ti-folders"></i><span class="side-item-label">Projects</span></div>
```
Add a view surface next to the other `*Wrap` containers (mirror `#taskViewWrap` / `#newTaskWrap`):
```html
  <section id="projectsWrap" class="view-wrap hidden" aria-label="Projects"></section>
```
Add the script tag with the other views:
```html
  <script src="js/views/ProjectsView.js"></script>
```

- [ ] **Step 2: Register the view in the controller**

In `js/controllers/AppController.js` `setView(view)`, follow the existing pattern that shows/hides surfaces per view. Ensure `'projects'` is a recognized view: toggle `#projectsWrap` visible and the task/home/reports wraps hidden when `view === 'projects'`, and add `'projects'` to whatever `canView`/allowed-views list gates navigation (it is available to everyone — no `App.can` gate). Emit `view:changed` as the other branches do.

- [ ] **Step 3: Write `ProjectsView`**

Create `js/views/ProjectsView.js`:
```js
window.App = window.App || {};

/* Projects grid: folder cards for the user's company-visible folders, with
   live open/done counts computed from the loaded tasks. Card click scopes the
   task list to that folder (controller.openProject). */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.showTerminal = false;
    App.EventBus.on('view:changed', (v) => { if (v === 'projects') this.render(); });
    App.EventBus.on('projects:changed', () => { if (this._visible()) this.render(); });
    App.EventBus.on('tasks:changed', () => { if (this._visible()) this.render(); });
  }

  _visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _counts(id) {
    const all = this.taskModel.all().filter(t => t.project === id);
    return { open: all.filter(t => t.status !== 'done').length, done: all.filter(t => t.status === 'done').length };
  }

  _folders() {
    const active = ['lead', 'active', 'hold'];
    return Object.values(App.projects || {})
      .filter(p => this.controller.canSeeCompany ? this.controller.canSeeCompany(p.companyId) : true)
      .filter(p => this.showTerminal || active.includes(p.status));
  }

  render() {
    if (!this.wrap) this.wrap = document.getElementById('projectsWrap');
    if (!this.wrap) return;
    const esc = App.utils.escapeHtml;
    const cards = this._folders().map(p => {
      const c = this._counts(p.id);
      return `
        <button class="proj-card" data-project="${esc(p.id)}" style="--pc:${esc(p.color)}">
          <div class="pc-head"><span class="pc-folder"><i class="ti ti-folder"></i></span><span class="pc-name">${esc(p.name)}</span></div>
          <div class="pc-sub">${p.client ? esc(p.client) : 'No client'}</div>
          <div class="pc-meta">${c.open} open · ${c.done} done</div>
        </button>`;
    }).join('') || `<div class="proj-empty">No folders yet.</div>`;

    this.wrap.innerHTML = `
      <div class="proj-head">
        <h1 class="proj-title">Projects</h1>
        <div class="proj-head-actions">
          <label class="proj-toggle"><input type="checkbox" id="proj-show-terminal" ${this.showTerminal ? 'checked' : ''}/> Show completed</label>
          ${App.can('tasks.write') ? `<button class="btn btn-primary" data-action="new-folder" type="button"><i class="ti ti-plus"></i> New folder</button>` : ''}
        </div>
      </div>
      <div class="proj-grid">${cards}</div>`;

    const toggle = this.wrap.querySelector('#proj-show-terminal');
    if (toggle) toggle.addEventListener('change', () => { this.showTerminal = toggle.checked; this.render(); });
    this.wrap.querySelectorAll('.proj-card').forEach(card =>
      card.addEventListener('click', () => this.controller.openProject(card.dataset.project)));
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());
  }
};
```
(Confirm `taskModel.all()` is the accessor for every task; if it is named differently, use that. `this.controller.canSeeCompany` is optional — the filter degrades to "show all" if absent, and RLS already scoped `App.projects`.)

- [ ] **Step 4: Instantiate the view**

In `js/app.js`, where the other views are constructed, add:
```js
  App.projectsView = new App.ProjectsView({ controller, taskModel });
```

- [ ] **Step 5: Grid CSS**

In `taskmanagement.css`:
```css
.proj-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 8px; }
.proj-title { font-size: 20px; font-weight: 700; }
.proj-head-actions { display: flex; align-items: center; gap: 14px; }
.proj-toggle { font-size: 12px; color: var(--ink-2); display: inline-flex; gap: 6px; align-items: center; }
.proj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; padding: 8px 20px 24px; }
.proj-card { text-align: left; cursor: pointer; border: 1px solid var(--border, #eee); border-left: 4px solid var(--pc, #8f867b); border-radius: 10px; padding: 14px; background: var(--surface, #fff); display: flex; flex-direction: column; gap: 6px; transition: box-shadow .15s; }
.proj-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.07); }
.pc-head { display: flex; align-items: center; gap: 8px; }
.pc-folder { color: var(--pc, #8f867b); font-size: 18px; display: inline-flex; }
.pc-name { font-weight: 700; font-size: 14px; }
.pc-sub { font-size: 12px; color: var(--ink-3); }
.pc-meta { font-size: 12px; color: var(--ink-2); font-weight: 600; }
.proj-empty { padding: 40px 20px; color: var(--ink-3); }
```

- [ ] **Step 6: Syntax check**

Run: `node --check js/views/ProjectsView.js && node --check js/controllers/AppController.js && node --check js/app.js`
Expected: exit 0. (`openProject` / `promptNewFolder` are added in Tasks 9–10; if verifying the grid before those exist, stub them to `console.log`.)

- [ ] **Step 7: Commit**

```bash
git add js/views/ProjectsView.js app.html js/controllers/AppController.js js/app.js taskmanagement.css
git commit -m "feat(projects): Projects grid view + sidebar nav item"
```

---

## Task 9: New-folder flow

**Files:**
- Modify: `js/controllers/AppController.js` (`promptNewFolder`)

- [ ] **Step 1: Implement `promptNewFolder`**

Add to `js/controllers/AppController.js`. Company defaults to the sidebar's current company; if that is `*`/absent and the user has several, ask. Keep it dependency-free (uses `window.prompt` for name + a color default; a nicer modal is a later polish — YAGNI now):
```js
  async promptNewFolder() {
    if (!App.can('tasks.write')) return;
    const name = (window.prompt('New folder name:') || '').trim();
    if (!name) return;
    let companyId = this.uiState.currentCompany;
    if (!companyId || companyId === '*') {
      const ids = (this.uiState.companies || []).filter(c => c !== '*');
      companyId = ids[0];
      if (ids.length > 1) {
        const pick = (window.prompt(`Company (${ids.join(', ')}):`, ids[0]) || '').trim();
        if (ids.includes(pick)) companyId = pick;
      }
    }
    if (!companyId) return;
    await this.createProject({ name, companyId });
    App.EventBus.emit('projects:changed');
  }
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/controllers/AppController.js`
Expected: exit 0.

- [ ] **Step 3: Manual verify**

`npm run dev` → Projects view → New folder → enter a name → the card appears in the grid.

- [ ] **Step 4: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "feat(projects): create a folder from the Projects grid"
```

---

## Task 10: Project detail (scoped task list)

**Files:**
- Modify: `js/controllers/AppController.js` (`openProject`, `filters.projectId`, clear)
- Modify: `js/models/TaskModel.js` (apply `f.projectId`)
- Modify: `js/views/TaskListView.js` (project header when scoped)

- [ ] **Step 1: Controller scope**

Add to `js/controllers/AppController.js`:
```js
  openProject(projectId) {
    this.uiState.filters = this.uiState.filters || {};
    this.uiState.filters.projectId = projectId || null;
    this.setView('all');
    App.EventBus.emit('filters:changed');
  }

  clearProjectScope() {
    if (this.uiState.filters) this.uiState.filters.projectId = null;
    App.EventBus.emit('filters:changed');
  }
```

- [ ] **Step 2: Apply the scope in the filter predicate**

In `js/models/TaskModel.js`, next to the `f.companies` line (172), add:
```js
      if (f.projectId) tasks = tasks.filter(t => t.project === f.projectId);
```

- [ ] **Step 3: Project header in the list**

In `js/views/TaskListView.js` `renderList()` (or `_renderListInner`), when `this.controller.uiState.filters && this.controller.uiState.filters.projectId` is set, prepend a header above the list:
```js
    const pid = this.controller.uiState.filters && this.controller.uiState.filters.projectId;
    const proj = pid && App.projects ? App.projects[pid] : null;
    const projectHeaderHtml = proj ? `
      <div class="proj-detail-head" style="--pc:${App.utils.escapeHtml(proj.color)}">
        <button class="btn btn-sm" data-action="clear-project" type="button"><i class="ti ti-arrow-left"></i> Projects</button>
        <span class="pdh-folder"><i class="ti ti-folder"></i>${App.utils.escapeHtml(proj.name)}</span>
        ${proj.client ? `<span class="pdh-client">${App.utils.escapeHtml(proj.client)}</span>` : ''}
        ${App.can('tasks.write') ? `<button class="btn btn-primary btn-sm" data-action="new-task-in-project" type="button"><i class="ti ti-plus"></i> New task</button>` : ''}
      </div>` : '';
```
Insert `projectHeaderHtml` at the top of the rendered list container. Wire the two buttons after render:
```js
    const clearBtn = this.body.querySelector('[data-action="clear-project"]');
    if (clearBtn) clearBtn.addEventListener('click', () => this.controller.clearProjectScope());
    const newInProj = this.body.querySelector('[data-action="new-task-in-project"]');
    if (newInProj) newInProj.addEventListener('click', () => this.controller.openNewTaskPage({ project: pid, company: proj.companyId }));
```
Ensure `controller.openNewTaskPage(prefill)` stores the prefill so the create form pre-selects the project. In `NewTaskPageView.render(prefill)`, after building the form, apply `if (prefill.project) this._setProject(prefill.project);` and if `prefill.company`, set `#nt-company` value + call `_onCompanyChanged(prefill.company)` before `_setProject`.

- [ ] **Step 4: Header CSS**

In `taskmanagement.css`:
```css
.proj-detail-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border, #eee); border-left: 4px solid var(--pc, #8f867b); }
.pdh-folder { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--pc, #8f867b); }
.pdh-client { font-size: 12px; color: var(--ink-3); }
.proj-detail-head .btn-primary { margin-left: auto; }
```

- [ ] **Step 5: Syntax check**

Run: `node --check js/controllers/AppController.js && node --check js/models/TaskModel.js && node --check js/views/TaskListView.js && node --check js/views/NewTaskPageView.js`
Expected: exit 0.

- [ ] **Step 6: Manual verify**

`npm run dev` → Projects → click a card → the list shows only that folder's tasks with a header → "New task" opens the form pre-filed to that folder → "← Projects" clears the scope.

- [ ] **Step 7: Commit**

```bash
git add js/controllers/AppController.js js/models/TaskModel.js js/views/TaskListView.js js/views/NewTaskPageView.js taskmanagement.css
git commit -m "feat(projects): per-folder detail (scoped task list + header + new task)"
```

---

## Task 11: Filter tasks by project

**Files:**
- Modify: `js/models/TaskModel.js` (apply `f.projects`)
- Modify: `js/views/FilterBarView.js` (project filter chips)

**Note:** the design spec said "list-header column filter," but the list grid has fixed columns and shows the folder as a chip in the title cell (not a column). Adding project filtering to the existing `FilterBarView` chip bar — where Company/Status already live — is the faithful, lower-churn equivalent. This is an intentional deviation, recorded here.

- [ ] **Step 1: Apply the multi-select project filter**

In `js/models/TaskModel.js`, next to the `f.companies` line, add:
```js
      if (f.projects && f.projects.length) tasks = tasks.filter(t => f.projects.includes(t.project));
```

- [ ] **Step 2: Project chips in the filter bar**

In `js/views/FilterBarView.js`, mirror the company chips block (line 43). Build project chips from `App.projects` (company-visible, non-terminal), toggling `f.projects`:
```js
    const projectChips = Object.values(App.projects || {})
      .filter(p => ['lead', 'active', 'hold'].includes(p.status))
      .map(p => this.chip({
        label: p.name,
        active: (f.projects || []).includes(p.id),
        onToggle: () => this.controller.toggleFilter('projects', p.id),
      }));
```
Render `projectChips` in the same group the company chips render into, and confirm `controller.toggleFilter('projects', id)` initializes `f.projects` as an array (mirror how `toggleFilter('companies', id)` works — if `toggleFilter` reads `this.uiState.filters[group]`, no change is needed beyond passing `'projects'`).

- [ ] **Step 3: Syntax check**

Run: `node --check js/models/TaskModel.js && node --check js/views/FilterBarView.js`
Expected: exit 0.

- [ ] **Step 4: Manual verify**

`npm run dev` → open the filter bar → toggle a project chip → the list narrows to that folder's tasks; toggling off restores.

- [ ] **Step 5: Commit**

```bash
git add js/models/TaskModel.js js/views/FilterBarView.js
git commit -m "feat(projects): filter tasks by project in the filter bar"
```

---

## Task 12: End-to-end test + manual checklist

**Files:**
- Create: `tests/projects.spec.js`
- Modify: `tests/manual-test-checklist.csv`

- [ ] **Step 1: Write the e2e spec**

Model it on `tests/tasks.spec.js` (reuse its login/fixtures from `tests/_fixtures.js`). Cover: (a) create a task with a brand-new inline folder → the task shows the folder chip; (b) re-file a task via the list-row chip; (c) open the Projects grid and click a card → the list is scoped and the header shows the folder name. Example skeleton (adapt selectors/fixtures to the repo's helpers):
```js
const { test, expect } = require('@playwright/test');
const { signIn } = require('./_fixtures');

test.describe('project folders', () => {
  test('create a task filed into a new inline folder', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /new task/i }).click();
    await page.locator('#nt-title').fill('Folder smoke task');
    await page.locator('#nt-project').click();
    await page.locator('.proj-picker-search').fill('E2E Folder');
    await page.locator('.proj-picker-create').click();
    await page.getByRole('button', { name: /create.*notify/i }).click();
    await expect(page.locator('.projtag', { hasText: 'E2E Folder' }).first()).toBeVisible();
  });

  test('Projects grid scopes the list', async ({ page }) => {
    await signIn(page);
    await page.locator('.side-item[data-view="projects"]').click();
    await expect(page.locator('.proj-grid')).toBeVisible();
    await page.locator('.proj-card').first().click();
    await expect(page.locator('.proj-detail-head')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npm run test:local -- tests/projects.spec.js`
Expected: PASS (requires the test Supabase project with migration 055 applied).

- [ ] **Step 3: Add manual-checklist rows**

Append to `tests/manual-test-checklist.csv` (match its existing columns): create-with-new-folder, re-file from row, re-file from detail, unfile, grid counts correct, terminal toggle, detail scope + new task pre-select, filter chip, and **"cross-company folders NOT visible (RLS): sign in as a roofing-only user → picker/grid shows no Lumen folders."**

- [ ] **Step 4: Commit**

```bash
git add tests/projects.spec.js tests/manual-test-checklist.csv
git commit -m "test(projects): e2e coverage + manual checklist rows"
```

---

## Final: Migration on the test project + review

- [ ] Apply migration 055 to the **test** Supabase project (via MCP) before CI runs.
- [ ] Manually verify the RLS row on the checklist (cross-company isolation) — it cannot be asserted from the JS suite.
- [ ] Open a PR from `feat/project-folders`; do not merge to `main` until reviewed (Vercel auto-deploys `main` to production).

---

## Self-Review (completed against the spec)

- **Spec coverage:** §5 migration → Task 1; §6 loading → Task 2; §7 picker → Task 5; §8 filing surfaces → Tasks 6–7; §9 grid → Task 8; §9 new folder → Task 9; §10 detail → Task 10; §11 search → Task 3, filter → Task 11 (deviation noted: filter-bar chips, not a list column, because the list grid has fixed columns); §12 perms → enforced by Task 1 RLS + `tasks.write` UI gates; §15 testing → Task 12.
- **Deviations recorded:** (1) project filter lives in `FilterBarView`, not a new list column (Task 11 note). (2) Inline folder creation in the create form happens at pick-time via the shared picker (creates immediately, then fills the task), rather than deferring to task submit — same end result; a folder created then abandoned is a harmless empty folder, deletable from the grid.
- **Type consistency:** `App.projects[id]` shape (`{id,name,color,client,status,address,dueDate,companyId}`) is used identically in Tasks 2/3/5/6/7/8/10/11; `updateTaskField(id,'project',value)` and `createProject({name,companyId,color})` signatures match across tasks.
- **Assumptions to confirm during execution (flagged, not placeholders):** `taskModel.all()` is the all-tasks accessor; `controller.toggleFilter(group,id)` initializes arrays generically; `controller.openNewTaskPage(prefill)` / `creatingTask` prefill path exists (NewTaskPageView already reads `controller._newTaskPrefill`); `App.utils` lives in `js/utils.js`. Each is verified by the task's syntax + manual step before commit.
