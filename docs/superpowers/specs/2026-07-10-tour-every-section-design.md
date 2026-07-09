# Onboarding tour — cover every section (design)

**Date:** 2026-07-10
**Status:** Approved (design) — pending implementation plan
**Owner:** info@lumenmarketingusa.com

## Goal

Expand the interactive onboarding tour so it visits **every navigable section**
of Quest HQ, not just the default task view and top-bar chrome. The tour should
actually **walk into** each section (navigate to it, spotlight it, explain it in
one line), then return the user to where they started. Coverage stays
**role-aware**: users only see stops for sections they can open.

## Non-goals

- No multi-step deep dives inside a section (one stop per section — decided).
- No Wallboard stop (decided — niche big-screen view).
- No changes to when the tour auto-starts, the `profiles.onboarded` gating, the
  `App.startTour()` entry point, or the "Show tour again" menu item.
- No new dependencies, no DB changes, no CSS overhaul (reuse `.tour-*` styles).

## Current state

`js/views/TourView.js` is a dependency-free spotlight tour.

- Steps are `{ sel, title, body }`. `sel` is a CSS selector to spotlight, or
  `null` for a centered welcome/closing card.
- `buildSteps()` assembles the list and filters it: a step is kept only if it
  has no `sel` **or** its target passes `_visible(sel)` (present + non-zero box).
- Role-awareness today is a side effect of that visibility filter plus a few
  `App.can(...)` guards — every current step points at chrome already on screen
  (`.grp-views`, `#listPane`, `#newTaskBtn`, `#clockWidget`, `#moreViewsBtn`,
  `[data-view="team:hierarchy"]`, `[data-view="approvals"]`, `#notifBtn`,
  `#userAvatar`). The tour never changes the view.
- `_render()` positions the tooltip; `next/prev` walk the list; `end(completed)`
  tears down and calls `onFinish` (Skip/Esc count the same as finishing).

**Problem:** many sections that now exist are absent from the tour — Home,
Projects, Reports, My time, Team workload, Clock dashboard, Task setup, Roles &
permissions, Problem reports.

## Design

### Step schema — add an optional `view`

```js
{ view: 'projects', sel: '#projectsWrap', title: '…', body: '…', gate: () => App.controller.canView('projects') }
```

- `view` (optional): a `setView` key. When present, the step is a *section
  walk* — the tour navigates there before spotlighting.
- `sel`: the element to spotlight once the section is on screen (its content
  container), or `null` for centered cards.
- `gate` (optional): explicit predicate deciding whether the step is included.
  Section steps gate on `controller.canView(view)`; permission-only chrome steps
  (e.g. Create a task) gate on `App.can('tasks.write')`.

### Gating — permission, not DOM visibility

`buildSteps()` filter becomes:

- If a step has an explicit `gate`, keep it when `gate()` is true.
- Else if it has a `sel` and no `view`, keep it when `_visible(sel)` is true
  (unchanged behavior for always-present chrome like `#notifBtn`).
- Else keep it.

This is required because a section's container (`#homeWrap`, `#projectsWrap`,
the shared `#timeViewWrap`, …) is `hidden` until navigated to, so the old
`_visible` test would wrongly drop every section step at build time.

### Navigate-and-wait in `_render()`

On each render, if the step has a `view` and `App.controller.uiState.view !==
step.view`, call `App.controller.setView(step.view)`. Then wait for the target
container to be laid out before measuring:

- Poll with `requestAnimationFrame` until the spotlight target exists and has a
  non-zero bounding box, or a ~350 ms timeout elapses; then run the existing
  `_place(target)` logic.
- Because navigation is driven from `_render()` (not from `next()`), **Back and
  Next both re-navigate correctly**, and it is idempotent.

### Restore the starting view

`start()` captures `this._startView = App.controller.uiState.view`. `end()`
restores it with `setView(this._startView)` on **both** completion and
Skip/Esc, so replaying the tour never strands the user in an admin view.

### Container map (verified in app.html + view sources)

| Section (view key)     | canView gate            | Spotlight selector |
|------------------------|-------------------------|--------------------|
| `home`                 | home.view               | `#homeWrap`        |
| `all` (task list)      | tasks.view              | `#listPane`        |
| `projects`             | tasks.view (default)    | `#projectsWrap`    |
| `reports`              | reports.view            | `#reportsWrap`     |
| `time:mine`            | time.own \|\| clock.use | `#timeViewWrap`    |
| `time:resource`        | time.team               | `#timeViewWrap`    |
| `team:hierarchy`       | team.view               | `#timeViewWrap`    |
| `approvals`            | roles.manage            | `#timeViewWrap`    |
| `admin:clock`          | clock.admin             | `#timeViewWrap`    |
| `admin:task-setup`     | task-setup.manage       | `#timeViewWrap`    |
| `admin:permissions`    | roles.manage            | `#timeViewWrap`    |
| `admin:reports`        | bug-reports.manage      | `#timeViewWrap`    |

`#timeViewWrap` is a single reused container; only the navigated-to view is
mounted in it at a time, so spotlighting it always shows the current section.

### Full step sequence (role-gated; each auto-skips when its gate fails)

Order: welcome → everyday task chrome (while on the task list) → walk each nav
section in sidebar order → return to start view → sign-off.

| #  | Step                | Nav to            | Spotlight        | Gate                     |
|----|---------------------|-------------------|------------------|--------------------------|
| 1  | Welcome             | — (centered)      | —                | always                   |
| 2  | Home                | `home`            | `#homeWrap`      | home.view                |
| 3  | Your task list      | `all`             | `#listPane`      | tasks.view               |
| 4  | Views               | `all`             | `.grp-views`     | tasks.view               |
| 5  | Create a task       | `all`             | `#newTaskBtn`    | tasks.write              |
| 6  | Clock in & out      | `all`             | `#clockWidget`   | clock.use                |
| 7  | Notifications       | —                 | `#notifBtn`      | always (visible)         |
| 8  | Your account        | —                 | `#userAvatar`    | always (visible)         |
| 9  | Projects            | `projects`        | `#projectsWrap`  | tasks.view               |
| 10 | Reports             | `reports`         | `#reportsWrap`   | reports.view             |
| 11 | My time             | `time:mine`       | `#timeViewWrap`  | time.own \|\| clock.use  |
| 12 | Team workload       | `time:resource`   | `#timeViewWrap`  | time.team                |
| 13 | Team chart          | `team:hierarchy`  | `#timeViewWrap`  | team.view                |
| 14 | Approvals           | `approvals`       | `#timeViewWrap`  | roles.manage             |
| 15 | Clock dashboard     | `admin:clock`     | `#timeViewWrap`  | clock.admin              |
| 16 | Task setup          | `admin:task-setup`| `#timeViewWrap`  | task-setup.manage        |
| 17 | Roles & permissions | `admin:permissions`| `#timeViewWrap` | roles.manage             |
| 18 | Problem reports     | `admin:reports`   | `#timeViewWrap`  | bug-reports.manage       |
| 19 | All set             | — (restore start) | —                | always                   |

Draft copy (one line each; final wording tunable during implementation):

1. **Welcome to Quest HQ** — "A quick tour of every area — about a minute. You can leave anytime with Skip or Esc, and replay it from the ? menu."
2. **Home** — "Your dashboard — key numbers, what's due, and what to do next."
3. **Your task list** — "Every task with its due date, time and status. Tap a row to open it."
4. **Your views** — "Switch between All tasks, Mine, Urgent and Today."
5. **Create a task** — "Add a task, set a date and optional time, choose who it's for, and notify them."
6. **Clock in & out** — "Start and stop your timer here. A forgotten timer auto-closes after 12 hours."
7. **Notifications** — "Assignments and watcher updates show up here."
8. **Your account** — "Light/dark mode, roles & permissions, and sign out live in this menu."
9. **Projects** — "Group related tasks into projects and track them together."
10. **Reports** — "Charts on workload and completion across the team."
11. **My time** — "Your clock-ins and hours."
12. **Team workload** — "See who's on the clock across your team right now."
13. **Team chart** — "See who reports to whom."
14. **Approvals** — "Approve new accounts, set each person's role, and choose who they report to."
15. **Clock dashboard** — "Everyone's live timers — and fix forgotten clock-outs."
16. **Task setup** — "Customize the task types and labels your team uses."
17. **Roles & permissions** — "Fine-tune exactly what each role can do."
18. **Problem reports** — "Bugs and suggestions people have submitted."
19. **You're all set** — "That's the tour. Reopen it anytime from the ? menu. Welcome aboard!"

The old **"More views"** step (`#moreViewsBtn`) is removed — redundant now that
each section has its own stop.

## Edge cases

- **Section fails to render / container never appears:** the rAF poll times out
  (~350 ms) and falls back to a centered tooltip (existing `!target` path), so
  the tour never hangs.
- **Rapid Next clicks:** navigation is idempotent and re-render-driven; a queued
  poll for a superseded step is harmless (it re-measures the current target).
- **Skip/Esc mid-walk:** `end(false)` restores the start view, same as
  completion.
- **Worker with no dashboards:** sees roughly steps 1,3,4,5,6,7,8,19 — a short,
  coherent tour with no dead stops (gates drop the rest).
- **Mobile:** navigation via `setView` does not depend on the drawer being open,
  so section walks work on phones; spotlighting the content container is
  layout-driven and adapts. (Verify overflow/positioning per the mobile
  guidance.)

## Testing / verification

- **Unit (`npm run test:unit`):** extend/adjust any existing TourView tests —
  cover (a) `buildSteps()` includes a section step when `canView` is true and
  drops it when false, (b) a permission-gated chrome step (Create a task) is
  dropped without `tasks.write`, (c) start captures and end restores
  `uiState.view`. Use a stubbed `App.controller` with a fake `canView`/`setView`.
- **Visual (screenshot harness):** render the tour over the app in light/dark,
  desktop + mobile, stepping through a couple of section walks to confirm the
  spotlight lands on the navigated section and the tooltip is on-screen.
- **Manual:** replay via "Show tour again" as a developer (all stops) and as a
  worker (short path); confirm you're returned to the starting view.

## Files touched

- `js/views/TourView.js` — new step table with `view`/`gate` fields,
  permission-based `buildSteps()` filter, navigate-and-wait in `_render()`,
  start-view capture + restore in `start()`/`end()`.

No other files change. `js/app.js` (`App.startTour`, auto-start gating) and
`js/views/TopbarView.js` ("Show tour again") are untouched.
