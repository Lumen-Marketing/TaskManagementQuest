# Top nav + icon rail — navigation restructure

**Date:** 2026-07-02
**Status:** Approved (brainstorm), implementing on `feat/topnav-icon-rail`

## Goal

Shift Quest HQ's primary navigation from a full left sidebar to a **horizontal
top-bar nav + a thin left icon rail**, matching the Finexy reference the user
supplied. Also fixes the reported bug where the "My work / Company" scope toggle
disappeared when navigating to a non-task view (it was view-gated to all/mine).

## Navigation model

### Top bar (three zones)

```
[logo]   « Home · Tasks · Projects · Team ▾ · Reports »   ····   ⚲  🔔  [company] [avatar]
```

- **Center pill nav** — the primary sections; active section gets the filled pill.
  - `Home`     → view `home`
  - `Tasks`    → view `all` (task list; scope toggle shown in the Tasks header)
  - `Projects` → view `projects`
  - `Team ▾`   → dropdown (managers/admins only): Team workload (`time:resource`),
    Team chart (`team:hierarchy`), Approvals (`approvals`), Clock dashboard (`admin:clock`)
  - `Reports`  → view `reports` (managers/admins only)
  - Role gating mirrors the existing `controller.canView()` / `App.can()` checks.
    Workers see only Home · Tasks · Projects.
- **Right cluster** — search (existing), notifications (existing), company/workspace
  switcher (moved here from the sidebar; only when >1 workspace), avatar/account menu.

### Left icon rail (~56px, icons only, tooltips)

Task quick-filters + utility, all icon-only with count badges where relevant:

- `Urgent` (`hot`), `Today`, `Overdue`, `Watching`  — task filters
- `My time` (`time:mine`), `Wallboard` (`wallboard`)
- Bottom: Clock in/out button (icon), then avatar is in the top bar — rail bottom
  keeps the clock control.

### Scope toggle ("My work / Company")

- Rendered in the **Tasks section header**, visible the whole time the active view
  is a task list (`all` / `mine`). No longer hidden mid-session — the "disappears
  on click" bug is resolved because Tasks is now a first-class destination that
  owns the toggle.

## Behavior

- Active-state tracking: top-nav items and rail items both subscribe to
  `view:changed`. Team dropdown highlights when any of its sub-views is active.
- Company switcher re-scopes via `controller.setCompany()` (unchanged logic).
- All existing `data-view` wiring and `controller.setView()` calls are reused —
  this is a re-layout of the same navigation actions, not new routing.

## Mobile (≤720px)

- The center pill nav and icon rail collapse into the existing slide-in drawer
  (full labelled list), reached via the hamburger. Scope toggle is icon-only.
- No horizontal-scroll overflow (honor [[project_grid_minmax_clipping]]).

## Non-goals

- No change to task-list, detail, Home, or Reports internals.
- No new views or permissions; font stays Hanken Grotesk everywhere.

## Files

- `app.html` — restructure `.topbar` (add center nav + company switcher) and the
  `.deck`/`.sidebar` (→ icon rail).
- `js/views/TopbarView.js` — render + gate the center nav, Team dropdown, active
  states, company switcher; keep scope toggle in the Tasks header.
- `js/views/SidebarView.js` — render the icon rail (filters + my time + wallboard),
  drop the labelled section groups.
- `taskmanagement.css` — top-nav pills, icon rail, dropdown, responsive; scoped to
  `body.ui-command-center`.
