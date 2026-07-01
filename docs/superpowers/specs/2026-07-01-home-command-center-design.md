# Home → Personal Command Center — Design

- **Date:** 2026-07-01
- **Status:** Approved (pending spec review)
- **Surface:** Home view ([js/views/HomeView.js](../../../js/views/HomeView.js)) + `.qhq-*` styles in [taskmanagement.css](../../../taskmanagement.css), live `panze-home` skin.

## Goal

Rework the Home dashboard into a **personal command center**: viewer-scoped (your tasks), but with a premium, sectioned, lightly-analytical treatment inspired by three reference dashboards. Emphasize section headers, add trend cards + a mini calendar, and reorganize the existing cards into a two-column layout. The company-wide **Reports** page is unchanged and remains the deep-dive.

## Non-goals (YAGNI)

- **No hourly timeline.** Tasks are date-based (a due *date*, no clock time), so the reference's 07:00/07:30 agenda cannot map. The calendar is a day/month glance, not a time grid.
- **No new financial/medical content** (payment rings, insurance cards) — those references contribute *patterns* (emphasized headers, trend cards, sparklines, a calendar), not content.
- **No colored/pastel card fills and no gray-dominant styling.** Use existing tokens only.
- **No changes to the Reports page.** Reuse its metric math, personal-scoped; don't move or duplicate its sections.
- **No full second calendar.** The Home calendar hands off to the existing All-tasks Calendar layout.

## Layout

Two-column "command center". Full-width top band and bottom Activity; a wide main column (work) beside a narrow rail (performance). Collapses to a single column on mobile (≤720px), rail after main.

```
Good morning, Shan · Tue Jun 30           [+ New task] [All] [Cal]   [ Week v ]
+------------- MAIN: your work -------------+  +---- RAIL: performance ----+
| == YOUR WORK   what needs you now         |  | == YOUR PERFORMANCE  week |
|                                           |  | [ic] Completed    12  ^13%|
| [ Up next   (your queue) ...............] |  | [ic] Open work     8  ^2  |
|                                           |  | [ic] Due this wk   5  v1  |
| [ At risk   (needs attention) .........]  |  |                           |
|                                           |  | [ mini month calendar ]   |
|                                           |  | [ Projects ring  % done ] |
+-------------------------------------------+  +---------------------------+
| == ACTIVITY   recent team activity   (full width)                        |
| [ Recents feed ......................................................... ]|
+--------------------------------------------------------------------------+
```

Grid: main ≈ 1.6fr, rail ≈ 1fr on desktop; single column below 720px.

## Section headers (the pic-3 treatment)

Every section gets an emphasized header: a **bold title** (~20px) + a **gray-muted subtitle** eyebrow, reusing the existing `.qhq-card-h`/section-header pattern promoted to a section level. The **Your Performance** header carries a **Week / Month** period toggle on the right that drives the trend numbers. Titles/subtitles:

- Your work — "what needs you now"
- Your performance — "this week" / "this month" (follows the toggle)
- Activity — "recent team activity" (managers) / "your activity" (others)

## Sections in detail

### Top band
Greeting (`Good {morning|afternoon|evening}, {firstName}`) + date line, quick actions (New task / All tasks / Calendar — unchanged behavior), and the **Week/Month** period selector (top-right). The current flat **4-count stat strip is removed** — its information is superseded by the trend cards + ring.

### Your Work (main column)
- **Up next** — viewer's open tasks, Focus order (`focusSeq`) then soonest due, top 5. Same logic as today (`_upNext`).
- **At risk** — viewer-scoped open tasks that are overdue or on hold, with reason + chip. Same logic as today (`_atRisk`).
- These keep their current row markup, animations, and empty-state heroes; they are simply re-homed into the wide column.

### Your Performance (rail)
**Trend cards (3).** White cards (same surface as the rest). Each: a tinted duotone **icon chip** (existing tone), the **label**, a big **value** (tabular figures, ink), a **trend badge** (↑/↓ + delta) colored **green when improving / rust when worsening**, and a **sparkline** (last 8 buckets) stroked in the accent. No fills, no gray badges. Color is never the only signal — the arrow direction and number carry it too.

| Card | Value (current period) | Trend vs previous period | Good direction |
|------|------------------------|--------------------------|----------------|
| Completed | tasks with `completedAt` in period, assignee = me | Δ% vs previous period | up = good (green) |
| Open workload | open tasks (`status != done`) assigned to me, **now** | vs open count reconstructed at period start | down = good (green) |
| Due this week | open tasks with `due` in the next 7 days | vs tasks that were due in the previous 7 days | down = good (green) |

**Mini month calendar.** A compact month grid for the current month: weekday header, day cells, **today highlighted** (brand accent), days with tasks due marked with a **dot** (rust dot if any overdue that day, else accent). Clicking a day opens the existing full **Calendar** layout focused on that date (`setView('all')` → `setLayout('calendar')`, seeded to the clicked date if the calendar supports a focus date; otherwise open calendar and scroll to the month). Prev/next month arrows are in scope only if cheap; default is current month.

**Projects ring.** The existing `% complete` progress ring + per-status progress bars, compact, unchanged in behavior (already polished).

### Activity (full-width bottom)
**Recents** — the existing activity feed (`_recents`), full-width so the feed stays readable. Manager vs personal scoping unchanged.

## Visual & token rules

- Cards: existing white `--surface`, `--block-line` hairline, existing radius. No new fills.
- Accents: only existing tokens — `--amber` (brand), `--blue`, `--rust`, `--green`, and the `-bg`/`-ink` variants for tinted chips. No new pastels, no gray cards/badges.
- Trend badge: `--green` (improving) / `--rust` (worsening); arrow glyph + number always present.
- Sparklines: stroked in the metric's existing tone (or `--amber`), no fill.
- Numbers: tabular figures (`tnum`).
- Icons: existing inlined Solar duotone set + per-icon animations already in place.

## Data & computation

Scope: `controller.currentUser`; `controller.visibleTasks({ includeDone: true })`, filtered to `assignee === me` for personal metrics.

- **Period selector** — `Week` = rolling 7-day window; `Month` = rolling 30-day window (mirrors ReportsView `_rangeStart`). "Current period" = `[now - L, now)`, "previous period" = `[now - 2L, now - L)`, where `L` = 7 or 30 days.
- **Trend %** — `round((current - previous) / max(previous, 1) * 100)`; render `—` when previous is 0 and current is 0. Direction/color from the card's *good direction*, not raw sign.
- **Sparkline** — value across the **last 8 buckets** (bucket = 1 week in Week mode, ~1 month in Month mode). Reuse the ReportsView weekly-bucketing approach (`completedAt` within `[bucketStart, bucketEnd)`); for Open workload, sample the reconstructed open count at each bucket boundary via `openAt(T) = createdAt <= T && (!completedAt || completedAt > T)`.
- **Mini calendar** — for each day of the current month, count tasks (assignee = me, open) whose `due` equals that day; mark overdue if that day `< today` and still open.
- **Projects ring** — unchanged (`_statusMix`, `donePct`).

## Component boundaries

`HomeView.render()` stays the single entry point but is decomposed into focused section builders so it doesn't grow unwieldy: `_periodWindow()`, `_trendMetrics()` (returns the 3 cards' {value, prev, spark[]}), `_miniCalendar()` (returns weeks/day cells), plus the existing `_upNext`/`_atRisk`/`_recents`/`_statusMix`. Markup helpers: `sectionHead(title, subtitle, controlHtml)`, `trendCard(metric)`, `sparkline(series, tone)`. A small `_sparklinePath(series, w, h)` returns an SVG polyline points string. Interaction wiring (period toggle, calendar day click, existing row/action handlers) is attached after render, following the current pattern.

## Motion

Carries over the existing dashboard motion (entrance cascade, count-up on values, hover signatures, the flame/activity loops) — all already `prefers-reduced-motion`-gated. New elements: trend-card values count up on entrance; sparklines may draw in (stroke-dashoffset) on first paint, motion-safe only; calendar cells fade in with the cascade. No new perpetual loops.

## Testing impact

`tests/home-reports.spec.js` currently asserts `.qhq-stat` × 4 (the removed stat strip), `.qhq-greet`, `.qhq-un-row`, `.qhq-rec-row`, `.qhq-recents .meta` containing "team"/"your". The stat-strip assertion must be updated to target the new **trend cards** (e.g., `.qhq-trend` × 3); the greeting, up-next, recents, and meta assertions remain valid and must stay green. `tests/restyle-blocks.spec.js` is already stale (pre-panze tokens) and is out of scope.

## Reports relationship

`ReportsView.js` is untouched. Home reuses the *approach* of its `_metrics()` bucketing (throughput per week, range start) re-implemented personal-scoped in `HomeView`; no shared-module extraction unless the plan finds it cheap and clean.

## Open questions

None blocking. Metric count settled at 3; if the rail feels tall in build, the ring can move under Recents as a fallback (noted, not chosen).
