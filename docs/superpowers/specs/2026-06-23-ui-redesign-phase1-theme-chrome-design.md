# UI Redesign — Phase 1: Theme + Chrome — design

**Date:** 2026-06-23
**Status:** Approved (design), pending spec review

## Program context

The boss wants the whole app reskinned to look like the
`quest-hq-reports-standalone.html` mockup. Delivered in three phases, each its own
spec → plan → build → ship:

1. **Phase 1 (this spec):** global theme + sidebar/topbar chrome. After this the
   whole app reads like the screenshot.
2. **Phase 2:** Home + Reports sections — see
   `2026-06-23-home-and-reports-design.md` (built on Phase-1 tokens).
3. **Phase 3:** reskin remaining surfaces (task table/rows, detail pane, modals,
   filter/sort menus, calendar, kanban, time/approvals/hierarchy).

Project constraint: mobile-friendliness is the #1 priority; every Phase-1 change
must hold up at ≤720px. Zero-build static SPA — no framework, no bundler.

## Key finding driving the approach

The app already has a `body.ui-command-center` **skin layer**
(`taskmanagement.css` ~line 4106) that is ~80% of the mockup: same 248px sidebar /
54px topbar metrics, light palette, white surfaces, rounded cards, pill nav counts.
The recent "command center" commits were the boss already moving toward this look.

Two gaps vs. the screenshot:
- The accent is currently **slate `#475569`** (last commit "softened" it). The
  mockup is **orange `#ED4E0D`**.
- Font is IBM Plex; the mockup is **Inter** (+ JetBrains Mono for tabular numbers).

**Approach: evolve the existing `ui-command-center` skin** to close the gap. No new
competing skin class (that would leave dead CSS). Every change stays scoped under
`body.ui-command-center` so the base light/dark themes are untouched.

## Changes

### 1. Fonts — `app.html` + `taskmanagement.css`

- Append **Inter** (400,500,600,700) and **JetBrains Mono** (500,600) to the existing
  Google Fonts `<link>` in `app.html`.
- Under `body.ui-command-center`: set `--font-body` and `--font-display` to
  `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` and
  `--font-mono` to `'JetBrains Mono', ui-monospace, monospace`.
- Enable Inter's tabular-num + feature settings on numeric chrome (counts, KPIs).

### 2. Palette — `taskmanagement.css`, `body.ui-command-center` token block

Replace the current values with the mockup's:
- Surfaces: `--bg #F5F6F8`, `--bg-2 #FAFBFC`, sidebar `--bg-3 #FBFBFD`,
  `--surface #FFFFFF`.
- Ink: `--ink #16191D`, `--ink-2 #5A626B`, `--ink-3 #929AA3`; add `--ink-4 #B6BCC4`.
- Rules: `--border #EAECF0`, `--border-strong #E2E5EA`; row hover `#F5F7F9`.
- **Accent (the headline change):** `--amber #ED4E0D`, `--amber-bg #FDEDE6`,
  `--amber-ink #CE430A` (press). Logo gradient `linear-gradient(150deg,#F2581A,#D8410A)`;
  primary button bg `#ED4E0D`, hover `#CE430A`; active nav uses accent + tint.
- Status: `--green #2E9E6B`, over/rust `#E0484D`, warn `#E08A0B`, blue `#3E7BF2`,
  review-lilac `#8268DC` (used by pills/dots).
- Shadows: the mockup's softer `rgba(18,22,28,…)` sm/md/lg.

### 3. Layout grid — true full-height sidebar

Currently the topbar spans both columns (`.app > .topbar { grid-column: 1/-1 }`)
and the skin fakes the split by styling `.topbar-left` as a 248px white block. The
mockup has a real full-height left sidebar with the topbar only over the main pane,
and the brand sits at the **top of the sidebar** (not the topbar).

Under `body.ui-command-center`:
- `.app { grid-template-columns: 248px minmax(0,1fr); grid-template-rows: 54px 1fr }`
- `.deck { grid-column: 1; grid-row: 1 / -1 }` (full height)
- `.topbar { grid-column: 2; grid-row: 1 }`
- `.main { grid-column: 2; grid-row: 2 }`
- Move the brand block (logo + "Quest HQ" / "Operations workspace") markup from
  `.topbar-left` into a new sidebar header in `app.html`. The minimized-sidebar
  collapse (`body.sidebar-minimized .app` → 68px column) is updated to match.

### 4. Sidebar — `app.html` + `js/views/SidebarView.js`

Faithful chrome, reusing existing nav items (no invented features):
- **Top:** brand header (Q logo + name/sub + collapse chevron).
- **"Ask Quest" bar:** a styled button row (sparkle icon + "Ask Quest…" + `⌘K`
  hint) that focuses the existing `#searchInput`. No new AI feature — it's an entry
  point to existing search.
- **Grouped nav** restyled to the mockup's section look (uppercase labels, pill
  counts, accent active state). Existing items are regrouped under the mockup's
  three headers via this mapping (no new items in Phase 1):
  - **Personal** ← the current Workspace group (All, Mine, Urgent, Today, Overdue,
    Watching) + My time. (Home lands here in Phase 2.)
  - **Team** ← Team workload, Team chart (Org), Approvals/Clock (Admin). (Reports
    lands here in Phase 2.)
  - **Workspaces** ← the Company group (Quest Roofing / Drafting / Lumen) with the
    colored dots.
  - Group keys/labels are produced in `SidebarView._buildSections()`; the static
    Workspace group in `app.html` is relabelled "Personal".
- **Bottom (sidebar footer):** relocate the **clock-in widget** (currently in
  `.topbar-right`) here, plus a **user chip** (avatar + name + role + gear → opens
  the existing profile/account menu). Both reuse existing handlers/state; this is a
  move + restyle, not new logic.

### 5. Topbar — `app.html` + `js/views/TopbarView.js`

The topbar now sits only over the main pane:
- **Left:** a section **title** reflecting the active view (e.g. "All tasks",
  "Team workload"), updated on `view:changed`.
- **"My work / Company" segment:** a segmented control mapped to existing scope —
  "My work" → `setView('mine')`, "Company" → `setView('all')`; its active state
  follows the current view. No backend change.
- **Right:** existing search input, notifications bell, primary action button
  (keeps "New task"; the mockup's "Start review" belongs to Meeting Mode, which is
  out of scope).
- The clock widget moves out of the topbar (now in the sidebar footer, §4).

### 6. Mobile (≤720px)

- The sidebar remains the existing slide-in drawer (SidebarView already implements
  the mobile drawer + backdrop); the full-height-sidebar grid only applies on
  desktop. Verify the relocated brand/footer render correctly inside the drawer.
- Topbar title + segment wrap/compact; the segment may collapse to icons at the
  narrowest widths. Touch targets ≥ 32px.

## Components & boundaries

| Unit | Responsibility | Touches |
|---|---|---|
| `ui-command-center` token block | mockup palette + fonts | taskmanagement.css |
| `.app` grid override | full-height sidebar layout | taskmanagement.css |
| `app.html` chrome markup | brand→sidebar, Ask Quest, footer, topbar title/segment | app.html |
| SidebarView | grouped nav, Ask Quest wiring, footer clock/user | SidebarView.js |
| TopbarView | title sync + scope segment | TopbarView.js |
| scoped skin CSS | restyle the moved/added chrome | taskmanagement.css |

## Testing

- Playwright smoke: app boots on `ui-command-center`; sidebar shows brand + Ask
  Quest + grouped nav + footer clock/user; topbar shows title + segment; clicking
  the segment switches Mine/All; "Ask Quest" focuses search.
- Visual verification (mobile-responsive-testing) desktop + ≤720px against the
  mockup — accent is orange, layout matches, no horizontal overflow (per the known
  grid-minmax clipping bug, confirm `minmax(0,1fr)` holds).
- Regression: existing views (table, calendar, kanban, time, approvals) still
  render and the base light/dark themes (non-command-center) are unaffected.

## Out of scope (later phases)

- Home + Reports views and the Home/Reports nav items (Phase 2).
- Reskinning the task table rows, detail pane, modals, calendar/kanban internals,
  time/approvals/hierarchy bodies (Phase 3).
- Any new feature behind the "Ask Quest" bar or the segment (they reuse existing
  search/scope only).
