# Design — Quest HQ

A locked design system for this app, produced by `hallmark redesign` across both
surfaces (the auth page and the task manager). Every page reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. All tokens live in [`tokens.css`](tokens.css); pages must
reference tokens by name, never inline raw values.

## Genre
utilitarian (industrial field-tool) — engineered, instrument-panel feel for a
construction back-office. Squared corners, flat surfaces, hairline rules, mono
data labels, no decorative glow/eyebrows/marketing. Function is the design.

## Macrostructure family
- App pages (`app.html`): **Command Console** — fixed topbar, a horizontal command
  deck (view segments + scope chips + actions) instead of a left sidebar, and a
  full-bleed work surface with an optional right detail panel. No KPI cards (counts
  live in the nav). Work surface swaps Table / Timeline / Kanban.
- Auth page (`index.html`): **Split-Diptych** — editorial brand panel (left) +
  task-focused auth card (right). Collapses to a single stacked column on mobile.

## Theme — "Quest" warm-dark (dark default, light variant)
OKLCH. Source of truth is the legacy semantic names in `tokens.css`.

- `--bg`     oklch(16% 0.006 70)  · warm charcoal paper (dark)
- `--surface`oklch(18% 0.006 70)
- `--ink`    oklch(94% 0.013 85)  · warm cream
- `--ink-2`  oklch(76% 0.012 85)
- `--border` oklch(28% 0.006 72)
- `--amber`  oklch(76% 0.13 75)   · the one accent — amber
- `--rust` / `--blue` / `--green` · semantic status hues only
- `--color-focus` = `--amber`

Light variant inverts to a cream paper (`oklch(95% 0.02 88)`) under warm ink.

## Typography
- Display: IBM Plex Sans Condensed, weight 600/700, UPPERCASE for titles/wordmark
- Body:    IBM Plex Sans, weight 400/500/600
- Mono:    IBM Plex Mono — all data labels, counts, timers, tags, table/column heads
- Headings are set in condensed grotesque; structural labels are mono uppercase.
- No serif anywhere (the previous Instrument Serif read as generated).

## Spacing
4-point named scale (`--space-3xs` … `--space-3xl`) in `tokens.css`. Pages use
named tokens, never raw px.

## Motion
- Easings: `--ease-out` cubic-bezier(0.16,1,0.3,1) · `--ease-in` · `--ease-in-out`
- Reveal pattern: none on the app (function-first); modals fade + 8px slide-up
- Reduced-motion: global opacity-only, ≤ 1ms transitions (handled in tokens.css)
- Animate `transform` / `opacity` only

## Microinteractions stance
- Silent success over celebratory toasts (toasts reserved for real status)
- Focus rings show instantly, never animate (gate-compliant)
- Hover state on every interactive element; ≤ 3 motion primitives per surface

## CTA voice
- Primary CTA: amber fill, ink-on-amber, `--radius-sm`, 600 weight
- Secondary CTA: surface fill + hairline border, ink-2 text
- Destructive: rust tint

## Per-page allowances
- Auth page MAY use a typographic editorial panel (no imagery, no fake chrome).
- App pages MUST NOT use enrichment — the data is the design.

## What pages MUST share
- The Quest HQ wordmark (bolt logo + condensed uppercase name + mono sub-label).
- The amber accent and its restraint (≤ ~5% of any viewport).
- IBM Plex Sans / Condensed / Mono — no serif.
- Button shape, radius, and padding rhythm.
- Focus-ring treatment and reduced-motion behaviour.

## What pages MAY differ on
- Macrostructure (Workbench vs Split-Diptych) per page type.
- The work-surface layout (table/timeline/kanban) on the app.

## Exports
See [`tokens.css`](tokens.css) for the full, live token set. Quick drop-ins:

### Tailwind v4 `@theme`
```css
@theme {
  --color-paper:  oklch(16% 0.006 70);
  --color-ink:    oklch(94% 0.013 85);
  --color-accent: oklch(76% 0.13 75);
  --font-display: "IBM Plex Sans Condensed", sans-serif;
  --font-body:    "IBM Plex Sans", sans-serif;
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`
```json
{
  "color": {
    "paper":  { "$value": "oklch(16% 0.006 70)", "$type": "color" },
    "ink":    { "$value": "oklch(94% 0.013 85)", "$type": "color" },
    "accent": { "$value": "oklch(76% 0.13 75)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "IBM Plex Sans Condensed", "$type": "fontFamily" },
    "body":    { "$value": "IBM Plex Sans", "$type": "fontFamily" }
  }
}
```
