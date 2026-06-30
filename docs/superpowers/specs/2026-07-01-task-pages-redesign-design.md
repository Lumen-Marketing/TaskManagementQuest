# Task pages redesign — detail page + new-task create page

**Date:** 2026-07-01
**Status:** Approved (design); ready for implementation planning
**Surfaces:** Task detail/view page, New-task creation flow

## Problem

Creating a task happens in a centered pop-up modal (`App.NewTaskModalView`). The boss
wants task creation to be a **separate full page**, not an overlay, and supplied a
mockup of a richer, card-based **task detail page**. The two surfaces should share one
visual language: the new-task page is the detail page in "input mode."

This is also aligned with the standing priority of making Quest HQ very mobile-friendly
— a full page collapses to a single column far better than a resizable centered modal.

## Goals

1. Redesign the existing task detail/view page to match the mockup's card-based layout.
2. Replace the new-task modal with a full-page create form in the same visual language.
3. Keep the app a zero-build static SPA — no framework, no build step. New view classes
   on `window.App`, CSS in `taskmanagement.css`, full mobile support (≤720px).

## Non-goals (YAGNI)

- Real call logging / CRM integration ("Log call" is a tagged note only).
- Reusable task templates.
- Keeping the modal as a fallback (it is removed).
- Persisting/restoring the "creating a task" state across reloads.
- New task statuses, types, labels, or priorities.
- The "Where this task stands" Quest AI banner from the mockup — **omitted** (Quest AI
  surfaces were already removed from the app; user confirmed to ignore it).

## Architecture & routing

The app renders full-page surfaces inside `#mainPane`, toggled by
`AppController._togglePanes()` based on `uiState.view`. The detail page already follows
the pattern we want: `TaskDetailView` mounts `#detailPane` into the full-page
`#taskDetailWrap`, hides the other surfaces (`listPane`, `homeWrap`, `reportsWrap`),
and keeps the topbar + sidebar in place. Detail open/close is driven by
`uiState.selectedTaskId` via the `selection:changed` event — **not** by `setView`.

The create page mirrors this exactly:

- A new full-page surface `<section id="newTaskWrap" class="qhq-page hidden">` in
  `app.html`, inside `#mainPane`.
- A new transient flag `uiState.creatingTask` (boolean), **not** a real `setView` view.
  Rationale: creation is transient — it must not be persisted by `_persistUiState`,
  must not appear in the sidebar, and must not go through `canView`. Modeling it as a
  view would pollute all three. A boolean flag mirrors how `selectedTaskId` drives the
  detail page.
- `_togglePanes()` (and the detail view's `_openModal`/`_closeModal` sibling-hiding
  loop) learn about `#newTaskWrap`: when `creatingTask` is true, hide every other
  surface and show `#newTaskWrap`; when false, restore whichever view is current.
- `controller.openNewTaskModal(prefill)` is renamed `openNewTaskPage(prefill)` and
  **every caller is updated** (see Caller updates) — no alias is kept. It sets
  `creatingTask = true`, remembers the return view, and emits a `newtask:changed` event
  the page view subscribes to.
- Closing the page (Cancel, Back, Esc, or after a successful create) sets
  `creatingTask = false`, emits `newtask:changed`, and calls `_togglePanes()` to restore
  the previous surface. The app's global Escape handler routes to a new
  `controller.closeNewTaskPage()` when `creatingTask` is true.

### Caller updates

Every current entry point to the modal is repointed at `openNewTaskPage`:

- `app.html` `#newTaskBtn` (toolbar) — via `TaskListView` binding.
- FAB button (`app.js`).
- Keyboard shortcut (`app.js`, the `if (document.getElementById('newTaskModal')) return`
  guard becomes a `uiState.creatingTask` guard).
- `HomeView` `'new'` action.
- `TaskListView` empty-state CTA and calendar day-click (`{ due: iso }` prefill —
  **preserved**).

### Files

- **New:** `js/views/NewTaskPageView.js` (ports logic from `NewTaskModalView.js`).
- **Removed:** `js/views/NewTaskModalView.js` and its `<script>` tag in `app.html`, plus
  the `#newTaskModal` CSS block and the modal references in `tests/tasks.spec.js` /
  `tests/responsive.spec.js` (updated to target the new page).
- **Rewritten:** `js/views/TaskDetailView.js` (template + handlers; mounting logic kept).
- **Edited:** `app.html` (new surface, script tags), `js/controllers/AppController.js`
  (routing, new action methods), `js/app.js` (wiring), `taskmanagement.css` (new card
  system, mobile rules), `js/views/HomeView.js` / `TaskListView.js` (caller renames).

## Phase 1 — Detail page redesign

A polished card layout over data the page already renders. No new task fields.

### Header
- `← Tasks` back link (existing `data-action="close"` → `controller.closeDetail()`).
- **Status / stage / type chips:** status (e.g. "To do"), and — when meaningful — the
  bid status ("Drafting", only for `type === 'bid'`) and type ("Bid / Estimate"). The
  status chip opens a small quick-status menu (todo / pending / hold / done); the others
  are display-only. Chips degrade gracefully when a value is absent.
- **Title.**
- **Meta row:** assignee avatar + name · due date with overdue badge (e.g.
  "Due Jun 18 · 7d overdue") · priority indicator.
- **Action buttons:** Comment (focus the comment composer) · Watch (toggle the current
  user in/out of `t.watchers`) · Edit (existing inline edit mode) · ⋯ overflow
  (Duplicate, Delete — Delete gated by `controller.canDeleteTask(t)`).

### Stat strip
Status pill · Comments / Watchers / Subtasks counts · overdue badge · a prominent
orange **Mark complete** button → `controller.completeTask(t.id)` (celebratory toast on
completion; flips to "Reopen" when the task is already done).

### Body — 3-column card grid
- **Left — Details card:** the existing fields (company/project, type, label, bid status
  when bid, status, assignee, created by, due, time, reminder, priority, time spent,
  watchers). Same data and lookups as today, restyled.
- **Middle — Description card**, then a **tabbed Activity / Comments / History card:**
  - *Activity* — the `t.activity` log (default tab).
  - *Comments* — existing lazy-loaded comments composer + list (`loadTaskComments`,
    `_wireComments`, `_commentsSection`).
  - *History* — recent time entries (`timeModel.entriesForTask`).
- **Right — Quick actions card** + **Watchers card** (chips + a self-add "+" that calls
  the same self-watch toggle as the header Watch button).

### Quick actions behavior (Option 1 — all wired)
- **Reassign / Set due / Add subtask** — small inline popovers anchored to the button,
  reusing existing dropdown/popover styling. Each commits through the existing task
  model + notify paths (same code edit mode uses), so no new persistence logic.
- **Add note** — posts a comment via the existing comment path.
- **Log call** — posts a comment tagged/prefixed as a logged call (lightweight; no new
  data model).
- **Duplicate** — clones the task into a new draft by calling `controller.createTask`
  with the source task's fields (new title prefixed "Copy of …"; subtasks reset to
  not-done; no activity/comments copied).

### Preserved behavior
Clock-in / active-timer banner, delegation banner ("X assigned by Y"), Edit mode,
Delete (moved into ⋯), graceful fallback when a task references a removed person/company,
the render error fallback with a working Back button.

## Phase 2 — New-task create page

Same grid and card shells as the detail page, in input mode. Reuses ported logic from
the modal: time input mask (`_maskTime`/`_parseTime`), `App.validate.newTask`, watcher
picker, subtask adder, notify options, company-scoped assignee/watcher re-scoping.

### Layout
- **Header:** `← Tasks` back + title "New task".
- **Left — Details card (inputs):** company, type, label, bid status (shown only when
  type = bid), assignee, due, time, reminder, priority, initial status.
- **Middle:** large **title** input + **description** textarea, **subtasks** adder, and
  the **Notify on create** box (email assignee / in-app / email watchers / WhatsApp).
- **Right — Watchers card:** add/remove watchers (company-scoped).
- **Footer:** sticky **Cancel / Create & notify**. `Ctrl+↵` submits; Esc/Cancel/Back
  closes via `closeNewTaskPage`.

### Omitted vs. detail page
Activity, History, stat strip, Mark complete, Quick actions, comments — none apply to a
task that does not exist yet.

### Preserved
`due` prefill (calendar day-click), the delegation banner that appears when assignee ≠
creator, validation field-error highlighting + toast, current-user-as-creator lock.

## Mobile (≤720px)

The 3-column grid collapses to a single stacked column. On the detail page, Quick
actions and Watchers fall below the main content; the **Mark complete** button becomes a
sticky bottom action bar. On the create page, the primary **Create** button becomes the
sticky bottom bar. Native date/time pickers; touch targets ≥44px. This must be verified
with the mobile-responsive-testing flow before the work is considered done.

## Data flow & error handling

- No schema changes. No new Supabase columns or migrations. Duplicate/Add note/Log call
  all go through existing `createTask` / comment paths, which already enforce RLS and
  notify rules.
- Self-watch toggle edits `t.watchers` through the same save path the edit form uses.
- Render stays defensive: missing person/company lookups fall back to placeholders; a
  thrown render shows the existing "Couldn't open this task" message with a Back button.

## Testing

- Update `tests/tasks.spec.js` and `tests/responsive.spec.js` to drive the create
  **page** (`#newTaskWrap`) instead of `#newTaskModal`: open via the New task button,
  assert the page surface is visible, fill + submit, assert it closes and the task
  appears.
- Add coverage for: opening/closing the detail page, Mark complete, a Quick action
  (e.g. Duplicate creating a "Copy of …" task), and the create page returning to the
  prior view on Cancel.
- Manual mobile verification of both pages at ≤720px.

## Implementation order

One spec (this document); two implementation plans:

1. **Plan 1 — detail page redesign** (establishes the shared card design system).
2. **Plan 2 — new-task create page** (reuses the design system; removes the modal).

Each plan gets its own write → review → implement cycle.
