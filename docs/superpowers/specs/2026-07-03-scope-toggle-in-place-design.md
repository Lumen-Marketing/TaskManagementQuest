# Scope toggle filters in place (My work / Company)

**Date:** 2026-07-03
**Status:** Approved (direct user request; behavior fully specified)

## Problem

The "My work / Company" segment in the task page head calls
`controller.setView('mine' | 'all')`. Clicking it while on Urgent / Today /
Overdue **navigates away** to the My-tasks or All-tasks view. The user wants
it to act as an **in-place filter**: stay on Urgent and flip between "my
urgent tasks" and "the company's urgent tasks".

## Design

### New state: `uiState.scope`

- `'all'` (Company, default) | `'mine'` (My work).
- Orthogonal to `uiState.view` — it narrows whatever task view is active.
- Persisted in the existing v1 `questhq:ui-state:<uid>` blob (`scope` key).
  Old blobs without the key default to `'all'`. A saved `view: 'mine'` from
  an older session migrates to `view: 'all'` + `scope: 'mine'`.

### Behavior

- `TopbarView` scope buttons call new `controller.setScope(scope)` instead of
  `setView`. No navigation; title/eyebrow stay the current view's.
- `TaskModel.getFiltered` gains a `scope` param: after the view branch, when
  `scope === 'mine'`, keep only `t.assignee === currentUser` (same predicate
  as the old 'mine' view). Applies uniformly to all task views incl.
  `company:` / `person:`.
- Pill highlight reflects `uiState.scope` (previously it matched `view`, so
  on Urgent neither pill lit).
- `setScope` emits `scope:changed`; TopbarView re-renders the pills,
  TaskListView re-renders the list (covers table / calendar / kanban / cards —
  all render through `renderList`).
- The `'mine'` view branch stays in TaskModel for compatibility, but nothing
  navigates to it anymore (the toggle was its only entry point).

### Not in scope

- Sidebar / top-nav quick-filter counts stay global (not scope-narrowed).
- Watching / Time / admin views keep hiding the toggle (unchanged chrome
  gating in `AppController._togglePanes`).

## Touched files

- `js/controllers/AppController.js` — uiState.scope, setScope, persist/restore
  (+ 'mine' migration), pass scope to getFiltered.
- `js/models/TaskModel.js` — scope param in getFiltered.
- `js/views/TopbarView.js` — click → setScope; highlight by scope; subscribe
  to scope:changed.
- `js/views/TaskListView.js` — re-render list on scope:changed.
- `tests/redesign-topbar.spec.js` — toggle no longer changes the title; assert
  scope survives switching to Urgent.
