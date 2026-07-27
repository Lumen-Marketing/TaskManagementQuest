# Category Sequence Board — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with boss's approved mockup as the reference

---

## Summary

Replace the task list's default surface with a **card board grouped by category
(Task Type)**, where each category holds a manually-ordered 1‑2‑3 sequence the
user rearranges by dragging — or the ▲▼ chevrons — **directly in the list**.
There is no "Focus / Execution order" mode to enter: manual reordering becomes
the always-on default behavior of the grouped list.

This is what the boss's mockup shows: rounded category cards, numbered rows with
a grip handle and up/down movers, order saved per category.

### Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Replace focus mode, or new surface? | Neither extreme — **unify**. Same `focus_seq` order, rendered grouped. |
| What is "Category"? | **Task Type** (the customizable taxonomy). |
| Default grouping? | **Category (Type) is the new default** for everyone; manual sequence is the default order within each group. |
| Reorder gated behind a sort mode? | **No.** Drag/chevrons are always on, inline. |
| Default list surface? | **Card board replaces the default**; dense Table stays available via "View as → Table". |
| Save behavior? | **Auto-save instantly**; a Save button confirms/flushes as reassurance (never a gate). |
| Focus / "Up next" widget? | **Remove it for now.** |
| Schema change? | **None** — reuse `tasks.focus_seq`. |

---

## Non-goals (YAGNI)

- No DB migration. `focus_seq` semantics are unchanged.
- No real "unsaved changes" dirty-state machine (auto-save makes it unnecessary).
- No empty-category drop targets (only populated category groups render; cross-group
  drag still works between them).
- No removal of the existing flat `execution` sort/layout — it stays in the code,
  just no longer surfaced by a widget. (Removing it is a separate future cleanup.)
- Not touching Kanban / Cards / Calendar layouts.

---

## Data model

**Reuse `tasks.focus_seq` (migration 050) — no new column.** It is already a
per-task manual order, a nullable float supporting midpoint reorder.

Within a single category group, tasks are ordered:

1. Tasks **with** `focus_seq` — ascending by `focus_seq`.
2. Tasks **without** `focus_seq` — after the ranked ones, ordered by the existing
   `execTailCompare` (soonest due, then higher priority).

The displayed badge (1, 2, 3…) is the task's **position within its group**, not the
stored `focus_seq` value. `focus_seq` is a single global float per task; because
each group is sorted independently, overlapping values across different categories
are harmless.

**First drag assigns a concrete `focus_seq`.** A task shown by fallback order (null
`focus_seq`) gets a real midpoint value the moment it is dragged or moved, so its
position sticks.

---

## Interactions

All reorder writes go through the **existing controller seams** so persistence,
optimistic UI, and Supabase sync are already handled:

- `controller.setFocusOrder(id, newSeq)` — assign a midpoint `focus_seq`.
- `controller.removeFromFocus(id)` — (not primary here; retained for parity).
- Type reassignment via the existing general task-field setter
  `controller.updateTaskField(id, 'type', newType)`
  ([AppController.js:1589](../../../js/controllers/AppController.js)). (`updateTaskType`
  edits taxonomy *definitions* — do NOT use it for reassigning a task's category.)

### Reorder within a category
Drag a row to a new position, or press ▲ / ▼. Compute a midpoint `focus_seq`
between the nearest neighbors in that group (reuse `onExecDrop` /
`nearestOrderedSeq` logic from `ExecutionLayout.js`, scoped to the group's rows).
Chevrons move one position (swap with the adjacent row → midpoint between it and
its new neighbor).

### Move across categories ("just drop it into Admin")
Drag a row into a different category group. On drop:
1. Reassign the task's **Type** to the destination group's type.
2. Assign a midpoint `focus_seq` between the destination neighbors at the drop point.
3. Toast: `Moved to <Category> — position <N>`.

This is the boss's "you just drop it" behavior.

### Auto-save + Save button
Every drag / chevron persists immediately (auto-save, consistent with the rest of
the app). A small **"Save order"** button lives in the toolbar / page-head (NOT a
fixed bottom bar — that collides with the mobile bottom nav, `BottomNavView`). It
flushes any pending write and shows an `Order saved` toast. It is reassurance only
and is never required to persist changes.

---

## Surface & routing

### New layout adapter
`js/views/tasklist/SequenceLayout.js`, registered into `App.TaskListLayouts.sequence`
(sibling to `table`, `cards`, `calendar`, `kanban`, `execution`). It:

- Reads the active `groupBy` (default `type`) and builds one group per category,
  in taxonomy order (`App.taxonomy.activeTypes` for the current company).
- Renders each group as a **rounded card container** with a head
  (`<CATEGORY> · N tasks`) and rows in the `.focus-row` card style (reusing the
  styles fixed in commits `a5c9818` / `ae5f263`), each with: grip handle, numbered
  badge, title, priority pill, due, and ▲▼ movers.
- Only renders **populated** category groups.
- In Sequence view the order is **always the manual sequence** — the Sort control
  is inert/hidden; the Group control still works (you may group the sequence by a
  different dimension, though Type is the validated default).
- Binds inline drag via the existing `App.makeReorderable`, one drop-zone per group.

### Layout dispatch
`TaskListView._layoutKey()` resolves to `sequence` by default. The existing
`if (sortBy === 'focus') return 'execution'` branch is retained but no longer the
primary path (no widget surfaces it).

### Default changes (`AppController` initial `uiState`)
- `layout: 'table'` → **`layout: 'sequence'`** ([AppController.js:36](../../../js/controllers/AppController.js))
- `groupBy: 'due'` → **`groupBy: 'type'`** ([AppController.js:46](../../../js/controllers/AppController.js))

Persisted-view load (`initFromSavedView` / preferences) must accept `sequence` as a
valid layout and `type` grouping.

### View-as menu
Add **Sequence** to the layout list in
[ToolbarMenuView.js:131](../../../js/views/ToolbarMenuView.js) and to the
`layoutIcons` / `layoutLabels` maps (~line 270). The dense **Table** remains in the
menu as the fallback for users who want columns/other sorts.

---

## Remove the focus widget

The page head has **three** widget mounts ([app.html:168-170](../../../app.html)):
`#upNextWidget` (Up-next card), `#focusWidget` (the "FOCUS — Showing execution
order — drag rows to reorder" strip, `FocusWidgetView`), and `#progressWidget`
("Today's progress", `ProgressWidgetView`).

- Remove **`FocusWidgetView` only** — its instantiation at
  [app.js:207](../../../js/app.js) and its `#focusWidget` slot. That strip is the
  obsolete one: it exists to announce/enter execution-order reordering, which is now
  the always-on inline default.
- **Keep** `#upNextWidget` and `#progressWidget` for now. (The boss's mockup shows a
  bare head with no widgets; trimming Up-next too is an easy follow-up if wanted —
  flagged, not done here.)

---

## Components (isolation & responsibilities)

| Unit | Responsibility | Depends on |
|---|---|---|
| `SequenceLayout` (new) | Render grouped card board; wire per-group drag + chevrons; translate drops into `setFocusOrder` / type reassignment | `App.TaskListLayouts`, `App.makeReorderable`, `App.taxonomy.activeTypes`, controller seams, `execTailCompare` |
| `AppController` (edit) | New default `layout`/`groupBy`; ensure `setFocusOrder` + type update fire correctly from the sequence board | `TaskModel` |
| `ToolbarMenuView` (edit) | Expose `Sequence` in View-as; label/icon | `App.SORT/GROUP/layout` maps |
| `app.js` (edit) | Remove `FocusWidgetView` mount | — |
| CSS (edit) | Group-container card styling; reuse `.focus-row`; toolbar Save button | `taskmanagement.css` |

`SequenceLayout` is understandable in isolation: given the current tasks + active
grouping, it produces the grouped board and emits reorder intents through the
controller. It shares drag helpers with `ExecutionLayout` rather than duplicating them
(extract shared helpers into a small module if that reads cleaner during implementation).

---

## Error handling & edge cases

- **Reorder write fails (offline / RLS):** existing `setFocusOrder` path already
  surfaces failures via the app's toast/persistence layer; the board re-renders from
  authoritative state on `tasks:changed`.
- **Cross-category drop where type reassignment is disallowed** (permissions): guard
  with `App.can('tasks.write')` — if the user can't edit, the grip/movers are hidden
  (mirrors `ExecutionLayout`'s `canEdit`).
- **Task in a category the current company's taxonomy no longer has:** it falls into
  its stored type's group; if that type isn't in `activeTypes`, render it under an
  "Uncategorized" / its-raw-type group rather than dropping it.
- **Empty board (no tasks):** render the existing empty state.
- **Multi-assignee:** group/show tasks using `App.utils.isAssignee`, never
  `t.assignee ===` (the multi-assignee seam).

---

## Testing

- **Unit (`tests/unit/`, `npm run test:unit`):** the per-group ordering function
  (ranked-by-`focus_seq` then `execTailCompare` fallback, correct 1..n numbering);
  midpoint computation for within-group and cross-group drops; type reassignment on
  cross-group drop.
- **Harness (screenshot):** a `sequence-preview.html` mirroring the app's
  `#taskViewWrap` ancestry (per the screenshot-harness lesson — harness must mirror
  ID ancestors), verifying the card board in light + dark + mobile, and that Table
  view is unchanged.
- **Manual QA:** default open shows the category board; drag within + across
  categories persists after reload; Save toast; focus widget gone; Table still
  reachable and unchanged; mobile bottom nav not collided.

---

## Rollout

Static SPA, no migration → ships via the normal Vercel auto-deploy from `main`.
No DB or edge-function changes. Reversible by restoring the `layout`/`groupBy`
defaults and the `FocusWidgetView` mount.
