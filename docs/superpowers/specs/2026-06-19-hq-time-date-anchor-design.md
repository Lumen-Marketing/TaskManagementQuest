# HQ-time (Phoenix) date anchor — Design Spec

**Date:** 2026-06-19
**Status:** Approved design, implementing

## Problem

The app mixes two clocks. Times (clock-in, due-time labels) are shown in the HQ zone via `App.timezone()` (America/Phoenix). But what counts as **Today / Tomorrow / Overdue / due-today** is computed by `App.utils.todayISO()` using `new Date()` on the **device's local clock**. So a task dated `Jun 19` reads "Today" for an Arizona user but can read "Tomorrow"/"Overdue" for someone whose laptop is on another timezone (or near a day boundary). Reminders have the same issue — they fire on the device's local wall-clock.

## Goal

Make the **HQ (Phoenix) calendar date and wall-clock the single source of truth** for every user: Today/Tomorrow/Overdue/due-today and reminder firing are judged against Phoenix time regardless of device timezone.

## Decisions (from brainstorming)

- **Anchor:** HQ time is the source of truth for everyone (not per-device local).
- **Scope:** Dates **and** reminder firing.
- **Approach:** A (central anchor) — one helper + change `todayISO()`; everything else inherits it. No DB change, keep the wall-clock model.
- **Anchor zone:** `App.HQ_TIMEZONE` (org-wide), not the per-user `App.timezone()`, so "today" is identical for all users.

## Architecture

### 1. Helpers in `js/utils.js`

- `zoneOffsetMs(ms, tz)` *(private)* — the zone's UTC offset at instant `ms`, via `Intl.DateTimeFormat(..., { timeZone: tz, hour12:false, y/m/d/h/m/s })` → `Date.UTC(parts) - ms`. DST-safe (recomputed per instant).
- `hqWallClockToMs(y, m, d, hh = 0, mm = 0)` — epoch ms for that wall-clock **in the HQ zone**. Implementation: `guess = Date.UTC(y, m-1, d, hh, mm); return guess - zoneOffsetMs(guess, App.HQ_TIMEZONE);`. Exact in one pass for a fixed-offset zone (Arizona −7); correct for DST zones too (the offset is evaluated at the guess instant, which is within the same offset window except for the rare hour straddling a DST switch — acceptable).
- `todayISO(offset = 0)` — **changed** to return the HQ calendar date:
  1. Format `new Date()` in `App.HQ_TIMEZONE` with locale `en-CA` (`{ year:'numeric', month:'2-digit', day:'2-digit' }`) → `YYYY-MM-DD` (the Phoenix date right now).
  2. Apply `±offset` days via UTC math: parse the parts, `Date.UTC(y, m-1, d + offset)`, re-read UTC parts, format `YYYY-MM-DD`. Using UTC math avoids any local-zone drift.
  - Falls back to the previous local computation if `Intl` throws on the zone id.

`toISODate(d)` is unchanged (a local-fields formatter used for calendar-grid date math, which operates on date strings, not "now").

### 2. Reminder engine — fire on Phoenix wall-clock (`js/services/ReminderEngine.js`)

Replace the three local conversions with `App.utils.hqWallClockToMs`:
- `_taskDueTimestamp(t)` — parse `t.due` (`Y-M-D`) + `t.dueTime` (default `23:59`) → `hqWallClockToMs(y, m, d, hh, mm)`.
- `_parseLocal(s)` — the user-set `reminderAt` (`YYYY-MM-DDTHH:MM`) → `hqWallClockToMs(...)` of those parts. (Rename/retain the method; it now means "parse as HQ wall-clock".)
- `_morningOf(dueTs)` — derive the due date's **HQ** Y-M-D (format `dueTs` in HQ zone), then `hqWallClockToMs(y, m, d, MORNING_HOUR, 0)`.

Effect: "8 AM morning-of", "4h before", "due now", and user reminders all resolve to Phoenix wall-clock for every viewer. The `fired` dedup keys on the window timestamp, so each window may fire once more after deploy (harmless one-time catch-up).

### 3. Inherited (verify, no new logic)

These derive from `todayISO()`/`formatDue` and become HQ-correct automatically; the plan verifies each renders right:
- `TaskModel.groupTasks` / `groupByDue` (Today/Tomorrow/This week/Overdue/Later buckets)
- `utils.formatDue` (Today/Tomorrow/overdue labels + classes)
- `TaskModel.getFiltered` (`today`, `overdue`, and `dueRange` filters)
- `SidebarView` counts (`cnt-today`, `cnt-overdue`, …)
- `UpNextWidgetView`, `ProgressWidgetView`
- `TaskListView.renderCalendar` (the `today` cell highlight + default anchor)
- `NewTaskModalView` (default due = `todayISO()`)

## Edge cases

- **Arizona has no DST** → constant −7; helper is DST-safe regardless.
- **Near Phoenix midnight**: a user at 1 AM eastern still sees the Phoenix date — intended.
- **Invalid HQ zone id**: helpers fall back to local so a render never throws.
- **Reminder re-fire once** after deploy due to changed timestamps — accepted.

## Testing

- Unit: `hqWallClockToMs(2026, 6, 19, 8, 0)` equals the known UTC instant for 08:00 Phoenix (`Date.UTC(2026,5,19,15,0)`); `todayISO()` returns the Phoenix date for a stubbed `Date`/zone where local and Phoenix dates differ (assert it follows Phoenix, not local).
- Behavior: a task dated Phoenix-today reads "Today" / `due-today` even when the simulated device zone is on a different date.
- Reminder timing: morning-of and at-due windows compute to the HQ instant (assert `_windowsFor` timestamps).

## Out of scope (YAGNI)

- Per-user timezone display preference (anchor is org-wide for now).
- Migrating due dates to timestamptz (Approach C).
- Changing `toISODate`'s local-fields behavior (calendar-grid math only).
