# Mobile performance & architecture deepening program — design

**Date:** 2026-07-08 · **Status:** grilled and decided with the user, pending final review
**Origin:** /improve-codebase-architecture + "optimize Quest HQ for mobile performance"
**Vocabulary:** per /codebase-design (module, interface, seam, adapter, depth, leverage, locality) and CONTEXT.md
**Evidence:** two Explore audits (architecture friction; mobile-perf static audit), 2026-07-08

## Program shape (decided)

Serial, ship-per-candidate. Order: **C1 load path → C2 PersistenceEngine → C3 TaskList layouts → C5 Menu → C4 Directory**; C6 (AppController) shrinks by attrition only. Each candidate is a short-lived branch in an isolated worktree (`.claude/worktrees/`), merged to main once verified; feature work continues on main between candidates. No long-lived refactor branch.

**Ship gate for every candidate:** screenshot harness (light + dark + mobile) on affected surfaces, Playwright preview-smoke, and — from C2 onward — the node:test suite. Boss-visible UX must not change without his sign-off (locked designs).

---

## C1 — Collapse the mobile load path

Baseline: 56 blocking scripts (837 KB JS), 669 KB render-blocking CSS, 8 font families × 27 weights, 221 KB icon CSS + 799 KB icon woff2 with no font-display, SW network-first on everything, 3 files precached. Est. cold first paint on 4G: 9–15 s.

Decisions:

1. **Scripts: `defer` on all except `theme-boot.js`** (must run pre-paint to prevent theme flash). `defer` preserves execution order, so the Foundation → Models → Views → Controllers chain is untouched. First paint becomes an **inline CSS-only shell/skeleton** in app.html that visually mimics the current loader's first frame (it just appears sooner) — the boss should see the same loading experience, faster, not a new one. LoaderView takes over at DOMContentLoaded to cover the data-load wait. GSAP defers with everything else.
2. **Fonts: prune 8 families → 2.** Evidence: every live `font-family` resolves to Hanken Grotesk or IBM Plex Mono; Inter, Plus Jakarta Sans, IBM Plex Sans, Plex Sans Condensed, JetBrains Mono appear only in comments/dead fallbacks, and `--font-serif` (Fraunces, taskmanagement.css:6223) is defined but never used — delete it. Preload the two kept families.
3. **Icons: subset the Tabler font.** 125 of ~4,200 glyphs are used. A one-off script committed to `tools/` generates a ~20–30 KB woff2 + minimal CSS with `font-display`; `<i class="ti ti-x">` markup is untouched. The tool header documents "re-run when adding a new icon"; a missing glyph shows as a blank box (grep-able, non-fatal).
4. **Service worker: cache-first for `?v=BUILD_ID`-versioned static assets; HTML stays network-first.** tools/build-env.mjs stamps the version at deploy. Recorded as **ADR-0001** (supersedes the deliberate network-first comment in sw.js).
5. **No bundler** — concat rejected (dev/prod divergence). Recorded as **ADR-0002**.
6. **Out of scope:** splitting taskmanagement.css (brotli already puts it ~50 KB on the wire; the cascade split is the risk-heavy, regression-prone part — revisit after C3). Also out: precaching the full shell at SW install (revisit if offline-first becomes a goal).

## C2 — PersistenceEngine (the persistence seam)

Baseline: save logic spread across five files — debounce/single-flight/conflict reconciliation in app.js:263–427, dirty tracking in models, I/O in a shallow SupabaseDataStore (fails the deletion test). This poor locality already shipped the worker-notify ordering race.

Decisions:

1. **Pull-shaped interface: models keep their existing dirty sets** (`_dirty`/`takeDirty`); the engine registers models and owns *scheduling* — 350 ms debounce, single-flight lock, coalescing — plus conflict reconciliation via its adapter. app.js:263–427 moves wholesale into the engine; models barely change.
2. **Hard constraint preserved:** an awaitable `saveNow()` barrier — `createTask` must await it before notification delivery (the shipped race bug; becomes a named regression test).
3. **Two adapters make the seam real:** SupabaseDataStore in prod; a new in-memory fake for tests and preview harnesses.
4. **Test infra stood up in this candidate: `node:test`** (zero new dependencies). First tests: debounce coalescing, single-flight, saveNow ordering, conflict reconciliation.
5. **All three models (tasks, time, notifications) migrate day one** — they already share one `doSave()`; a partial migration would leave two pipelines.

## C3 — TaskList module + five layout adapters

Baseline: TaskListView.js is 1,743 lines with five layout implementations, 41 `innerHTML` wipes, per-render listener re-attach, and O(n) re-filtering on every render.

Decisions:

1. **Seam: `layout.render(tasks, host)`** — five adapters (Table, Kanban, Cards, Calendar, Watching), one file each under `js/views/tasklist/`.
2. **The module owns delegated row events** (open, complete, row menu) via one listener on the host — zero re-attach cost across re-renders. Adapters get **mount/unmount hooks** for layout-specific wiring (execution-list drag, kanban drops).
3. **Visible-tasks memo lives in the controller:** `getVisibleTasks()` caches, invalidated by the events that change the answer (tasks:changed + filter/sort/scope/search setters). Every caller wins — list, badgeCounts, prev/next arrows, export. (Performance characteristics are part of the interface.)
4. **No virtual scrolling** — prod has ~85 tasks; YAGNI at this scale.

## C5 — Menu module (popovers + sheets)

Baseline: eight hand-rolled popovers (~80–100 lines each, drifted copies) plus a separate mobile quick-actions bottom sheet; several attach non-passive scroll/resize listeners (mobile jank).

Decisions:

1. **One Menu module, two presentation adapters behind the seam:** anchored popover and bottom sheet. Interface: `open(anchor, content, opts)` returning a close handle; module owns placement/flip, click-away, Escape, focus return, and **passive** scroll/resize repositioning.
2. **Per-call-site presentation opt-in.** Day one: the existing quick-sheet becomes a Menu call site (the 9th); all pickers keep their current anchored look. Flipping any picker to sheet-on-mobile later is a one-flag change the boss can approve visually per picker — no unapproved UX change ships.
3. **All call sites migrate in one pass** (day-sized; leaving copies would preserve the drift this kills).

## C4 — Directory module

Baseline: 50+ direct reads of App.PEOPLE/App.COMPANIES/App.projects across 10 files; 40+ divergent copies of avatar/pill/chip HTML.

Decisions:

1. **Wrap → migrate → privatize.** Directory reads the globals first; call sites migrate view-by-view (each visually verified); once no direct reads remain, the globals are renamed/privatized so stragglers fail loudly.
2. **Render helpers live in Directory** (they need its lookups): `avatarStack`, `statusChip`, `companyPill` — escaping and fallback implemented once, leveraged 40+ times.
3. Modeled on taxonomy.js — the repo's existing clean seam.

## C6 — AppController (attrition only)

No direct decomposition. C2/C3/C5 pull mass out through their own seams. **Metric:** the member count of the controller stub in taskdetail-preview.html (24 today) — re-measured at each candidate's ship; it should fall.

## Out of scope for the program

- taskmanagement.css critical/lazy split (revisit after C3)
- Supabase realtime subscriptions (perf audit suggestion; separate product decision)
- Sheet-on-mobile flips for individual pickers (per-picker boss sign-off later)
- Any framework/bundler (ADR-0002)

## Artifacts created with this spec

- `CONTEXT.md` — new glossary (Visible tasks, Layout, Directory, Menu, Dirty, PersistenceEngine, Taxonomy)
- `docs/adr/0001-cache-first-versioned-static-assets.md`
- `docs/adr/0002-no-bundler-defer-instead.md`
- Architecture review report (temp, session-local): `architecture-review-20260708-041828.html`
