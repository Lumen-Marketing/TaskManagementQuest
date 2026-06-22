# UI Redesign Phase 3 — Focused Polish Pass — Design

**Date:** 2026-06-23
**Branch:** feat/home-and-reports
**Status:** Approved — ready for implementation plan
**Program:** Phase 3 of [[project_ui_redesign_program]]

## Context / key finding

Phase 1 redefined the design tokens (orange `--amber: #ED4E0D`, Inter, light
palette) under `body.ui-command-center`, and **every surface already consumes
those tokens**. As a result the whole app already inherited the Linear/Notion
look as a side-effect — task list, Kanban, calendar, detail pane, new-task
modal, Team workload, Team chart, and Approvals all render cohesively with
Home/Reports (verified by screenshotting each surface under the skin).

So Phase 3 is **not a rebuild**. It is a short, targeted polish pass to remove
one inconsistency and lift the two plainest surfaces. The standalone mockup only
ever showed Home/Reports, so the rest extrapolate the same design language —
which they already do.

## Goal

Make every surface feel deliberately consistent with Home/Reports by: (A)
restricting the AI ops-brief to Home, (B) giving the Approvals and Time tables
the card treatment, and (C) a small global radius/spacing nudge.

## Constraints

- No DB migration, no new perms, no framework. Vanilla JS + `taskmanagement.css`.
- All changes scoped under `body.ui-command-center` so base light/dark themes
  stay intact ([[project_ui_redesign_program]]).
- Mobile-first: re-verify at 390px ([[project_mobile_friendly_priority]],
  [[project_grid_minmax_clipping]]).

## A. AI ops-brief → Home only

**Current:** a static `.ai-brief` section in `app.html` (lines 163–178) lives in
the list pane. `_togglePanes()` (`js/controllers/AppController.js:397`) hides the
task table + toolbar widgets for Time/Approvals/Hierarchy views but **not**
`.ai-brief`, and only hides the whole list pane for Home/Reports — so the brief
banner leaks onto every non-Home/Reports surface. The brief copy and the three
quick-filter chips (`.ai-brief-actions` → `data-brief-view="overdue|hot|watching"`)
are one coupled block.

**Change:**
1. Delete the `.ai-brief` `<section>` from `app.html` (lines 163–178).
2. Delete the now-dead `[data-brief-view]` click binding in
   `js/views/TaskListView.js` (around line 35).
3. Leave the `.ai-brief` / `.ai-chip` CSS in place (harmless, unreferenced) —
   no need to hunt it down; do not spend effort pruning dead CSS.

**Result:** Home shows its own `.qhq-brief` (unchanged); every other surface
loses the banner, leaving a clean page-head → toolbar → content flow.

**Dropped, by decision:** the Overdue / Critical+urgent / Watching quick chips go
away with the block. No capability lost — Overdue and Watching are sidebar
items; Critical+urgent is reachable via the Urgent sidebar item and the Filter
menu.

## B. Approvals + Time tables — card treatment

The Approvals table (`js/views/ApprovalView.js`, CSS `.approval-*` /
`.time-table`) and Time views (`js/views/TimeView.js`, CSS `.time-table`,
`.time-section`) are the only flat-table surfaces left. Lift them to match the
Reports card aesthetic:

- Wrap each table in a card: `background: var(--surface)`, `border: 1px solid
  var(--border)`, `border-radius: var(--radius-md)`, `box-shadow:
  var(--shadow-sm)`, with the table flush inside (no double border).
- Column headers (`th`): uppercase, `font-size: 11px`, `letter-spacing: .05em`,
  `color: var(--ink-3)`, matching the Reports/Home label style.
- Row padding comfortable (~12px vertical); row hover `background: var(--bg-2)`;
  keep the existing `.live` (active-timer) green highlight.
- Scope all rules under `body.ui-command-center`. Preserve the existing
  responsive table→card stacking on Approvals (≤1200px) and the horizontal
  scroll wrappers on phones.

## C. Small global token nudge

Within the `body.ui-command-center` token block in `taskmanagement.css`, nudge
shared radii/spacing so cards, menus, modals and chips share the softer
14px-radius / airier feel of Home/Reports:

- Ensure `--radius-md` ≈ 14px and that cards/modals/menus/kanban columns use it
  (the modal currently uses `--radius-sm`; bump the modal + dropdown menus +
  kanban cards/columns to `--radius-md`).
- Keep dense layouts (list rows, calendar cells, chips/pills) on the smaller
  radius — do **not** inflate those; only soften card-like containers.

This is the only change that touches many surfaces, so it is verified by
re-screenshotting all surfaces (below).

## Out of scope

- AI brief copy stays static (no real generation).
- No structural/markup rewrites of any view beyond the `.ai-brief` removal.
- No dark-theme work; the skin is the light command-center.

## Testing / verification

- Before/after screenshots of all 9 surfaces (list, kanban, calendar, detail,
  modal, time/workload, time/mine, approvals, hierarchy) at desktop (1320px) and
  mobile (390px), via a chromium `executablePath` script against the dev server
  (`PORT=4188 node tools/dev-server.mjs`, `?preview=1&role=developer`).
- Confirm the ops-brief banner no longer appears on any non-Home surface and
  Home still shows its `.qhq-brief`.
- Zero-JS-error sweep across all views.
- Existing `tests/home-reports.spec.js` and `tests/redesign-topbar.spec.js`
  still pass.
- Add a small assertion to a spec: `.ai-brief` is absent on the task list view.
