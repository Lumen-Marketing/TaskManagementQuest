# Wallboard ("TV mode") — design

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan
**Scope:** New full-screen, auto-refreshing team display view.

## Goal

A full-screen, chrome-less "office TV" board that shows the whole company team
and each person's open tasks, refreshing live. Entered from the sidebar, exited
with Esc or an "Exit" button. Intended for an always-on wall display as well as
an at-a-glance status check.

## How it plugs into the existing app (no new architecture)

- **New view:** `js/views/WallboardView.js`, built like `js/views/HomeView.js` —
  constructor takes the models + controller, subscribes to the EventBus, and
  shows/hides itself based on the active view.
- **New view key:** `wallboard`. Registered in `AppController` alongside the
  other views: added to `canView`, to the persisted-view allowlist, and handled
  in `setView`.
- **Entry:** a "Wallboard" sidebar nav item (via `SidebarView`'s section
  config), which calls the existing `controller.setView('wallboard')`.
- **Takeover:** entering the view adds a `body.wallboard-active` class that hides
  the deck (sidebar) and topbar and lets the wallboard render full-bleed. Esc or
  the "Exit" button calls `setView(previousView)` and removes the class. The Esc
  handler must not fire while a modal is open.
- **Data:** reuses `controller.visibleTasks()` (already company-scoped and
  RLS-aware) and `App.utils.activePeople()` for the roster. Role/company scoping
  is inherited for free — no new queries.
- **Live updates:** re-render on the EventBus events the app already emits
  (`tasks:changed`, `people:changed`, `company:changed`) — that is the realtime
  path — plus a 60s `setInterval` fallback re-fetch. The header clock ticks on
  its own 1s timer. **All timers are cleared on exit** to avoid leaks/background
  work.
- **Theme:** pure token-based CSS, so it follows the app's current light/dark
  theme automatically.

## What renders (matches the approved screenshot)

- **Header:**
  - Left: title `Quest HQ — Today` and a date/subtitle line
    ("everybody's tasks for the day").
  - Right: `ACTIVE` / `DONE` / `BLOCKED` counts, a live clock, and the "Exit"
    button.
- **Grid:** one card per active person in the current company:
  - Avatar, name, role, and open-task count.
  - That person's open tasks sorted **blocked → overdue → soonest due**,
    capped at ~4 visible with a "+N more" line.
  - Blocked tasks get a red-tinted row + `BLOCKED` badge; the leading status dot
    is colored by priority.
  - Responsive auto-fit grid.
- **Footer:** "● Live · Auto-refreshing · press Esc to exit".

## Confirmed decisions

- **Entry:** sidebar nav item; the mode is a full-screen takeover.
- **Scope:** current company, each person's open tasks.
- **Refresh:** Supabase realtime (via existing EventBus) + 60s fallback.
- **Theme:** follows the app's current theme.
- **Zero-task people:** still shown, with an "All clear ✅" empty row, so the
  board reflects the whole team.
- **Overflow:** if more people than fit one screen, the board scrolls (v1).
- **Permission:** anyone who can view Home (`home.view`); data stays scoped by
  what each viewer is allowed to read.

## Non-goals (YAGNI — possible follow-ups, not v1)

- Auto-rotating / paginating pages of people for very large teams.
- A dedicated bookmarkable `#tv` URL route (entry is via the sidebar for v1).
- An "always dark" forced theme.
- Any write/interaction from the board (read-only display).

## Verification

- Sidebar item navigates in; Esc and the Exit button both return to the prior
  view and restore the chrome.
- Counts and per-person lists match the underlying task data for the current
  company; switching company updates the board.
- A task change elsewhere updates the board live; the 60s fallback fires when
  realtime is quiet.
- All timers (1s clock, 60s fallback) stop after exiting the view.
- Renders correctly in both light and dark theme and on a large display.
