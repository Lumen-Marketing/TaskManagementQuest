# Home Enrichment (Phase 2.5) — Design

**Date:** 2026-06-23
**Branch:** feat/home-and-reports
**Status:** Approved — ready to implement

## Goal

The Home screen currently feels empty: greeting → static AI brief → one live
card (**At risk**) + one dead placeholder (**Handled for you**). Turn Home into a
real personal dashboard by adding a **Recents** activity feed, a **Stat strip**,
an **Up next** card, and **Quick actions** — all from data that already exists.

## Constraints

- **No DB migration, no new perms.** `activity[]` (jsonb) and `completedAt`
  already exist on tasks; `App.can('reports.view')` already distinguishes managers.
- Everything lives in `js/views/HomeView.js` + scoped `.qhq-*` CSS under
  `body.ui-command-center` (Phase-1 tokens), and extends `tests/home-reports.spec.js`.
- Mobile-first: stat strip collapses to 2×2 and cards stack at ≤720px
  (see [[project_mobile_friendly_priority]], [[project_grid_minmax_clipping]]).

## Layout (top → bottom)

1. **Header row** — greeting + dateline (left); **Quick actions** (right):
   `+ New task` (primary) · `All tasks` · `Calendar`.
2. **Stat strip** — 4 chips over the current user's tasks (`assignee === me`):
   **Open** · **Due today** · **Overdue** · **Done this week**.
3. **AI brief** — unchanged static placeholder.
4. **Card row (2-col)** — **Up next** (new, left) · **At risk** (existing, right).
5. **Recents** — full-width activity feed (replaces the "Handled for you" card).

## Components

### Quick actions
- `+ New task` → `controller.openNewTaskModal()`.
- `All tasks` → `controller.setView('all')`.
- `Calendar` → `controller.setView('calendar')`.

### Stat strip
Counts over `this.controller.visibleTasks({ includeDone:true })` filtered to
`assignee === me`:
- **Open** — `status !== 'done'`.
- **Due today** — open && `due === todayISO(0)`.
- **Overdue** — open && `due && due < todayISO(0)`.
- **Done this week** — `completedAt` within the last 7 days
  (compare `hqDateOf(completedAt)` to a 7-day window).

### Up next
Source: my open tasks (`visibleTasks({includeDone:false})`, `assignee === me`).
Sort by `focusSeq` when set, then soonest due:
`(a.focusSeq ?? Infinity) - (b.focusSeq ?? Infinity)` then `due` asc. Top 5.
Row: priority dot · title · status pill · due chip → click `selectTask(id)`.
Empty state when the user has no open tasks.

### Recents
Flatten every source task's `activity[]` into `{ who, what, at, title, id }`,
drop entries with no `at`, sort by `at` desc, take top 12. Row:
**who** *what* · task title · `App.utils.timeAgo(at)` → click `selectTask(id)`.

Source set depends on role:
- **Manager** (`App.can('reports.view')` — supervisor/admin/dev):
  `visibleTasks({includeDone:true})` (all company-scoped activity).
- **Worker/sales:** "my world" — `visibleTasks` filtered to tasks where I am
  `assignee`, `creator`, or in `watchers`.

Empty state: "No recent activity yet."

## CSS
New scoped classes under `.qhq-home`: `.qhq-actions`, `.qhq-stat` /
`.qhq-stat-chip`, `.qhq-un-row` (Up next), `.qhq-rec-row` (Recents). Reuse
Phase-1 tokens (`--amber`, `--ink-*`, `--border`, status vars). Stat strip is a
4-col grid → 2×2 at ≤720px; the Up-next/At-risk row stacks at ≤720px.

## Testing
Extend `tests/home-reports.spec.js`:
- Stat strip renders exactly 4 chips on Home.
- Up next renders rows (or its empty state) for a worker.
- Recents renders for admin (team-wide) and a worker (own world); admin's feed
  contains at least the rows a worker sees.

## Out of scope
AI brief stays static. No new activity *types* are emitted — Recents only reads
what `pushActivity`/`addActivity` already write.
