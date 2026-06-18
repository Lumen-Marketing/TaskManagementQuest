# Calendar view + CSV export — design

Date: 2026-06-18
Status: approved

## Goal
Two features for Quest HQ (zero-build static SPA, no framework, CSS in `taskmanagement.css`):
1. Replace the **Timeline** task view with a **Calendar** view (month + week toggle).
2. Add **CSV export** for tasks and a time report, respecting the current filters.

Both are built custom (no libraries) to fit the zero-build app and the CSP.

## 1. Calendar view (replaces Timeline)

### Wiring
- `AppController.setLayout`: valid layouts become `['table', 'calendar', 'kanban']` (was `timeline`).
- `TaskListView.render`: `layout === 'calendar'` → `renderCalendar()`; `renderTimeline()`/`formatTimelineDate()` removed.
- `ToolbarMenuView`: View menu option + active-label map change `timeline` → `calendar`, icon `ti-calendar`.
- Persisted `layout` value `'timeline'` migrates to `'calendar'` on load (treat unknown/`timeline` as `calendar`-safe: fall back to `table` if invalid, and map a stored `timeline` → `calendar`).

### State (in `uiState`)
- `calendarMode`: `'month' | 'week'` (default `'month'`; persisted in localStorage alongside layout).
- `calendarAnchor`: ISO date string for the focused month/week (default today).

### Controls (header bar above grid)
`‹ ›` prev/next, **Today** button, month/year (month mode) or week-range (week mode) label, **Month / Week** toggle.

### Month mode
Sun–Sat grid, 5–6 week rows. Each day cell: date number + tasks **due that day** as compact priority-colored chips. Out-of-month days dimmed; today highlighted; "+N more" when a day overflows.

### Week mode
7 taller day columns for the anchored week; more chips visible per day.

### Interactions
- Tap task chip → open that task's detail (existing select/open flow).
- Tap empty day → open New Task pre-filled with that due date (if `NewTaskModalView` supports a default due; otherwise no-op — confirm during build).
- Prev/next/today/toggle update `uiState` + re-render.

### Filters & edge cases
- Uses the same filtered task set as other views (`getFilteredTasks()`), so company/assignee/status/etc. apply.
- Tasks with **no due date** are not placed; show a small "N tasks with no due date" note so they aren't silently hidden.

### Mobile
- Phones: month cells too small for chips → show a per-day **count/dot**; tapping a day lists that day's tasks below the grid.
- Week mode works as-is on phones.

## 2. CSV export (current filters)

### Entry point
**Export** button in the work-toolbar (icon `ti-download`; collapses to icon on mobile like the other toolbar controls) → small menu:
- **Tasks → CSV**
- **Time report → CSV**

### Tasks CSV
Currently filtered/visible tasks. Columns: Title, Type, Label, Company, Assignee, Priority, Status, Due, Created by, Created date, Subtask progress, Description.

### Time report CSV
Time entries for those same filtered tasks. Columns: Date, Person, Task, Company, Hours.

### Mechanics
- Build CSV string in JS; download via `Blob` + temporary `<a download>`.
- Filenames: `quest-hq-tasks-YYYY-MM-DD.csv`, `quest-hq-time-YYYY-MM-DD.csv`.
- CSV-safe: quote fields containing `, " \n`; double internal quotes; **injection-safe** — prefix values starting with `= + - @` with a `'`.

## Out of scope (YAGNI)
- Drag-to-reschedule on the calendar (view-only chips).
- PDF export (CSV only per decision).
- Calendar showing time entries (it shows tasks by due date).

## Verification
- Preview mode (`app.html?preview=1&role=developer&member=abraham`) + Playwright/Chromium screenshots at desktop + mobile widths.
- Calendar: month/week toggle, prev/next/today nav, chips on correct days, filters respected, mobile day-tap list.
- Export: downloaded CSV opens with correct rows/columns, respects filters, escaping/injection-safe.
