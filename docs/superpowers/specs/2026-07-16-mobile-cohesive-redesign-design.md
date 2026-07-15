# Mobile Cohesive Redesign — design spec

**Date:** 2026-07-16
**Scope:** Phone layout only (`@media (max-width: 720px)`). Desktop is untouched.
**Goal:** Replace the current inconsistent mobile chrome (mismatched topbar shapes/sizes, wrapping cluttered pills, squished table, stacked full-width widget cards) with one cohesive dark system anchored by an Instagram-style bottom navigation bar.

The dark palette and orange accent (`#ED4E0D`) stay. This is a cohesion + layout pass, not a re-theme. No prototype to match — unify the existing look.

---

## 1. Shared mobile primitives

A single token block, applied at `≤720px`, that every piece below reuses. This is the actual fix for "different shapes and sizes / no cohesive anything."

```
--m-pad: 16px;        /* page horizontal padding            */
--m-gap: 12px;        /* gutter between cards/controls       */
--m-radius: 16px;     /* cards                               */
--m-radius-ctl: 12px; /* buttons, chips, search             */
--m-tap: 44px;        /* min height of any tappable control  */
--m-navh: 58px;       /* bottom nav bar height (+ safe area) */
```

Rules:
- Every card uses **one** treatment: `--bg-2` fill, **no border**, optional inset shadow. Today's mix of bordered and borderless boxes is eliminated.
- Every tappable chrome control is `min-height: var(--m-tap)` and `border-radius: var(--m-radius-ctl)`.
- Full-round radius is reserved for the FAB-style center nav button and avatars only.

---

## 2. Topbar — slim single row

**Current:** a crowded row of mismatched circular/pill controls (brand, search, clock-in, green scope box, sparkles, bell with badge, avatar chip). Reads as clutter.

**New (≤720px):** three elements, all the same height (`--m-tap`), same radius:
1. **Brand mark** (left) — `#brandLogo`. No longer a drawer toggle (drawer retired). Tapping it goes Home (or is purely decorative — see open question resolved: routes Home).
2. **Search pill** (center, flex-grows) — `.search`, full remaining width.
3. **Bell** (right) — `#notifBtn` + its panel, unchanged behavior.

**Relocated to the Profile sheet (§5):** clock-in (`#clockWidget`), chat/sparkles (`#chatBtn`), wallboard (`#tbViews`), company switcher (`#companySwitcher`), "view as" switcher. These are `display:none` in the topbar at ≤720px and rendered inside the Profile sheet instead. No DOM removal — just CSS hide in topbar + mirrored triggers in the sheet.

The desktop `.primary-nav` (`#primaryNav`) is hidden on mobile — its destinations move to the bottom nav.

---

## 3. Bottom navigation bar (new)

A new fixed bar, `position: fixed; bottom: 0`, full width, `height: var(--m-navh)` plus `env(safe-area-inset-bottom)` padding. Dark surface (`--bg-2`) with a top hairline of `--bg-3`. Shown only at ≤720px.

**Five slots:** `Home · Tasks · ⊕ · Projects · Profile`

| Slot | Icon | Action |
|------|------|--------|
| Home | `ti-home` | `controller.goHome()` |
| Tasks | `ti-list-check` | `controller.setView('all')` |
| ⊕ (center) | `ti-plus` | `controller.openNewTaskPage()` |
| Projects | `ti-folder` | `controller.setView('projects')` |
| Profile | `ti-user` | opens the Profile sheet (§5) |

- The center **⊕** is a raised orange (`#ED4E0D`) circle, `56px`, lifted `~10px` above the bar (classic social center-action). It is the **only** New-Task entry point on mobile.
- Each side tab is icon + tiny label. **Active** state = orange glyph + orange label, driven by `controller.uiState.view` (Home when `view==='home'`, Tasks for the task views `all/mine/hot/today/overdue/watching`, Projects when `view==='projects'`).
- Permission gating: a tab whose destination fails `controller.canView(...)` is hidden (e.g. Projects). The center ⊕ hides for users who can't create tasks (mirrors current FAB gating).

**New view/component:** `js/views/BottomNavView.js`, mounted from a new `<nav id="bottomNav">` in `app.html`. Subscribes to `view:changed` / `role:changed` to repaint active state and gating. Registered in `app.js` alongside the other views.

**Retired on mobile:**
- The `#fab` floating button — `display:none` at ≤720px (kept in DOM for any desktop/edge use, but effectively replaced).
- The `.deck.drawer` mobile nav drawer + `#brandLogo` toggle behavior — the drawer is `display:none` at ≤720px. Its contents (Team/Reports/Wallboard/admin views) are reachable from the Profile sheet.

---

## 4. Pills — single scrolling strip

**Current:** the company chip row (`.qt-chiprow` → `.qt-chip`: All/Roofing/Drafting/Lumen/Overall) wraps to two messy rows.

**New (≤720px):** one horizontal strip.
- `flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x proximity;` on `.qt-chiprow`.
- Hide the scrollbar; add a subtle right-edge fade mask so it reads as scrollable.
- Chips slightly smaller (`min-height` still ≥ `--m-tap` for tap comfort via padding, but visually tighter), active = orange fill (existing `.on` style, kept).
- No markup change — the strip already renders from `TableLayout.js`. This is CSS-only, scoped to `#taskViewWrap.qt-skin .qt-chiprow` at ≤720px.

---

## 5. Widgets — true 2×2 bento

**Current:** `.page-head-widgets` stacks four full-width cards: Up next, Focus, Progress, and the Controls (Sort/Group/Filter) card.

**New (≤720px):** a `display:grid; grid-template-columns: 1fr 1fr; gap: var(--m-gap);` bento. **Four equal quadrants:**

```
┌ Up next ─┐┌ Focus ──┐
│ hero     ││ order   │
└──────────┘└─────────┘
┌ Progress ┐┌ Sort ───┐
│  0%      ││ Group   │
└──────────┘└─────────┘
```

- Quadrant 1: **Up next** (`#upNextWidget`)
- Quadrant 2: **Focus / execution order** (`#focusWidget`)
- Quadrant 3: **Progress ring + Total/Done/Pending** (`#progressWidget`)
- Quadrant 4: **Controls** (`#controlsWidget`) — Sort + Group by. `Filter` (`#filterBtn`) is **not** dropped: it moves to a compact icon inside this quadrant's header (or alongside Sort/Group as a third pill; final call at build). The three buttons stay same-IDs so handlers stay wired.
- All four cards share the §1 card treatment, equal min-height, aligned. Each mount already exists in `app.html:166-179`; this is a CSS grid re-layout of `.page-head-widgets` plus per-card polish. Internal widget markup unchanged where possible; if a card overflows a quadrant, its inner layout is condensed (e.g. Progress stats wrap under the ring).

---

## 6. Table — stacked card list

**Current:** the desktop-style table row is crammed on phones (status/priority/type/label/assignee/due columns squished).

**New (≤720px):** each task renders as a **card**, not a table row. The desktop `#taskViewWrap.qt-skin` table columns are collapsed via CSS into a stacked card:

- **Line 1:** checkbox · company color dot · **task title** (bold, wraps to 2 lines).
- **Line 2:** status pill · priority pill · due chip (the existing pill styles, laid in a wrapping flex row).
- **Bottom-right:** assignee avatar stack.
- The whole card is tappable → opens the task (existing row-open behavior preserved).
- `.list-header` (the column header row) is `display:none` at ≤720px.

Preferred implementation: CSS-only re-flow of the existing table markup (`display:block` on rows/cells, relabel via order + flex) so no JS/render changes are needed. If the existing grid markup can't reflow cleanly, add a phone-only card template in the table layout renderer — decided during planning after inspecting `TableLayout.js` / `TaskListView.js` row markup.

---

## Files touched

- `app.html` — add `<nav id="bottomNav">`; (bottom nav markup mount).
- `js/views/BottomNavView.js` — **new** view (tabs, routing, active state, gating).
- `js/app.js` — instantiate `BottomNavView`.
- `js/views/ProfileView.js` (or the account sheet) — host relocated topbar actions (clock, chat, wallboard, view-as) + retired-drawer nav (Team/Reports/admin). Extend existing sheet; reuse existing triggers.
- `taskmanagement.css` — the bulk: `≤720px` primitives, topbar slim-down, bottom-nav styles, hide FAB/drawer/primary-nav, bento grid, table→card reflow.
- `css/tasks.css` — pill strip horizontal-scroll at ≤720px (scoped to `.qt-skin`).

No new migrations, no backend, no data changes. Zero-build static SPA — plain CSS/JS.

## Non-goals

- No desktop changes.
- No re-theme (palette/accent stay).
- No new task fields or backend.
- Inline table cell editing stays as-is.

## Open questions (resolved)

- Bottom nav destinations → **Home · Tasks · ⊕ · Projects · Profile** (confirmed).
- Bento → **true 2×2, four equal quadrants** (confirmed).
- Retire FAB + drawer on mobile → **yes, both** (confirmed).
- Filter button → kept, folded into the Controls quadrant (not dropped).

## Verification

Use the existing screenshot harness (Playwright chromium-1223) to render `app.html` at a phone viewport (e.g. 390×844) in dark mode, before/after, checking: no horizontal page scroll, bottom nav fixed and safe-area-correct, pills on one scrolling line, 2×2 bento aligned, table rows as cards, topbar three-element row. Manual click-through on a real phone for tap targets and the center ⊕.
