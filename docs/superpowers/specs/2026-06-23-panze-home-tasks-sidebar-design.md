# Panze-style redesign — Home, All Tasks, and Sidebar

**Date:** 2026-06-23
**Status:** Design approved (verbal), pending written-spec review
**Scope owner:** UI redesign program ([[project_ui_redesign_program]])

## Goal

Re-skin three surfaces — the **Home** screen, the **All Tasks** screen, and the
**sidebar** (while on those two screens) — to mimic the soft, light, rounded
"Panze" dashboard aesthetic the user supplied as a reference: white/lightly-tinted
cards with large corner radii, soft shadows, pastel accents, colored pills and
progress bars, a geometric sans typeface, and a gentle gradient background wash.

This is a **scoped re-skin**, not a global one. The rest of the app (Reports,
People, Time, Org, Admin, detail panels, modals) keeps the existing
`ui-command-center` look. Home and All Tasks diverge intentionally.

## Non-goals

- No global chrome rebuild. The fixed topbar stays as-is structurally.
- No fake finance data. The mockup's Income/Invoice/Meetings/Tickets cards are
  Panze's domain — we reuse their *card styling*, not invent numbers. Any future
  "invoice/meeting" card on Home must be fed by real Quest HQ data, decided later.
- No change to the existing **Table**, **Kanban**, or **Calendar** layouts'
  behavior. The Cards view is purely additive.
- No data-model, RLS, or backend changes. Pure front-end (markup + CSS + a new
  render path + a body-class toggle).

## Key decisions (approved)

1. **Aesthetic:** Panze look applied to Home + All Tasks only.
2. **All Tasks list:** add a new **Cards** view alongside Table (toggle in the
   View menu); Table stays as the default and is unchanged in behavior.
3. **Sidebar:** also re-skinned to the Panze look, **scoped to Home/All Tasks**
   (it reverts to the command-center rail on other views) so it stays consistent
   with "these two pages only." Flipping it globally is a one-selector change if
   the user later wants that.
4. **Theme-aware:** the Panze skin ships a **light variant (default, matches the
   mockup) + a dark variant**, so it respects the existing theme toggle
   ([[project_ui_redesign_program]] dark mode) instead of fighting it.

## Scoping mechanism

A body class gates every Panze rule so nothing leaks:

- `AppController.setView()` already emits `view:changed`. Add a small helper there
  (or a `view:changed` listener) that toggles:
  - `body.panze-home`  when `uiState.view === 'home'`
  - `body.panze-tasks` when `uiState.view === 'all'`
  - neither otherwise.
- All new CSS is written under `body.panze-home …` / `body.panze-tasks …`
  (and `[data-theme="dark"] body.panze-* …` for the dark variant).
- The sidebar restyle is scoped the same way: `body.panze-home .deck`,
  `body.panze-tasks .deck`. Because the deck is shared chrome, scoping by body
  class means it only adopts the Panze rail on those two views.

This composes with the existing `ui-command-center` rules by adding a more
specific layer; it does not delete or rewrite command-center CSS.

## Typeface

Load **Plus Jakarta Sans** (the geometric sans in the mockup) via a `<link>` in
`app.html` head (preconnect + font CSS). It is applied only under the Panze body
classes via `--font-body`/`--font-display` overrides, so other views keep IBM
Plex. Fallback stack: `'Plus Jakarta Sans', 'Inter', system-ui, sans-serif`.

## Surface 1 — Home (`HomeView.js` → `#homeWrap` → `.qhq-home`)

Keep every existing data method (`_stats`, `_upNext`, `_atRisk`, `_recents`,
greeting/date). Re-lay-out and re-skin into a Panze bento. New markup (still
`.qhq-*` classes so existing wiring/handlers keep working where possible; new
classes added where new structure is needed):

- **Header:** greeting + date (left), rounded search field + pill quick-actions
  (right). Quick actions reuse `.qhq-act` handlers (New task / All tasks /
  Calendar).
- **Stat strip:** 4 soft, rounded stat cards (Open / Due today / Overdue / Done
  this week) from `_stats()` — Panze tinting, large numerals.
- **Projects-overview donut:** a CSS `conic-gradient` donut built from the real
  status mix of the user's visible tasks (To do / In progress / Done counts),
  with a legend — mirrors the mockup's "Projects Overview" donut. New small
  helper `_statusMix()` on HomeView (derived from existing visible-task set).
- **Up next** and **At risk:** rendered as pastel task cards (reusing
  `_upNext()`/`_atRisk()` data and the existing click-to-open handlers).
- **Recents:** activity feed card from `_recents()`.
- **AI brief:** kept as a slim top banner (existing `.qhq-brief`), restyled.

The gradient wash is applied to the Home content background; cards float on it.

## Surface 2 — All Tasks: new **Cards** view

- **New layout key `'cards'`.**
  - `ToolbarMenuView` view menu: add `{ key: 'cards', label: 'Cards',
    icon: 'ti-layout-grid' }` to the `layouts` array.
  - `AppController`: add `'cards'` to the two layout whitelists at
    `AppController.js:237` (restore from storage) and `:1385` (saved views) so
    the choice persists and round-trips. `setLayout()` itself needs no change
    (it stores any value).
  - `TaskListView._renderListInner()`: add `if (layout === 'cards') return
    this.renderCards();` alongside the kanban/calendar branches.
- **`renderCards()`** renders a responsive CSS-grid of Panze task cards into
  `this.body` (respecting current grouping/filtering via the same task set the
  table uses). Each card: a colored left/top priority edge, a type glyph, title,
  truncated description, assignee avatar + name, due chip, and a status check —
  reusing existing task fields, `controller.selectTask(id)` on click, and the
  bulk-select / selection-highlight plumbing (`data-id`, `.selected`,
  `.bulk-check`) so `_syncSelectionHighlight()` keeps working.
- **Table restyle:** while `body.panze-tasks` is active, the existing table gets
  a light Panze treatment (rounded container, soft rows) without structural
  change.
- The page-head widgets (Up next / Focus / Progress) and toolbar remain; they get
  the Panze card styling under the scoped class.

## Surface 3 — Sidebar (Panze rail, scoped)

Under `body.panze-home` / `body.panze-tasks`, the `.deck` adopts the mockup's
slim, clean rail: light surface, rounded active pills, soft icon treatment,
Plus Jakarta labels. No JS change — the logo-toggle minimize/expand behavior
([[project_ui_redesign_program]] sidebar work) is preserved; only colors,
radii, and spacing change via scoped CSS. On other views the deck reverts.

## Files touched

| File | Change |
|---|---|
| `taskmanagement.css` | New scoped Panze block (home, task cards, table restyle, sidebar, light+dark) appended at end |
| `app.html` | Plus Jakarta Sans `<link>` (preconnect + font) in `<head>` |
| `js/controllers/AppController.js` | Toggle `body.panze-home`/`panze-tasks` on view change; add `'cards'` to the two layout whitelists |
| `js/views/ToolbarMenuView.js` | Add Cards entry to the View menu |
| `js/views/TaskListView.js` | `renderCards()` + dispatch in `_renderListInner()` |
| `js/views/HomeView.js` | New Panze markup + `_statusMix()` helper |

No changes to SidebarView.js (CSS-only), models, services, or SQL.

## Error / edge handling

- **Empty states:** Home cards and the Cards view reuse the existing empty-state
  copy (`.qhq-empty`, "No open tasks", etc.).
- **Mobile (≤720px):** the Panze bento collapses to a single column; cards go
  full-width; the donut and stat strip stack. Must not introduce horizontal
  scroll ([[project_grid_minmax_clipping]], [[project_mobile_friendly_priority]]).
- **Theme toggle mid-view:** dark variant rules keyed on
  `[data-theme="dark"] body.panze-*` flip instantly with the existing toggle.
- **Reduced motion:** any hover lift/transition respects
  `prefers-reduced-motion` like the rest of the app.

## Testing / verification

Playwright render checks (the established pattern in `verify_out/`, using the
system browser channel):

1. Home in light + dark at 1280 / 900 / 480 px — bento lays out, donut renders,
   no horizontal overflow, contrast holds.
2. All Tasks: switch View → Cards; confirm cards render, click opens detail,
   selection highlight works, and Table view still renders unchanged.
3. Navigate Home → Reports → confirm the Panze skin and sidebar fully revert
   (no leakage).
4. Confirm `cards` layout persists across reload (whitelist round-trip).

## Risks

- **Specificity creep:** Panze rules must out-specify command-center without
  `!important` sprawl. Mitigation: scope every rule under the body class (already
  higher specificity) and reuse existing tokens where possible.
- **Sidebar flip feels abrupt** when navigating between Panze and non-Panze
  views. Acceptable per the "two pages only" decision; revisit if jarring.
- **Two type systems** loaded (IBM Plex + Plus Jakarta). Minor weight cost; font
  is scoped and lazy via `<link>`.
