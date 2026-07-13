# Unify the UI — make Panze the single base skin

**Date:** 2026-07-01
**Status:** Design approved (verbal), pending written-spec review
**Scope owner:** UI redesign program ([[project_ui_redesign_program]])
**Supersedes scoping decision in:** [2026-06-23-panze-home-tasks-sidebar-design.md](2026-06-23-panze-home-tasks-sidebar-design.md)

## Goal

Today the **Panze** skin (soft, rounded, Hanken-Grotesk look) is scoped to two
views — Home and All Tasks — via `body.panze-home` / `body.panze-tasks`. Every
other section (Reports, People, Time, Org/Hierarchy, Admin/Approval) plus the
shared chrome (topbar, modals, detail panel) still wears the base
`ui-command-center` treatment. The result is a visible split.

Unify the app **forward**: make the Panze look the single base skin for every
screen, and retire the per-view scoping. The user has explicitly chosen all four
differing elements to go global: **typeface, sidebar rail, soft card shadows, and
shared chrome.**

## Context — the skins have already converged

The Panze tokens and the base `ui-command-center` tokens are already nearly
identical (background `#FBFAF8`, surface `#FFFFFF`, card radius `14px`, hairline
`#ebe7e2`). The genuinely-differing elements are small:

| Element | Base `ui-command-center` | Panze (scoped) | Action |
|---|---|---|---|
| Font | Inter | Hanken Grotesk | Promote Hanken to base |
| Card elevation | flat (`--shadow-sm/md: none`) | soft shadow | Restore soft shadow to base |
| Sidebar active item | command-center rail | rounded amber pill | Unscope pill to all views |
| Topbar / modals / detail | base treatment | (excluded by old spec) | Adopt via shared tokens |

This is why the work is a **scope change + a few token edits**, not a reskin of
each section.

## Non-goals

- No data-model, RLS, service, or SQL changes. Pure front-end (CSS + a small JS
  deletion).
- No change to Home's bento/donut layout or the All-Tasks **Cards** view — those
  are real features, not skin, and stay as-is.
- No change to `index.html` (the login/landing page) — a separate document with
  its own font set.
- No new web-font load. `app.html` already loads Hanken Grotesk (and Inter, Plus
  Jakarta, etc.).
- No new "soft vs flat" debate beyond the approved decision (see Risks): this
  change deliberately **reverses the elevation** half of the 2026-06-27
  flat-outline restyle while keeping its warm borders + radius.

## Approach (chosen: B — merge into the base skin)

Fold the differing Panze values into the base token block, unscope the
view-specific rules, and delete the scaffolding. Because the whole app reads from
the same CSS custom properties, changing the base tokens re-skins every
token-driven component — sections **and** chrome — automatically.

Rejected alternatives:
- **A — Promote in place:** broaden the scoped selectors but keep `--pz-*` and the
  body-class machinery. Lower-risk but leaves a redundant dual-token system.
- **C — Always-on class:** stamp a permanent `panze` class and rename selectors.
  Fastest to type, leaves dead conditional code. Rejected.

B is chosen because the palettes already match (contained blast radius) and it
clears the "two type systems / dual tokens" tech-debt the original Panze spec
flagged as a risk.

## Changes

### 1. Base token block — `body.ui-command-center` (`taskmanagement.css`, ~L4417)

- `--font-body`: `'Inter', …` → `'Hanken Grotesk', 'Inter', -apple-system, system-ui, sans-serif`.
  `--font-display` already aliases `--font-body`, so headings follow.
- `--shadow-sm`: `none` → Panze `--pz-shadow-sm`
  (`0 1px 2px rgba(28,39,64,.05), 0 1px 1px rgba(28,39,64,.03)`).
- `--shadow-md`: `none` → Panze `--pz-shadow`
  (`0 14px 32px -16px rgba(28,39,64,.18), 0 3px 8px rgba(28,39,64,.05)`).
- `--ink`: `#16191D` → `#1c1a18` (Panze warmth; cosmetic parity).
- `--border` / `--block-line` / `--block-radius` already equal Panze → **no change**.

### 2. Dark variant — `[data-theme="dark"] body.ui-command-center` (~L5315)

Fold the Panze dark tokens into this block so dark mode matches: dark card
surfaces (`#1B1F27` / `#20252E`), dark shadows (`--pz-shadow*` dark values), and
the dark wash where a section currently relied on the scoped Panze dark remap.
**This is the highest-risk part of the change — verify carefully (see Testing).**

### 3. Un-flatten (restore soft elevation)

The shadow-token edits in §1/§2 do most of the work. Then remove the explicit
`box-shadow: none` hardcodes that would otherwise suppress elevation, and restore
the card hover-lift:

- `.qhq-card` (L5045) — drop `box-shadow: none`.
- Flat-outline cards-view override (L5677–5686) — remove the
  `box-shadow: none` / `transform: none` flattening so cards float and lift again.
- Block-style rules in L5447–5497 — audit; remove any `box-shadow: none` intended
  to keep surfaces flat.

Keep the warm hairline borders (`--block-line`) and `--block-radius` — a Panze
card is border **+** soft shadow, so these are compatible and stay.

### 4. Unscope the sidebar rail + drop heading overrides

- Sidebar rail rules (L5718–5723): change the selector prefix from
  `body.panze-home / body.panze-tasks` to `body.ui-command-center .deck`, so every
  view gets the rounded active amber pill (`border-radius: 11px`, `--amber-bg`
  active, no box-shadow). Removes the abrupt sidebar flip when navigating.
- Heading-font overrides (L5621–5627) are redundant once the base font is Hanken
  → delete.

### 5. Chrome — topbar / modals / detail panel

These already consume `--surface`, `--ink`, `--border`, `--shadow-*`, and
`--font-*`, so they adopt Panze automatically once the base tokens flip. Plan: a
visual pass over each surface; spot-fix any hardcoded color that doesn't read a
token (note findings in the implementation plan).

### 6. Delete the scaffolding

- **CSS:** remove the `--pz-*` definitions (L5552–5587) and the scoped token-remap
  block (L5589–5627) after folding the still-needed values into the base. **Keep**
  the genuinely page-specific blocks: Home donut (L5642–5656) and the Cards view
  (L5658–5715), rewriting any `--pz-*` references in them to the now-global base
  tokens (e.g. `--pz-radius` → `--block-radius`, `--pz-shadow` → `--shadow-md`).
- **JS:** delete `_applyPanseSkin()` (`AppController.js` L206–210) and its call
  site (L491). The `panze-home` / `panze-tasks` body classes are then unreferenced
  and removed.

## Files touched

| File | Change |
|---|---|
| `taskmanagement.css` | Base token edits (font, shadows, ink); dark-variant fold; un-flatten removals; unscope sidebar rail; delete `--pz-*` + scoped remap; keep/rewire donut + Cards blocks |
| `js/controllers/AppController.js` | Delete `_applyPanseSkin()` and its call |

No HTML, model, service, or SQL changes. (Optional, separate follow-up: trim
now-unused Google Font families — Inter / Plus Jakarta / Fraunces — from
`app.html` to shrink the font payload.)

## Error / edge handling

- **Empty states / existing components:** unchanged markup; they re-skin via
  tokens only.
- **Mobile (≤720px):** must not introduce horizontal scroll
  ([[project_grid_minmax_clipping]], [[project_mobile_friendly_priority]]). Soft
  shadows add no layout width, but verify.
- **Reduced motion:** keep the card hover-lift behind `prefers-reduced-motion`
  (as the existing Cards rules already do, L5712–5715).
- **Theme toggle mid-view:** dark rules keyed on `[data-theme="dark"]` flip
  instantly with the existing toggle.

## Risks

- **Dark mode (primary):** folding the Panze dark remap into the global dark block
  is where regressions are most likely. Mitigation: explicit light+dark render
  checks on every section (Testing §).
- **Reversing the flat-outline restyle:** restoring soft shadows app-wide undoes
  the *elevation* decision from commit `2026-06-27 flat-outline-blocks-restyle`
  (the boss's "warm block" direction). Approved by the user; borders/radius are
  retained so the warm-block character is mostly preserved. Revisit if the boss
  prefers flat.
- **Hardcoded-color stragglers:** a section may have a bespoke color that doesn't
  read a token and so won't follow the skin. Mitigation: the chrome/section visual
  pass in §5 + verification.
- **Specificity:** unscoping moves rules from `body.panze-*` (higher specificity)
  to `body.ui-command-center` (equal to existing base rules). Confirm the unscoped
  sidebar/shadow rules still win where intended; adjust ordering, not `!important`.

## Testing / verification

Playwright render checks (the established `verify_out/` pattern, system browser
channel):

1. **Per section, light + dark:** Home, All Tasks, Reports, People, Time,
   Org/Hierarchy, Admin/Approval. Confirm: Hanken Grotesk throughout, soft cards
   with hover-lift, rounded sidebar pill on **every** view, no hardcoded-color
   stragglers.
2. **Chrome:** open a modal (e.g. New Task) and the task detail panel in light +
   dark — confirm both adopt the skin.
3. **Navigation:** Home → Reports → People — confirm the sidebar no longer flips
   style between views (one consistent rail).
4. **Mobile:** 480px width on Home + All Tasks + one list section — no horizontal
   overflow.
5. **Regression:** Cards view still renders and opens detail; Home donut/bento
   still render.
