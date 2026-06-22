# Home & Reports (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Home** screen (everyone) and a **Reports** screen (admin/supervisors) styled like the mockup, backed by real workspace data, with completion-history tracking so Reports metrics are real.

**Architecture:** Two isolated view classes (`HomeView`, `ReportsView`) render into dedicated full-bleed containers (`#homeWrap`, `#reportsWrap`) shown by `_togglePanes` (which hides `.list-pane` for these views). Both compute from a shared, role/company-scoped task set via a new `controller.visibleTasks()` helper. A migration adds `tasks.completed_at`, stamped by `TaskModel.toggleDone`, so throughput/on-time/cycle-time are real. All styling is scoped under `.qhq-page` and reuses the Phase-1 orange tokens.

**Tech Stack:** Zero-build static SPA (vanilla JS + CSS), Supabase (tasks table), inline hand-built SVG charts (no chart lib), Playwright tests.

## Global Constraints

- No framework / no build step; plain JS + CSS.
- Mobile-first: KPI/chart grids collapse to one column ≤720px; no horizontal overflow.
- New view styling scoped under `.qhq-page` (and `#homeWrap`/`#reportsWrap`); reuse Phase-1 tokens (`--surface`, `--ink*`, `--amber`, `--border`, status vars) — do not redefine the palette.
- Permissions: `home.view` → every role; `reports.view` → supervisor, admin, developer only.
- Real statuses: `todo`, `pending`, `review`, `hold`, `done` (mockup "In progress"/"Blocked" map to `pending`/`hold`).
- AI-brief copy + "Handled for you" stay static placeholders this phase.
- Migration 052 must be applied to Supabase BEFORE the client change deploys to `main`.

---

### Task 1: Completion-history (migration + client wiring)

**Files:**
- Create: `supabase/sql/052_add_task_completed_at.sql`
- Modify: `js/services/SupabaseDataStore.js` (`_taskToRow` ~183-199, `_mapTaskRow` ~438-458)
- Modify: `js/models/TaskModel.js` (`toggleDone` ~336-345)

**Interfaces:**
- Produces: `task.completedAt` (ISO string | null) and `task.createdAt` (ISO string | null) on every task object; `completed_at` column on the `tasks` row.

- [ ] **Step 1: Write the migration** `supabase/sql/052_add_task_completed_at.sql`:
```sql
-- Persist when a task was completed so Reports can compute throughput, on-time
-- rate and cycle time from real history. Nullable; non-done tasks stay NULL.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Best-effort backfill so already-done tasks contribute to history.
UPDATE tasks SET completed_at = updated_at
  WHERE status = 'done' AND completed_at IS NULL;
```

- [ ] **Step 2: Map the column on read.** In `_mapTaskRow` add (next to `clearedAt`):
```js
      createdAt: row.created_at || null,
      completedAt: row.completed_at || null,
```

- [ ] **Step 3: Write the column on save.** In `_taskToRow` add (next to `cleared_at`):
```js
      completed_at: task.completedAt || null,
```

- [ ] **Step 4: Stamp it in the model.** Replace the `_completedAt` lines in `TaskModel.toggleDone`:
```js
    const becomingDone = t.status !== 'done';
    t.status = becomingDone ? 'done' : 'todo';
    if (becomingDone) t.completedAt = new Date().toISOString();
    else delete t.completedAt;
```
(Remove the old `t._completedAt = App.utils.todayISO(0)` / `delete t._completedAt`.)

- [ ] **Step 5: Verify** in the preview app: complete a task and confirm the field is set.
```bash
PORT=4188 node tools/dev-server.mjs &   # if not already running
```
Open `http://localhost:4188/app.html?preview=1&role=developer&member=abraham`, Esc to dismiss the tour, mark a task done, then in DevTools console:
`App.controller.taskModel.all().find(t=>t.status==='done').completedAt` → an ISO string. Reopen it → `undefined`.

- [ ] **Step 6: Commit.**
```bash
git add supabase/sql/052_add_task_completed_at.sql js/services/SupabaseDataStore.js js/models/TaskModel.js
git commit -m "feat(reports): persist tasks.completed_at for real history (migration 052)"
```

---

### Task 2: Gating, scoping helper, and view plumbing

**Files:**
- Modify: `js/constants.js` (`App.ROLE_PERMISSIONS` ~93-100)
- Modify: `js/controllers/AppController.js` (`canView` ~60-68, `_togglePanes` ~372-384, add `visibleTasks`)
- Modify: `app.html` (add `#homeWrap`/`#reportsWrap` in `.main`; add Home nav item)
- Modify: `js/views/SidebarView.js` (`_buildSections`: add Reports to Team)

**Interfaces:**
- Produces: `controller.canView('home'|'reports')`; `controller.visibleTasks({ includeDone = true })` → `Task[]` (company + role scoped); containers `#homeWrap`, `#reportsWrap`; nav items `data-view="home"` / `data-view="reports"`.

- [ ] **Step 1: Add permissions.** In `App.ROLE_PERMISSIONS`, append `'home.view'` to worker, sales, supervisor, admin, developer; append `'reports.view'` to supervisor, admin, developer.

- [ ] **Step 2: Gate the views.** In `AppController.canView`, before the final `return`:
```js
    if (view === 'home') return App.can('home.view');
    if (view === 'reports') return App.can('reports.view');
```

- [ ] **Step 3: Add the scoping helper** to `AppController` (after `getUserName`):
```js
  // The tasks this user may see right now (active company + role row-scope),
  // mirroring SidebarView counts. includeDone=false drops completed tasks.
  visibleTasks({ includeDone = true } = {}) {
    const role = App.effectiveRole();
    const cur = this.uiState.currentCompany;
    const me = (App.currentProfile && App.currentProfile.member_id) || this.currentUser;
    const clockId = App.DEFAULT_CLOCK_TASK_ID;
    let base = this.taskModel.all().filter(t => !t.clearedAt && t.id !== clockId);
    if (!includeDone) base = base.filter(t => t.status !== 'done');
    if (cur && cur !== '*') base = base.filter(t => t.company === cur);
    if (role === 'worker') {
      base = base.filter(t => t.assignee === this.currentUser || t.creator === this.currentUser);
    } else if (role === 'supervisor' && App.realRole() !== 'developer') {
      const reports = new Set((App.PROFILES || [])
        .filter(p => p.supervisor_id === me).map(p => p.member_id));
      base = base.filter(t => t.assignee === this.currentUser || t.creator === this.currentUser || reports.has(t.assignee));
    }
    return base;
  }
```

- [ ] **Step 4: Route the panes.** In `_togglePanes`, replace the body with:
```js
  _togglePanes() {
    const v = this.uiState.view;
    const isPageView = v === 'home' || v === 'reports';
    const isTimeView = v.startsWith('time:') || v === 'approvals' || v === 'team:hierarchy' || v.startsWith('admin:');
    document.getElementById('listPane').classList.toggle('hidden', isPageView);
    const homeWrap = document.getElementById('homeWrap');
    const reportsWrap = document.getElementById('reportsWrap');
    if (homeWrap) homeWrap.classList.toggle('hidden', v !== 'home');
    if (reportsWrap) reportsWrap.classList.toggle('hidden', v !== 'reports');
    document.getElementById('taskViewWrap').classList.toggle('hidden', isTimeView || isPageView);
    document.getElementById('timeViewWrap').classList.toggle('hidden', !isTimeView);
    const hideChrome = isTimeView || v === 'watching';
    document.querySelectorAll('.work-toolbar, .page-head-widgets').forEach(el => {
      el.classList.toggle('hidden', hideChrome);
    });
  }
```

- [ ] **Step 5: Add containers** in `app.html`, inside `<main id="mainPane">` immediately after the closing `</div>` of `.list-pane` (before the resize-handle):
```html
    <section id="homeWrap" class="qhq-page hidden" aria-label="Home"></section>
    <section id="reportsWrap" class="qhq-page hidden" aria-label="Reports"></section>
```

- [ ] **Step 6: Add the Home nav item** in `app.html`, as the FIRST item in the Personal group (the `.side-group.grp-views`, before the "All" item):
```html
        <div class="side-item" data-view="home" title="Home"><i class="ti ti-home"></i><span class="side-item-label">Home</span></div>
```

- [ ] **Step 7: Add Reports to the Team section.** In `SidebarView._buildSections`, after the `clock.admin` push and before `if (teamItems.length)`:
```js
    if (App.can('reports.view')) teamItems.push({ view: 'reports', label: 'Reports', icon: 'ti-chart-bar' });
```

- [ ] **Step 8: Verify gating** with the smoke script (developer sees Reports; worker doesn't; Home shows for both; switching hides the list). Run:
```bash
node verify_out/_p2_gate.mjs   # created in Task 6; for now eyeball in the browser as ?role=worker and ?role=admin
```
Manual check: as `?role=worker` the sidebar has Home but no Reports, and `App.controller.canView('reports')` is `false`; as `?role=admin` Reports shows and opens.

- [ ] **Step 9: Commit.**
```bash
git add js/constants.js js/controllers/AppController.js app.html js/views/SidebarView.js
git commit -m "feat(home-reports): gating (home.view/reports.view), scoping helper, view plumbing"
```

---

### Task 3: HomeView

**Files:**
- Create: `js/views/HomeView.js`
- Modify: `app.html` (script tag before `AppController.js`)
- Modify: `js/app.js` (instantiate after `TimeView`)
- Modify: `taskmanagement.css` (append `.qhq-page` home styles)

**Interfaces:**
- Consumes: `controller.visibleTasks`, `controller.uiState.view`, `App.currentProfile`, `App.utils`.
- Produces: `App.HomeView` rendering into `#homeWrap` when `view === 'home'`.

- [ ] **Step 1: Create `js/views/HomeView.js`:**
```js
window.App = window.App || {};

App.HomeView = class HomeView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('homeWrap');
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('tasks:changed', rerender);
    App.EventBus.on('company:changed', rerender);
    App.EventBus.on('people:changed', rerender);
  }

  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _firstName() {
    const p = App.currentProfile || {};
    const full = p.full_name || (App.PEOPLE[this.controller.currentUser] || {}).name || 'there';
    return String(full).trim().split(/\s+/)[0];
  }

  _greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  // Open tasks assigned to me that are at risk, with a reason + chip.
  _atRisk() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    const tasks = this.controller.visibleTasks({ includeDone: false });
    const out = [];
    for (const t of tasks) {
      const overdue = t.due && t.due < today;
      const parked = t.status === 'hold';
      const hot = (t.priority === 'critical' || t.priority === 'high');
      if (!overdue && !parked) continue;
      const reason = overdue && hot ? 'Overdue + high priority'
        : overdue ? 'Past due'
        : 'On hold';
      const chip = overdue && hot ? { cls: 'risk', label: 'at risk' }
        : overdue ? { cls: 'risk', label: 'late' }
        : { cls: 'hold', label: 'blocked' };
      out.push({ t, reason, chip, overdue });
    }
    // Worst first: overdue before held, then by due date.
    out.sort((a, b) => (b.overdue - a.overdue) || String(a.t.due).localeCompare(String(b.t.due)));
    return out.slice(0, 6);
  }

  render() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    const mine = this.controller.visibleTasks({ includeDone: false })
      .filter(t => t.assignee === me);
    const dueToday = mine.filter(t => t.due === today).length;
    const waiting = mine.filter(t => t.status === 'review' || t.status === 'hold').length;
    const atRisk = this._atRisk();

    const esc = App.utils.escapeHtml;
    const riskRows = atRisk.length ? atRisk.map(r => `
      <div class="qhq-ar-row">
        <div class="qhq-ar-ic ${r.chip.cls}"><i class="ti ${r.overdue ? 'ti-alert-triangle' : 'ti-player-pause'}"></i></div>
        <div class="qhq-ar-b">
          <div class="qhq-ar-t">${esc(r.t.title)}</div>
          <div class="qhq-ar-s">${esc(this.controller.getUserName(r.t.assignee))} · ${esc(r.reason)}</div>
        </div>
        <span class="qhq-chip ${r.chip.cls}">${esc(r.chip.label)}</span>
      </div>`).join('')
      : `<div class="qhq-empty">Nothing at risk right now. 🎉</div>`;

    this.wrap.innerHTML = `
      <div class="qhq-home">
        <div class="qhq-greet">${this._greeting()}, <span class="em">${esc(this._firstName())}</span></div>
        <div class="qhq-dateline">${esc(App.utils.longDate ? App.utils.longDate(today) : today)} · ${dueToday} due today · ${waiting} waiting on you</div>

        <div class="qhq-brief">
          <div class="qhq-brief-h"><span class="qhq-spark"><i class="ti ti-sparkles"></i></span><span class="t">Your morning brief</span><span class="b">QUEST AI</span></div>
          <p class="qhq-brief-tx">Prioritize overdue and high-impact work first. This brief will summarize your workspace automatically — for now, use the cards below to see what needs you.</p>
        </div>

        <div class="qhq-home-grid">
          <div class="qhq-card">
            <div class="qhq-card-h"><span class="ct">At risk</span><span class="meta">· needs attention</span></div>
            <div class="qhq-arlist">${riskRows}</div>
          </div>
          <div class="qhq-card">
            <div class="qhq-card-h"><span class="ct">Handled for you</span><span class="meta">· coming soon</span></div>
            <div class="qhq-hdlist">
              <div class="qhq-empty">Automated summaries will appear here.</div>
            </div>
          </div>
        </div>
      </div>`;
  }
};
```
(If `App.utils.longDate` doesn't exist, the `?:` falls back to the ISO date — verify in Step 4 and, if you want the long format, add a tiny formatter; do not block on it.)

- [ ] **Step 2: Load the script.** In `app.html`, add before `js/views/FocusWidgetView.js` is fine, but to be safe add after it:
```html
<script src="js/views/HomeView.js"></script>
```

- [ ] **Step 3: Instantiate.** In `js/app.js`, after `new App.TimeView({...})`:
```js
  new App.HomeView({ controller });
```

- [ ] **Step 4: Style** — append to `taskmanagement.css` (scoped). Port the mockup's Home look using Phase-1 tokens:
```css
.qhq-page { overflow-y: auto; }
.qhq-home { padding: 22px 26px 48px; max-width: 1240px; }
.qhq-greet { font-size: 23px; font-weight: 800; letter-spacing: -.024em; }
.qhq-greet .em { color: var(--amber); }
.qhq-dateline { font-size: 12.5px; color: var(--ink-3); margin-top: 3px; }
.qhq-brief { border: 1px solid var(--border); border-radius: 14px; background: linear-gradient(180deg,#FFFCFA,var(--surface)); padding: 16px 18px; margin: 16px 0; box-shadow: var(--shadow-sm); }
.qhq-brief-h { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.qhq-spark { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg,#ED4E0D,#F2902E); display: grid; place-items: center; color: #fff; }
.qhq-brief-h .t { font-size: 13.5px; font-weight: 800; }
.qhq-brief-h .b { font-size: 10.5px; font-weight: 800; color: #8A5A00; background: #FCEFD7; border: 1px solid #F2DEB0; border-radius: 6px; padding: 1px 7px; }
.qhq-brief-tx { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); }
.qhq-home-grid { display: grid; grid-template-columns: 1.55fr 1fr; gap: 14px; }
.qhq-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-sm); }
.qhq-card-h { display: flex; align-items: center; gap: 9px; padding: 14px 16px 11px; }
.qhq-card-h .ct { font-size: 13px; font-weight: 800; }
.qhq-card-h .meta { font-size: 11px; color: var(--ink-3); }
.qhq-arlist, .qhq-hdlist { padding: 2px 16px 12px; }
.qhq-ar-row { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--border); }
.qhq-ar-row:first-child { border-top: none; }
.qhq-ar-ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; background: var(--rust-bg); color: var(--rust); }
.qhq-ar-ic.hold { background: #FCEFD7; color: #9A5E08; }
.qhq-ar-b { flex: 1; min-width: 0; }
.qhq-ar-t { font-size: 12.8px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qhq-ar-s { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
.qhq-chip { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
.qhq-chip.risk { color: var(--rust); background: var(--rust-bg); }
.qhq-chip.hold { color: #9A5E08; background: #FCEFD7; }
.qhq-empty { font-size: 12.5px; color: var(--ink-3); padding: 14px 0; }
@media (max-width: 720px) { .qhq-home { padding: 16px 12px 40px; } .qhq-home-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Verify** (browser script): open Home, confirm greeting + counts + at-risk rows render with the orange theme; no JS errors. Screenshot desktop + 390px.

- [ ] **Step 6: Commit.**
```bash
git add js/views/HomeView.js app.html js/app.js taskmanagement.css
git commit -m "feat(home): Home screen with live due-today / waiting / at-risk"
```

---

### Task 4: ReportsView

**Files:**
- Create: `js/views/ReportsView.js`
- Modify: `app.html` (script tag), `js/app.js` (instantiate), `taskmanagement.css` (reports styles)

**Interfaces:**
- Consumes: `controller.visibleTasks`, `App.utils`, `App.PEOPLE`.
- Produces: `App.ReportsView` rendering into `#reportsWrap` when `view === 'reports'`; internal `this.range ∈ {week,month,quarter}`.

- [ ] **Step 1: Create `js/views/ReportsView.js`** with the computations + render:
```js
window.App = window.App || {};

App.ReportsView = class ReportsView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('reportsWrap');
    this.range = 'month';
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('tasks:changed', rerender);
    App.EventBus.on('company:changed', rerender);
  }

  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _rangeStart() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (this.range === 'week') d.setDate(d.getDate() - 7);
    else if (this.range === 'quarter') d.setMonth(d.getMonth() - 3);
    else d.setMonth(d.getMonth() - 1);
    return d;
  }

  _completedInRange(tasks, start) {
    return tasks.filter(t => t.completedAt && new Date(t.completedAt) >= start);
  }

  _metrics() {
    const all = this.controller.visibleTasks({ includeDone: true });
    const open = all.filter(t => t.status !== 'done');
    const today = App.utils.todayISO(0);
    const start = this._rangeStart();
    const done = this._completedInRange(all, start);

    const critHigh = open.filter(t => t.priority === 'critical' || t.priority === 'high').length;
    const overdue = open.filter(t => t.due && t.due < today).length;

    // On-time: completed_at date <= due date.
    const withDue = done.filter(t => t.due);
    const onTime = withDue.filter(t => App.utils.toISODate(new Date(t.completedAt)) <= t.due).length;
    const onTimeRate = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;

    // Cycle time: completed_at - created_at (days).
    const withSpan = done.filter(t => t.createdAt && t.completedAt);
    const avgCycle = withSpan.length
      ? (withSpan.reduce((s, t) => s + (new Date(t.completedAt) - new Date(t.createdAt)), 0)
          / withSpan.length / 86400000)
      : null;

    // Status mix (all non-cleared, scoped).
    const statuses = ['todo', 'pending', 'review', 'hold', 'done'];
    const mix = statuses.map(s => ({ s, n: all.filter(t => t.status === s).length }));

    // Throughput by person (completed in range).
    const byPerson = {};
    done.forEach(t => { byPerson[t.assignee] = (byPerson[t.assignee] || 0) + 1; });
    const people = Object.entries(byPerson)
      .map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 8);

    // Throughput per week (last 8 weeks) from completed_at.
    const weeks = [];
    const wk0 = new Date(); wk0.setHours(0, 0, 0, 0); wk0.setDate(wk0.getDate() - 7 * 7);
    for (let i = 0; i < 8; i++) {
      const a = new Date(wk0); a.setDate(a.getDate() + i * 7);
      const b = new Date(a); b.setDate(b.getDate() + 7);
      weeks.push(all.filter(t => t.completedAt && new Date(t.completedAt) >= a && new Date(t.completedAt) < b).length);
    }

    // Critical & High open, grouped by assignee.
    const critList = open.filter(t => t.priority === 'critical' || t.priority === 'high')
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));

    return { critHigh, overdue, completed: done.length, onTimeRate, avgCycle, mix, people, weeks, critList, total: all.length };
  }

  render() {
    const m = this._metrics();
    const esc = App.utils.escapeHtml;
    const STATUS_LABEL = { todo: 'To do', pending: 'In progress', review: 'In review', hold: 'Blocked', done: 'Done' };
    const STATUS_VAR = { todo: 'var(--ink-3)', pending: 'var(--amber)', review: '#8268DC', hold: 'var(--rust)', done: 'var(--green)' };

    const kpi = (label, val, sub) => `
      <div class="qhq-kpi"><div class="kl">${esc(label)}</div><div class="kv tnum">${val}</div><div class="kd">${esc(sub)}</div></div>`;

    const maxPerson = Math.max(1, ...m.people.map(p => p.n));
    const personBars = m.people.length ? m.people.map(p => `
      <div class="qhq-bh-row"><span class="nm">${esc(this.controller.getUserName(p.id))}</span>
        <div class="qhq-bh-track"><i style="width:${Math.round((p.n / maxPerson) * 100)}%"></i></div>
        <span class="v">${p.n}</span></div>`).join('') : `<div class="qhq-empty">No completions in range.</div>`;

    const mixTotal = Math.max(1, m.mix.reduce((s, x) => s + x.n, 0));
    const mixBar = m.mix.map(x => x.n ? `<i style="width:${(x.n / mixTotal) * 100}%;background:${STATUS_VAR[x.s]}"></i>` : '').join('');
    const mixLegend = m.mix.map(x => `<div><span class="d" style="background:${STATUS_VAR[x.s]}"></span>${STATUS_LABEL[x.s]} <b>${x.n}</b></div>`).join('');

    const maxWeek = Math.max(1, ...m.weeks);
    const pts = m.weeks.map((n, i) => `${20 + i * 84},${150 - (n / maxWeek) * 110}`).join(' ');

    const today = App.utils.todayISO(0);
    const critRows = m.critList.length ? m.critList.map(t => `
      <div class="qhq-cl-row">
        <span class="pf ${t.priority}"></span>
        <span class="ti">${esc(t.title)}</span>
        <span class="who">${esc(this.controller.getUserName(t.assignee))}</span>
        <span class="pill st-${t.status}">${STATUS_LABEL[t.status] || t.status}</span>
        <span class="due ${t.due && t.due < today ? 'over' : ''}">${esc(t.due || '—')}</span>
      </div>`).join('') : `<div class="qhq-empty">No critical or high open tasks. 🎉</div>`;

    this.wrap.innerHTML = `
      <div class="qhq-rpt">
        <div class="qhq-rpt-top">
          <div><div class="h">Company reports</div><div class="sub">Scoped to your access · ${m.total} tasks</div></div>
          <div class="qhq-range" role="tablist">
            ${['week', 'month', 'quarter'].map(r => `<button data-range="${r}" class="${r === this.range ? 'on' : ''}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}
          </div>
        </div>

        <div class="qhq-kpi-row">
          ${kpi('Critical & High open', m.critHigh, 'open now')}
          ${kpi('Overdue', m.overdue, 'past due')}
          ${kpi('Completed', m.completed, 'in range')}
          ${kpi('On-time rate', m.onTimeRate == null ? '—' : m.onTimeRate + '%', 'of completed')}
          ${kpi('Avg cycle time', m.avgCycle == null ? '—' : m.avgCycle.toFixed(1) + 'd', 'create → done')}
        </div>

        <div class="qhq-charts">
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Throughput</span><span class="meta">· completed / week · last 8 weeks</span></div>
            <svg viewBox="0 0 640 170" class="qhq-spark-svg" preserveAspectRatio="none">
              <polyline points="${pts}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Throughput by person</span><span class="meta">· in range</span></div>
            <div class="qhq-bars">${personBars}</div>
          </div>
        </div>

        <div class="qhq-charts" style="grid-template-columns:1fr 1.4fr">
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Open work by status</span></div>
            <div class="qhq-statmix"><div class="qhq-mixbar">${mixBar}</div><div class="qhq-mixlegend">${mixLegend}</div></div>
          </div>
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Critical & High — company-wide</span></div>
            <div class="qhq-cllist">${critRows}</div>
          </div>
        </div>
      </div>`;

    this.wrap.querySelectorAll('.qhq-range button').forEach(b =>
      b.addEventListener('click', () => { this.range = b.dataset.range; this.render(); }));
  }
};
```

- [ ] **Step 2: Load + instantiate.** `app.html`: `<script src="js/views/ReportsView.js"></script>`. `js/app.js`: `new App.ReportsView({ controller });` after HomeView.

- [ ] **Step 3: Style** — append to `taskmanagement.css` (reuse the home `.qhq-page`/`.qhq-empty`/`.qhq-chip` and Phase-1 tokens):
```css
.qhq-rpt { padding: 20px 24px 48px; max-width: 1280px; }
.qhq-rpt-top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.qhq-rpt-top .h { font-size: 19px; font-weight: 800; letter-spacing: -.02em; }
.qhq-rpt-top .sub { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.qhq-range { margin-left: auto; display: inline-flex; background: #EDEFF2; border-radius: 8px; padding: 3px; }
.qhq-range button { height: 26px; padding: 0 11px; border-radius: 6px; font-size: 11.5px; font-weight: 700; color: var(--ink-2); }
.qhq-range button.on { background: #fff; color: var(--ink); box-shadow: var(--shadow-sm); }
.qhq-kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
.qhq-kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 15px; box-shadow: var(--shadow-sm); }
.qhq-kpi .kl { font-size: 11.5px; color: var(--ink-2); font-weight: 550; }
.qhq-kpi .kv { font-size: 26px; font-weight: 800; letter-spacing: -.03em; margin-top: 9px; line-height: 1; }
.qhq-kpi .kd { font-size: 11px; margin-top: 7px; color: var(--ink-3); }
.qhq-charts { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; margin-bottom: 14px; }
.qhq-chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-sm); padding: 0 0 14px; }
.qhq-chart-card .cc-h { display: flex; align-items: center; gap: 9px; padding: 14px 16px 4px; }
.qhq-chart-card .cc-h .ct { font-size: 13px; font-weight: 800; }
.qhq-chart-card .cc-h .meta { font-size: 11px; color: var(--ink-3); }
.qhq-spark-svg { width: 100%; height: 150px; padding: 8px 8px 0; }
.qhq-bars { padding: 8px 16px 2px; }
.qhq-bh-row { display: grid; grid-template-columns: 90px 1fr 34px; align-items: center; gap: 10px; padding: 7px 0; }
.qhq-bh-row .nm { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qhq-bh-track { height: 9px; border-radius: 5px; background: #EEF0F3; overflow: hidden; }
.qhq-bh-track i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg,#F2902E,#ED4E0D); }
.qhq-bh-row .v { font-size: 12px; font-weight: 700; text-align: right; color: var(--ink-2); }
.qhq-statmix { padding: 12px 16px 2px; }
.qhq-mixbar { height: 13px; border-radius: 7px; overflow: hidden; display: flex; gap: 2px; }
.qhq-mixbar i { height: 100%; }
.qhq-mixlegend { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 16px; margin-top: 13px; }
.qhq-mixlegend div { font-size: 11.5px; color: var(--ink-2); display: flex; align-items: center; gap: 8px; }
.qhq-mixlegend b { margin-left: auto; color: var(--ink); }
.qhq-mixlegend .d { width: 8px; height: 8px; border-radius: 3px; }
.qhq-cllist { padding: 4px 8px 0; }
.qhq-cl-row { display: grid; grid-template-columns: 4px 1fr 90px 90px 70px; align-items: center; gap: 10px; padding: 8px; border-top: 1px solid var(--border); }
.qhq-cl-row:first-child { border-top: none; }
.qhq-cl-row .pf { width: 3px; height: 15px; border-radius: 2px; }
.qhq-cl-row .pf.critical { background: var(--rust); } .qhq-cl-row .pf.high { background: var(--warn, #E08A0B); }
.qhq-cl-row .ti { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qhq-cl-row .who { font-size: 11px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qhq-cl-row .pill { font-size: 11px; font-weight: 600; border-radius: 6px; padding: 2px 8px; text-align: center; background: var(--bg-3); color: var(--ink-2); }
.qhq-cl-row .due { font-size: 11.5px; color: var(--ink-2); }
.qhq-cl-row .due.over { color: var(--rust); font-weight: 700; }
@media (max-width: 900px) { .qhq-kpi-row { grid-template-columns: repeat(2, 1fr); } .qhq-charts { grid-template-columns: 1fr !important; } }
@media (max-width: 720px) { .qhq-rpt { padding: 16px 12px 40px; } .qhq-kpi-row { grid-template-columns: 1fr 1fr; } .qhq-cl-row { grid-template-columns: 4px 1fr 64px; } .qhq-cl-row .who, .qhq-cl-row .pill { display: none; } }
```

- [ ] **Step 4: Verify** (browser, `?role=admin`): KPIs show real numbers, charts render, range buttons re-render, no JS errors. Screenshot desktop + 390px.

- [ ] **Step 5: Commit.**
```bash
git add js/views/ReportsView.js app.html js/app.js taskmanagement.css
git commit -m "feat(reports): Reports screen with real KPIs, throughput, status mix, crit list"
```

---

### Task 5: Role-gate test + final verification

**Files:**
- Create: `tests/home-reports.spec.js`
- Modify: `playwright.config.js` (add to `local` testMatch)

- [ ] **Step 1: Write the spec** `tests/home-reports.spec.js` (preview bypass, no creds):
```js
// @ts-check
import { test, expect } from '@playwright/test';
const url = role => `/app.html?preview=1&role=${role}&member=abraham`;
async function boot(page, role) {
  await page.goto(url(role), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}

test('Home is available to a worker; Reports is not', async ({ page }) => {
  await boot(page, 'worker');
  await expect(page.locator('.side-item[data-view="home"]')).toBeVisible();
  expect(await page.evaluate(() => App.controller.canView('reports'))).toBe(false);
  expect(await page.locator('.side-item[data-view="reports"]').count()).toBe(0);
});

test('admin sees Reports and can open Home + Reports', async ({ page }) => {
  await boot(page, 'admin');
  expect(await page.evaluate(() => App.controller.canView('reports'))).toBe(true);
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('#homeWrap')).toBeVisible();
  await expect(page.locator('#listPane')).toBeHidden();
  await page.evaluate(() => App.controller.setView('reports'));
  await expect(page.locator('#reportsWrap')).toBeVisible();
  await expect(page.locator('.qhq-kpi')).toHaveCount(5);
});
```

- [ ] **Step 2: Register** in `playwright.config.js` `local` testMatch: add `'home-reports.spec.js'`.

- [ ] **Step 3: Verify behavior** with a chromium script (the runner needs a browser build not installed locally) against the dev server: run the two flows above and assert; screenshot Home + Reports at 1280 and 390 for both roles.

- [ ] **Step 4: Regression** — switch through all prior views; confirm zero JS errors and the list pane returns when leaving Home/Reports.

- [ ] **Step 5: Commit.**
```bash
git add tests/home-reports.spec.js playwright.config.js
git commit -m "test(home-reports): role-gate + render smoke"
```

## Self-review notes
- Spec coverage: migration+wiring (T1), perms/scoping/plumbing (T2), Home (T3), Reports (T4), tests (T5) — covers spec §A–I.
- Statuses use real vocabulary; mockup labels mapped in STATUS_LABEL.
- `visibleTasks` excludes the clock task and cleared rows; Reports passes includeDone:true for history, Home includeDone:false.
- Property names consistent: `completedAt`/`createdAt` defined in T1, used in T4; `visibleTasks({includeDone})` defined T2, used T3/T4.
- AI brief + Handled card are static placeholders (per spec).
