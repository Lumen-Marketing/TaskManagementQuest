# Inline per-field editing on the task detail page (Details card)

**Date:** 2026-07-01
**Status:** Approved (design); ready for implementation
**Surface:** Task detail page — the Details card (`App.TaskDetailView`)

## Problem

Changing one detail (status, assignee, due date…) currently requires clicking the
global **Edit** button, which opens a full staged form for every field at once. The
user wants to click a single value, change just that one thing, and save it — without
entering the whole edit form.

## Goal

Make each value in the **Details card** click-to-edit. Clicking a value turns it into
the appropriate inline editor with a **✓ (save)** and **✗ (cancel)** control. Nothing
saves until ✓ is clicked. One field is editable at a time.

## Non-goals (YAGNI)

- Inline editing of Title, Description, Watchers, or Subtasks — those keep using the
  existing **Edit** button (which stays).
- Editing "Time spent" — it is auto-calculated from time entries (read-only).
- Auto-save without confirmation (explicitly rejected in favor of ✓/✗).
- Any change to `updateTaskField` / `reassignTask` — they already do everything needed.

## Editable fields & save path

Details-card rows that become inline-editable, with their editor and save call:

| Field | Editor | Save via |
|---|---|---|
| Status | `<select>` (App.STATUSES) | `updateTaskField(id, 'status', v)` |
| Priority | `<select>` (App.PRIORITIES) | `updateTaskField(id, 'priority', v)` |
| Assignee | `<select>` (`peopleInCompany(t.company, currentUser)`) | `reassignTask(id, v)` |
| Due | `<input type="date">` | `updateTaskField(id, 'due', v)` |
| Time | `<input type="time">` | `updateTaskField(id, 'dueTime', v || null)` |
| Reminder | `<input type="datetime-local">` | `updateTaskField(id, 'reminderAt', v || null)` |
| Type | `<select>` (App.TASK_TYPES) | `updateTaskField(id, 'type', v)` |
| Bid status (only when `type==='bid'`) | `<select>` (App.BID_STATUSES) | `updateTaskField(id, 'bidStatus', v)` |
| Label | `<select>` (App.TASK_LABELS) | `updateTaskField(id, 'label', v)` |
| Company | `<select>` (App.COMPANIES, scoped) | `updateTaskField(id, 'company', v)` |
| Time spent | — | read-only |

Both `updateTaskField` and `reassignTask` already: gate on `App.can('tasks.write')`,
write the value, push a "changed X" activity entry, mark the row dirty (so it syncs to
Supabase on the normal debounce), and emit `tasks:changed`. `updateTaskField` also
notifies watchers on status/priority changes; `reassignTask` notifies the new assignee.

Assignee uses the company-scoped people list; if the new assignee is in a different
company the existing reassign rules still apply (no new validation here).

## Interaction

- **Affordance:** editable values get `cursor:pointer`, a subtle hover background, and a
  faint pencil icon on hover. Only rendered as editable when `App.can('tasks.write')` —
  read-only viewers see plain values (same gate as the Edit button).
- **Open:** clicking a value replaces that row's value cell with the field's editor plus
  a green **✓** and grey **✗**. The editor is focused (and date/time editors call
  `showPicker()` where supported).
- **One at a time:** opening a field first cancels any other open inline editor (nothing
  is saved without ✓), so only one editor is ever on screen.
- **Keys:** **Enter = ✓ (save)**, **Esc = ✗ (cancel)**. ✗ / Esc / opening another field
  reverts to the display value with no save. (No blur-to-cancel, to avoid the classic
  race where clicking ✓ blurs the input and cancels before the save registers.)
- **Save (✓):** call the field's save fn, clear the inline-edit state, let the resulting
  `tasks:changed` re-render the card with the new value, and show a small "Saved" toast.

## Render guard (don't lose the open editor)

`render()` already early-returns while `this.editingId` is set (full Edit mode) so a
background re-render doesn't wipe unsaved input. Add the same protection for inline
editing: a `this.inlineEditField` field (the field key currently open, or null). While
set and the selection is unchanged, `render()` returns early. The ✓ handler clears
`inlineEditField` **before** calling the save fn (whose `tasks:changed` then re-renders
to show the saved value); ✗/Esc clears it and re-renders to restore the display.

## Files

- `js/views/TaskDetailView.js`
  - Details rows get a `data-edit-field="<key>"` marker and an `.tdp-editable` class on
    the value cell (only when writable).
  - New `_openInlineEdit(t, field)` builds the editor + ✓/✗, wires save/cancel/keys.
  - New small `_inlineEditorHtml(t, field)` (or inline) mapping field → editor markup.
  - `bindHandlers` wires `.tdp-editable` clicks → `_openInlineEdit`.
  - `render()` gains the `inlineEditField` early-return guard.
- `taskmanagement.css`
  - `.tdp-editable` hover affordance (background + pencil) and the inline-editor row
    layout (`.tdp-inline-edit` with the input + `.tdp-ie-save` / `.tdp-ie-cancel`).
- No controller / model / HTML changes.

## Error handling

- Save fns are no-ops when the user lacks `tasks.write` (already gated); the affordance
  is hidden for those users so it won't arise.
- A blank date/time/reminder commits as `null` (clears the field), matching the values
  the native pickers can produce.
- The detail render keeps its existing try/catch fallback.

## Testing

- Manual: open a task, click Status → pick a value → ✓ → value updates, activity shows
  "changed status", a "Saved" toast appears; reload shows the persisted value.
- Manual: ✗ and Esc revert without saving; opening a second field closes the first.
- Manual mobile check (≤720px): the inline editor + ✓/✗ stay on-screen and tappable.
- Extend `tests/` only if a Playwright path is convenient; otherwise manual is enough
  for this small surface (no test Supabase needed for the affordance/cancel paths).
