# Flat-outline blocks restyle — design

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan
**Scope:** Visual restyle only. No layout, color, font, or JS/view logic changes.

## Goal

The boss wants the UI/UX restyled while **keeping the existing layout, the orange
brand color (`#ED4E0D`), and the Inter font**. The chosen direction is **"flat
outline blocks"**: crisp hairline/near-black outlines, no resting shadows, flat
fills, sharper corners — extending the "black-outline block" language the recent
detail-page commits already introduced, now applied consistently across every
screen.

This is a CSS-only change, scoped to the active `ui-command-center` skin, and is
fully reversible.

## Constraints

- **Do not edit `tokens.css`** (forbidden by the phase-3 polish plan; base radius
  tokens `--radius-sm: 10px`, `--radius-md: 14px`, `--radius-lg: 20px` live there
  and are referenced, not changed).
- All edits live under `body.ui-command-center` in `taskmanagement.css`
  (token block starts at line 4306). Other skins are untouched.
- Keep `--amber` (`#ED4E0D`) and the Inter font stack unchanged.

## The three levers (token-level, done once)

1. **Kill resting shadows.** Within the `ui-command-center` token block set
   `--shadow-sm` and `--shadow-md` to `none`. Every resting card/button that
   references them flattens instantly. Overlays keep a *light* `--shadow-lg`
   (menus, dropdowns, modals) so they still read as floating above the page.
2. **Strong hairline outline.** Add a `--block-line` token = near-black
   `#16191D` rendered at 1px. Block surfaces switch from the faint chrome border
   (`--border: #EAECF0`) to this crisp outline.
3. **Sharper corners.** Add a `--block-radius` token (~8px), used by block
   surfaces in place of the rounded `--radius-lg` (20px), so blocks read as flat
   panels rather than pills.

## Surfaces the block treatment is applied to

Consistently across all five screens, using the new tokens:

- **Home:** the 4 stat cards, Team workload panel, Needs attention panel.
- **Tasks — List:** the `.task-group` cards.
- **Tasks — Board:** the columns and the cards inside them.
- **Tasks — Table:** the table container.
- **Task detail:** the existing dashboard blocks + AI summary band, centralized
  onto the same `--block-line` / `--block-radius` tokens so they match exactly
  (replacing any hardcoded black-outline values from the recent commits).

Components *inside* blocks (pills, badges, avatars, buttons) are unchanged except
that buttons lose their resting shadow (handled automatically by the flattened
`--shadow-sm`).

## Density

Normalize block padding to one consistent value (~16–18px) so every block reads
as the same family. A light touch — not a spacing overhaul.

## Confirmed decisions

- **Outline color:** near-black `#16191D` at 1px. (Can soften to a dark gray
  later if black-everywhere feels heavy on Home.)
- **Corner radius:** 8px (flat but not literally square).
- **Shadows:** removed on resting cards/buttons; a soft shadow is kept on
  overlays/menus only.

## Non-goals (YAGNI)

- No palette or typography changes.
- No layout/structure changes.
- No changes to other skins or to `tokens.css`.
- No JS/view logic changes.

## Verification

- Visual check of all five screens in both light and dark theme.
- Confirm overlays (status menu, dropdowns, modals) still cast a shadow.
- Confirm no horizontal overflow introduced on mobile (≤720px) by the outline
  weight or padding changes.
