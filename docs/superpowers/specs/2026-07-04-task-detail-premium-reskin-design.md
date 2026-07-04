# Quest HQ — Task Detail Premium Reskin (Slice A) · Design Spec

*Date:* 2026-07-04
*Status:* Approved for planning
*Reference:* the "Quest HQ — Task Detail" prototype (2nd handoff). It is the visual target; where it disagrees with the app's design system, **tokens.css wins** (no hardcoded hex, no hairline borders). Where it disagrees with the app's data model, the **app wins** (per-type taxonomy, 5 priorities, multi-assignee).

---

## 1. Goal

Reskin the existing `js/views/TaskDetailView.js` to match the premium Task Detail prototype, **without rewriting its logic**. Change the markup it renders and its styling only; keep every working behavior (comments + @mentions, inline field editors, timers, complete, reassign, duplicate, activity, time history, watchers). Add the low-cost visual wins the prototype introduces and render multi-assignee.

## 2. Scope & decomposition

The full Task Detail redesign is decomposed into three shippable slices. **This spec covers Slice A only.**

- **A · Premium reskin (this spec)** — visual reskin on tokens + multi-assignee display/edit + cosmetic wins (progress bar, chip row, editable title, Call/Note comment tags). No new backend, no migrations.
- **B · Engagement actions (future)** — "I'm stuck"/blocked-on, Nudge, Request help. New data + notifications.
- **C · Comment upgrades (future)** — real reactions + comment `kind` columns.

## 3. Approach: reskin in place

`TaskDetailView.js` is ~1,296 lines of working read/edit logic. Slice A **keeps that logic** and changes:
- The **render template** (the HTML string it builds) to the prototype's structure.
- The **CSS** (new focused `css/taskdetail.css`, linked in `app.html` after `taskmanagement.css`, scoped under `#taskDetailWrap`).
- **Additive** behavior only: multi-assignee rendering, a checklist progress bar, inline-editable title, and Call/Note tags on comments.

Event bindings (`bindHandlers`), inline editors (`_openInlineEdit`, `_openDescEdit`, `_commitInlineEdit`), comment wiring (`_wireComments`), the edit modal (`renderEditMode`), and all `AppController` entry points (`completeTask`, `reassignTask`, `toggleTimerForTask`, `addTaskComment`, `duplicateTask`, `toggleSelfWatch`) are reused unchanged except where a selector/id must move with the new markup. Lifecycle (`_openModal`/`_closeModal` on `selection:changed`, full-page `#taskDetailWrap`) is unchanged.

## 4. Layout (prototype structure, app skin)

- **Header** — inline-editable title (`contenteditable`, keeps the existing title-edit path), a **chip row** (status · due · assignee) with clickable chips that open the existing inline editors/menus, and **Watch** + **Mark complete** buttons (existing handlers).
- **Brief strip** — the existing **description**, restyled as the prototype's "brief" (same data + `_openDescEdit` path; "brief" is a label, not a new field).
- **Three columns** (grid; collapses to 2 then 1 like the prototype's breakpoints):
  - **Left** — Details card (all existing inline-editable fields) + Checklist card with a **progress bar** (done/total) over the existing subtask list.
  - **Center** — the existing Comments/Activity thread, restyled, with tabs. Adds a **History** tab if a field-change view is cheap from `activity`; otherwise Comments/Activity only (keep to what exists).
  - **Right** — Quick Actions (the six that already work, restyled) + Watchers card.
- All controls keep their current ids/handlers where possible; where markup moves, update the corresponding selector in `bindHandlers`.

## 5. Multi-assignee

- **Display:** the header chip and the Details card show **all** assignees from `task.assigneeIds` (stacked avatars, lead first), not just `task.assignee`. Falls back to `[task.assignee]` for rows created before multi-assignee.
- **Edit:** "Reassign" opens a **multi-select picker** (the same custom multi-picker pattern built for New Task) so a user can add/remove assignees. On commit it writes the ordered `assigneeIds` (lead = index 0) and mirrors `assignee = assigneeIds[0]`, through a controller method that reuses the existing save + notify-fan-out path. (Depends on the New Task branch's datastore mapping + `createTask`/reassign fan-out; see §9.)
- Watcher/assignee exclusivity is preserved (a person can't be both).

## 6. Comment kind tags (cosmetic only)

The existing "Log call" and "Add note" quick actions post plain comment text (a call currently prefixes an emoji). Slice A renders a small **CALL LOG / NOTE tag** on a comment bubble when the comment was posted via those actions, using the text/marker they already write. **No `kind` column, no reactions** — those are Slice C. If the current data can't distinguish a call/note comment reliably, the tag is derived from the existing emoji/marker; anything ambiguous renders as a plain comment.

## 7. Styling

- New `css/taskdetail.css`, linked in `app.html` after `taskmanagement.css`, scoped under `#taskDetailWrap` so it can't leak. Old `.tdp-*` rules in `taskmanagement.css` are left in place; the new scoped rules override what they need to (or the template switches to new `.td2-*` classes to avoid specificity fights — implementer's choice, documented in the plan).
- Fonts via `--font-display|-body|-mono`; all color/space/radius/shadow/motion from tokens. **No hex literals, no hairline borders** (use color+contrast + `--shadow-*`). Works in light + dark; reduced-motion honored by `tokens.css`.
- Reuse the New Task visual vocabulary (pill chips, avatar stacks, menu styling) for consistency across the two screens.

## 8. Non-goals (deferred)

- "I'm stuck"/blocked-on, Nudge, Request help (Slice B).
- Comment reactions and real comment `kind` columns (Slice C).
- Any rewrite of the comment/timer/edit **logic** — reskin only.
- Any new migration (Slice A touches no schema).

## 9. Sequencing & dependencies

- Slice A **builds on `feat/premium-new-task`** (branches from it), because it reuses the custom multi-picker, the tokens-based styling approach, and the multi-assignee datastore mapping (`assigneeIds`) + reassign fan-out from that branch. New Task and this reskin **merge to `main` together** as one visual program, after the user verifies both.
- Multi-assignee editing (§5) also needs a controller `reassignTask`-style method that accepts an ordered id list and reuses the notify fan-out from the New Task `createTask` work. If that method doesn't exist yet, the plan adds a small `setAssignees(taskId, ids)` controller method mirroring `createTask`'s fan-out.

## 10. Testing

- **No logic rewrite** → existing detail behavior is preserved; existing Playwright coverage (`tasks.spec.js`) still applies.
- Add a **standalone preview page** (`taskdetail-preview.html`, stubbed sample data like the New Task preview) so the reskin is reviewable by double-click without login. `node --check` on the view.
- Manual QA: light + dark theme, mobile breakpoints (3→2→1 columns), multi-assignee display + edit, chip-row inline editors still open, comments still post, timer/complete still work, Call/Note tags render.

## 11. Risk notes

- **Selector drift:** moving markup can break `bindHandlers`/`_wireComments` selectors. Mitigate by keeping element ids stable where possible and updating handlers in the same task that moves the markup; verify each interaction in the preview page.
- **CSS specificity vs the old `.tdp-*` rules:** scope new rules under `#taskDetailWrap` and/or use fresh `.td2-*` classes so the 354KB monolith's existing detail rules don't fight the reskin.
- **Coupling to unmerged New Task work:** Slice A can't merge to `main` before New Task is verified; both ride the same branch.
