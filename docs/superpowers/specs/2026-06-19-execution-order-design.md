# "Today" Focus List + Sequencing — Design Spec

**Date:** 2026-06-19
**Status:** Approved design, pending implementation plan

## Problem

Managers want to set the *sequence* in which a person tackles their work. Example: "Kristine has 10 things she needs help on — line them up #1, #2, #3 in the order to do them." Quest HQ today sorts tasks only by priority / due / title / assignee / status / created. There is no way to pick a focused set of tasks and order them.

## Goal

Let a person **pick a handful of tasks into a "Today" focus list** and **drag them into the sequence** they should be done (#1, #2, #3 …). Surfaced both as a **Today tab/view** and a compact **Today side-panel widget**, sharing one underlying order.

## Decisions (from brainstorming)

- **Concept:** A **Today focus list** — select tasks into Today, then sequence within it. (Replaces the earlier "rank the whole list" idea; Today-only.)
- **Reset:** **Persistent / curated.** Today does NOT auto-clear daily. Items stay until completed or manually removed. No date logic, no cron.
- **Scope:** Per person, implicitly scoped by `assignee_id` (a task is in exactly one person's Today).
- **Who can edit:** **Managers/admins over the person, and the person themselves.** Everyone else sees it read-only.
- **Adding tasks:** Reuse the existing **bulk multi-select** → new bulk action **"Add to Today."** Single tasks can also be added from the task detail / row menu.
- **Sequencing:** **Drag-and-drop** (mouse + touch), mobile-first. `#N` numbers update automatically.
- **Storage:** **Approach A** — a single nullable numeric column on `tasks`.

## Architecture

### 1. Data model & storage

- **Migration `supabase/sql/050_add_task_today_seq.sql`:** add `today_seq REAL` (nullable) to `tasks`.
  - `today_seq IS NULL` → task is **not** in Today.
  - `today_seq` non-null → task **is** in Today, and its value is the position sort-key.
  - One column captures both **membership** and **order**.
- Because each task has one `assignee_id`, this column *is* "this person's Today queue position." No separate table.
- **`today_seq` is a sort key, not the displayed number.** The `#1/#2/#3` badge is the task's **position** in the sorted Today list, computed at render time. Stored values never need renumbering.
- **`SupabaseDataStore`:** map `today_seq` ↔ `todaySeq` on load and save (`js/services/SupabaseDataStore.js`).
- **`TaskModel`:**
  - include `todaySeq` on the in-memory task;
  - `addToToday(id)` → set `todaySeq` to `(max existing todaySeq for that assignee) + 1` (appends to bottom), mark dirty, emit `tasks:changed`;
  - `removeFromToday(id)` → set `todaySeq = null`, mark dirty, emit;
  - `setTodayOrder(id, newSeq)` → set `todaySeq`, mark dirty, emit;
  - `todayFor(userId)` → active tasks (status not `done`, not cleared) with non-null `todaySeq`, sorted ascending.

#### Midpoint insertion (drag to reorder)

Dropping a task between Today neighbors with seq `a` and `b`:
- between two items → `(a + b) / 2`
- at the top → `firstSeq − 1`
- at the bottom → `lastSeq + 1`
- into an empty Today → any starting value (e.g. `0`)

Only the **moved task** is dirtied per drag (fits the existing 350 ms debounced save).

### 2. Adding / removing tasks (membership)

- **Bulk:** the app already has multi-select + a bulk actions bar (`BulkActionsView`, `AppController.bulkSelected`). Add a bulk action **"Add to Today"** that calls `addToToday` for each selected task. This is the "click a couple of tasks and bunch them into Today" flow.
- **Single:** an "Add to Today" / "Remove from Today" toggle on the task row menu and/or task detail panel.
- **Permission-gated:** only the assignee or a manager/admin over them can add/remove a given task. (It is a column update on a task they can already edit.)

### 3. Today tab / view

- A **"Today"** entry in navigation (view key e.g. `today`, scoped to the viewer; managers can open a person's Today via the existing `person:{userId}` context).
- Renders the person's Today list **sequenced and draggable**, each row showing the `#N` badge and title. Clicking a row opens the task detail.
- Only **active** tasks appear (status not `done`, not cleared). Completing a task drops it out; `today_seq` is left as-is (harmless — it no longer matches the active filter).
- Drag enabled only when the viewer may edit (assignee or their manager); otherwise read-only.

### 4. "Today" side-panel widget

- Compact panel showing **one person's** sequenced Today list — the viewer's own, or the selected person when a manager browses a person view.
- Same rows (`#N · title`), draggable (same permission gate), click opens detail.
- **Responsive (mobile is priority):** desktop = pinned side panel; at ≤720px it collapses into a toggleable section/sheet rather than a cramped sidebar, so it never competes with main content. Hidden when the context has no single person.

### 5. Drag-and-drop mechanics (shared)

- One small reusable helper, `js/views/dragOrder.js`, used by both the Today tab and the widget.
- Supports HTML5 drag for mouse **and** a pointer/touch fallback for mobile (touch-drag).
- On drop it computes the new midpoint seq and calls `AppController.setTodayOrder(id, newSeq)`.
- **`AppController`** gains `addToToday(ids)`, `removeFromToday(id)`, `setTodayOrder(id, newSeq)` — each does a permission check, calls the matching `TaskModel` method, and lets persistence flow through the existing debounce + optimistic `updated_at` concurrency control.

### 6. Edge cases

- **Reassign:** on reassign, `today_seq` is **reset to `NULL`** (task leaves the old person's Today). Wired into the existing `reassign(id, newAssignee)` path in `AppController`.
- **Delete / clear:** the row leaves Today. Neighbors' midpoints remain valid — no renumbering.
- **Complete:** task stays out of the active Today list (filtered by status). If reopened (status back to non-done) and `today_seq` is still set, it reappears in Today at its old position — acceptable.
- **Concurrency:** two editors reorder the same person's Today → existing per-task `updated_at` conflict resolution applies. Worst case a task lands at a stale position and is re-dragged. Fine for short lists.
- **Permissions / RLS:** setting `today_seq` is a column update on a task the editor can already edit. Verify the existing task-UPDATE RLS covers (a) the assignee updating their own task and (b) a manager updating a report's task. If a worker cannot update this column on a manager-created task, a small RLS migration may be required — confirm during planning.

## Testing

- **Playwright critical-path:** select two tasks → "Add to Today" → open Today → drag #3 above #1 → assert badges renumber → reload → assert order and membership persist; remove a task → assert it leaves Today.
- **Unit:** midpoint math (between two values, top, bottom, empty Today) and `addToToday` append logic.

## Out of scope (YAGNI)

- Daily auto-reset / carry-over flow (chose persistent curated list).
- Ranking a person's *entire* task list (Today-only).
- Company-wide global ordering across assignees.
- Auto-prioritization / suggested order.
