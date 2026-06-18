# Execution order: inline drag + always-visible Focus widget

**Date:** 2026-06-19
**Status:** Approved, implementing

## Problem

The "Focus / execution order" feature is undiscoverable and high-friction:

- The separate Focus tab was removed; the only entry points are the Sort menu's
  "Execution order" option and a page-head widget that **hides itself when empty**
  — so a user with nothing queued sees nothing and can't find the feature.
- Adding a task to the order takes three steps: Select → "Add to Focus" → switch
  Sort to "Execution order" → then drag. The user wants to *just drag*.

## Decisions (from brainstorming)

1. **Model:** inline drag to order **and** an auto-mirroring shortlist widget.
2. **Drag vs. sort:** Execution order **becomes the default view** for a single
   person — ungrouped, always draggable. Priority/Due/Status become badges.
3. **Scope:** *any single person's list.* Default sort flips to Execution order
   when viewing one person ("Mine", or a manager's `person:<id>` view). The
   multi-person "All tasks" / team views are unchanged (still grouped by Due).
4. **First drag = add + order, one gesture.** A not-yet-ordered task joins the
   sequence at the drop position; no separate "Add to Focus" step. Unordered
   tasks sit below the ordered ones and can be dragged up to join.
5. **Widget:** always visible in the page head; when empty it shows a prompt
   ("Drag tasks to set your execution order") instead of vanishing.

## What already exists (no change)

- `focusSeq` float per task (migration `050_add_task_focus_seq.sql`).
- `TaskModel.focusList(userId)`, `addToFocus`, `removeFromFocus`, `setFocusOrder`.
- `AppController.focusOwnerId()` / `canSetFocusFor(task)`.
- `App.makeReorderable()` pointer drag (mouse + touch) in `js/views/dragOrder.js`.
- Sort key `focus` labeled "Execution order" in `js/constants.js`.

## Implementation

### A. Default sort — `AppController.setView`
On entering a single-person view (`mine` or `person:*`), set `uiState.sortBy =
'focus'`. On entering any other view, if the current sort is `focus`, reset it to
`priority` so multi-person views aren't stranded on the personal sequence. Users
can still switch sort manually while in a view.

### B. Execution view — `TaskListView`
Replace `renderFocusList`/`renderFocusRow` with `renderExecutionList`/`renderExecRow`.

- **Ordered** = `focusList(ownerId)` — rank badge (1,2,3…), drag handle, ✕ remove.
- **Unordered** = owner's open, uncleared, not-done tasks with `focusSeq == null`,
  sorted by **due date then priority**, shown below a divider ("Drag up to add to
  your order"), with a drag handle (no rank, no ✕).
- One `makeReorderable` over the whole list. On drop:
  - **Dropped in the unordered zone** (after the divider in the DOM): if the task
    was ordered, `removeFromFocus`; otherwise re-render to snap it back.
  - **Dropped in the ordered zone:** compute a midpoint `focusSeq` from the
    nearest ordered rows above/below in the new DOM order, then `setFocusOrder`
    (which adds the task if it had no `focusSeq`).
- Empty state only when the person has **no open tasks at all**.

### C. Widget — `FocusWidgetView`
- Still blanks when the main list is already the execution list (`sortBy ===
  'focus'`) to avoid duplication.
- When the owner's `focusList` is empty, render a prompt card (eyebrow + hint +
  "Set order" button that flips to the execution view) instead of blanking.

### D. CSS — `taskmanagement.css`
Add `.exec-unordered` (faded rows + "+" affordance in the rank slot),
`.exec-divider`, and `.focus-widget-hint` / `.focus-widget-empty`. Reuse the
existing `.focus-*` styles.

## Permissions / edge cases

- `canSetFocusFor` unchanged: a task's order is writable by its assignee, or by a
  manager (non-worker) with `tasks.write`. Drag handles/✕ hidden when `!canEdit`.
- Completing or reassigning a task already clears `focusSeq`
  (`AppController` line ~903) — the task drops out of the ordered zone.
- Reordering among unordered tasks does not persist (they have a fixed due/priority
  sort); only dragging into the ordered zone writes a `focusSeq`.

## Testing

DB-free preview specs (`?preview=1`) exercising `TaskModel` focus methods already
exist (`tests/focus-model.spec.js`). Manual verification in the preview build:
Mine view defaults to execution order; drag an unordered task up → it gets a rank;
drag a ranked task below the divider → it leaves the order; widget shows the
prompt when empty and the top tasks when populated.
