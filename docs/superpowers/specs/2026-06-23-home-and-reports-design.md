# Home & Reports sections — design

**Date:** 2026-06-23
**Status:** Approved (design), pending spec review

## Goal

Add two new top-level sections to Quest HQ, styled after the boss-approved
`quest-hq-reports-standalone.html` mockup:

- **Home** — a per-user landing screen (AI brief + "at risk" / "handled" cards).
  Visible to **every** role.
- **Reports** — a company analytics screen (KPI tiles, throughput charts,
  critical/high company list). Visible **only** to admin + supervisor (+ developer).

The mockup's third section (Meeting Mode) is explicitly **out of scope** for this work.

The boss wants these sections to look like the mockup, so we adopt the mockup's
visual language (orange `--accent`, Inter font, KPI tiles, cards, bar/line charts)
**scoped to the two new containers** — the rest of the app keeps the existing
command-center theme and IBM Plex.

## Non-goals

- Meeting Mode.
- Re-skinning the existing task table / sidebar / topbar.
- A real LLM-generated "AI brief" — the brief copy and the "Handled for you" card
  stay static placeholder content for now (per stakeholder decision).
- Embedding the mockup's multi-MB base64 woff2 fonts. Inter loads via the existing
  Google Fonts `<link>` instead.

## Data availability decision

The mockup shows time-series and historical metrics (throughput per week, on-time
rate, avg cycle time) that need completion/created history. The app already stores
`tasks.created_at` (just doesn't map it into the client task object) but has **no**
persistent completion timestamp — `_completedAt` is set transiently in-session only.

Decision: **start tracking completion history now** so all Reports metrics are real.

## Architecture

### A. Database migration — `supabase/sql/052_add_task_completed_at.sql`

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
-- Best-effort backfill so existing done tasks contribute to history.
UPDATE tasks SET completed_at = updated_at
  WHERE status = 'done' AND completed_at IS NULL;
```

- `completed_at` is nullable; non-done tasks have NULL.
- Per project convention, this migration must be applied to Supabase **before**
  the client change deploys to `main` (new task columns hit the DB first).
- No RLS change needed — `completed_at` rides on the existing `tasks` row policies.

### B. Client data wiring — `js/services/SupabaseDataStore.js`

- `_mapTaskRow` (read): add
  - `createdAt: row.created_at || null`
  - `completedAt: row.completed_at || null`
- `_taskToRow` (write): add `completed_at: task.completedAt || null`.

### C. Completion-timestamp lifecycle — `js/models/TaskModel.js`

In `toggleDone`:
- On transition **→ done**: set `t.completedAt = new Date().toISOString()`.
- On transition **→ reopened**: `delete t.completedAt` (set null on next save).
- Remove the transient `_completedAt` writes (replaced by the persisted field).
- The task is already marked dirty by the existing save path, so the new field
  flows through the normal delta save.

### D. Permissions & gating

`js/constants.js` — `App.ROLE_PERMISSIONS`:
- Add `home.view` to **every** role (worker, sales, supervisor, admin, developer).
- Add `reports.view` to **supervisor, admin, developer** only.

`js/controllers/AppController.js` — `canView(view)`:
- `if (view === 'home') return App.can('home.view');`
- `if (view === 'reports') return App.can('reports.view');`

`_togglePanes()`:
- Treat `home` and `reports` as full-page views: hide the entire `.list-pane`
  (task table + work toolbar + page head + ops brief) and show the matching
  `#homeWrap` / `#reportsWrap`. All other views behave exactly as today.

### E. Markup — `app.html`

- Add two sibling containers inside `<main id="mainPane">`, after `.list-pane`:
  - `<section id="homeWrap" class="qhq-page hidden" aria-label="Home"></section>`
  - `<section id="reportsWrap" class="qhq-page hidden" aria-label="Reports"></section>`
- Add `Inter` to the existing Google Fonts `<link>` href.
- Sidebar (`app.html` static markup): add a **Home** item at the top of the
  Workspace group: `<div class="side-item" data-view="home">…Home</div>`.
- Wire the two new view scripts before `AppController.js`.

### F. Sidebar gating — `js/views/SidebarView.js`

- The static **Home** item is gated by `applyStaticVisibility()` via
  `controller.canView('home')` (always true) — no special handling needed beyond
  it being a `data-view` item.
- Add a **Reports** entry. Cleanest fit: a new dynamic section item built in
  `_buildSections()` gated by `App.can('reports.view')`. Place it in a new
  `reports` section or append to the existing `org` section. Decision: standalone
  item in a new `reports`-keyed section labelled "Insights" containing
  `{ view: 'reports', label: 'Reports', icon: 'ti-chart-bar' }`.

### G. New view — `js/views/HomeView.js`

- Class `App.HomeView`, constructed in `app.js` with
  `{ taskModel, timeModel, controller, currentUser }`.
- Renders into `#homeWrap` when `controller.uiState.view === 'home'`.
- Subscribes to `view:changed`, `tasks:changed`, `company:changed`, `people:changed`
  and re-renders only when visible (mirrors `TimeView`).
- Content:
  - **Greeting** — "Good <morning/afternoon/evening>, <first name>" from the
    current profile; date line with two real counts:
    - **due today** = open tasks assigned to the user with `due === today`.
    - **waiting on you** = open tasks assigned to the user whose status is
      `review` or `hold` (i.e. parked needing the user's action).
  - **AI brief card** — static placeholder copy + chips (no live data this round).
  - **At risk card** — real, company-scoped to tasks the user can see. A task is
    "at risk" if it is open (status ≠ `done`) and any of:
    - overdue: `due < today`;
    - parked: status `hold` (the app's equivalent of the mockup's "Blocked");
    - slipping: overdue AND priority ∈ {critical, high}.
    Each row: title, owner, reason text, and a risk chip (overdue → "late",
    hold → "blocked", slipping → "at risk").
  - **Handled for you card** — static placeholder for now.
- Data is scoped exactly like the sidebar counts (`_scopedActiveTasks`-style:
  active company + role row-scope) so a worker only sees their own at-risk items.

### H. New view — `js/views/ReportsView.js`

- Class `App.ReportsView`, constructed in `app.js`.
- Renders into `#reportsWrap` when `controller.uiState.view === 'reports'`.
- Subscribes to `view:changed`, `tasks:changed`, `company:changed`; re-renders
  when visible.
- Local UI state: range = Week | Month | Quarter (default Month), held on the view
  instance; changing it re-renders. Company scope follows the global
  `controller.uiState.currentCompany`.
- Computes everything from the visible task set (already RLS/role-scoped):
  - **KPI tiles:**
    - Critical & High open — count priority∈{critical,high} & status≠done.
    - Overdue — due < today & status≠done.
    - Completed — count completed_at within the selected range.
    - On-time rate — of tasks completed in range, % with completed_at ≤ due.
    - Avg cycle time — mean(completed_at − created_at) over tasks completed in range.
  - **Throughput line chart** — completed count per week over the range (buckets
    by completed_at).
  - **Throughput by person** — completed-in-range count per assignee, bar list.
  - **Open work by status** — stacked mix of all current tasks by the app's real
    statuses (`todo`, `pending`, `review`, `hold`, `done`), using the existing
    status labels/colors (the mockup's "In progress"/"Blocked" map to
    `pending`/`hold`).
  - **Critical & High company-wide** — grouped by assignee, each row: title, label,
    status pill, due, slip indicator.
- All SVG charts are hand-built inline (no chart library — zero-build SPA), matching
  the mockup's approach.

### I. Styles — `taskmanagement.css`

- Append a clearly-delimited block of mockup-derived styles, **all selectors
  scoped under `.qhq-page`** (and `#homeWrap` / `#reportsWrap`) so nothing leaks
  into the existing app: the orange accent palette as scoped CSS vars, KPI tiles,
  cards, bar tracks, status-mix bar, company list rows, "at risk" rows, brief card.
- Must remain mobile-friendly per project priority: the KPI row and chart grids
  collapse to single-column at ≤720px; touch targets ≥ comfortable size.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| migration 052 | persist `completed_at` | tasks table |
| SupabaseDataStore | map completed_at/created_at both ways | row shape |
| TaskModel.toggleDone | stamp/clear completed_at | App.utils |
| constants + canView | gate home/reports by role | ROLE_PERMISSIONS |
| SidebarView | show Home (all) + Reports (gated) nav | canView / App.can |
| HomeView | render personal landing into #homeWrap | taskModel, controller |
| ReportsView | render analytics into #reportsWrap | taskModel, controller |
| .qhq-page CSS | scoped mockup styling | none |

## Testing

- Playwright smoke (local critical-path style): Home opens for a worker; Reports is
  hidden/blocked for a worker and visible for admin/supervisor; switching to
  Home/Reports hides the task list and back restores it.
- Manual/visual verification of both screens against the mockup at desktop + ≤720px
  (mobile-responsive-testing), since this is a visual feature.
- Sanity: completing a task stamps `completed_at` and it appears in Reports KPIs;
  reopening clears it.

## Rollout notes

- Apply migration 052 to Supabase **before** merging the client change to `main`.
- The static AI brief / "Handled for you" content is intentionally placeholder;
  a future task can wire a deterministic (or LLM) brief.
