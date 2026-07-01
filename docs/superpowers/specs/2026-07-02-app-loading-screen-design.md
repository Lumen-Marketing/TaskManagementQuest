# App boot loading screen (GridMotion)

**Date:** 2026-07-02
**Status:** Approved (design); ready for implementation
**Surface:** `app.html` boot (the async Supabase data load)

## Problem

When you land on `app.html`, the shell renders immediately but the app then loads
your data from Supabase (the slow part) before it's usable — you currently see an
empty shell with skeletons. The user wants a proper full-screen loading screen, using
the **GridMotion** effect from React Bits.

## Constraint / adaptation

GridMotion is a **React** component (`useEffect`/`useRef`/JSX + `import gsap`). This app
is a **zero-build static SPA — no React, no bundler** (scripts are plain `<script>`
tags). So it is ported to a vanilla JS module with identical behavior; GSAP is loaded
from the CDN (`cdn.jsdelivr.net`, already allowed by our CSP `script-src`).

## Design

**Component — `js/views/LoaderView.js`** (`App.LoaderView`)
- Builds a 4×7 grid (`.ldr-*` classes, prefixed to avoid colliding with generic app
  class names like `.row`) into `#appLoader`, each tile showing the supplied Unsplash
  image (one request, reused). Tiles keep a `#111` background so a slow/blocked image
  never breaks the loader.
- Runs GridMotion's GSAP mouse-parallax: `gsap.ticker.add` moves alternating rows on
  `mousemove`. On touch/no-mouse devices (`matchMedia('(pointer: fine)')` false) a gentle
  auto-drift oscillates the rows so it still moves.
- Overlays a small centered **Quest HQ** brand mark (bolt logo + name + pulsing dots) so
  it reads as "loading."
- Guards for a missing `gsap` global (CDN blocked): the grid still shows statically and
  still hides on boot.
- API: `App.LoaderView.hide()` (graceful — enforces a ~1000ms minimum on-screen so the
  animation is seen, then fades out over 600ms and removes `#appLoader`) and
  `App.LoaderView.stop()` (immediate teardown of the ticker + listeners). `App.hideAppLoader`
  is an alias for `hide()`. A ~15s max-timeout safety hides it even if boot never signals.

**Markup / load order — `app.html`**
- `<div id="appLoader" aria-hidden="true"></div>` placed at the top of `<body>` so its
  dark background paints instantly (before the app scripts run).
- Immediately after it: `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>`
  then `<script src="js/views/LoaderView.js"></script>`, so the loader mounts and animates
  before the heavier app scripts parse. LoaderView self-initializes on load.

**CSS — appended to `taskmanagement.css`** (render-blocking in `<head>`, so styled from
first paint): `#appLoader` is `position:fixed; inset:0; z-index:9999; background:#000` with
an `opacity` transition; `.is-hiding` fades it out. Grid/rows/tiles/brand ported from the
component's CSS, scoped `ldr-*`. `prefers-reduced-motion` disables the dot pulse.

**Hide wiring — `js/app.js`**
- Success path: after `restoreUiState()` (the final view is set), call `App.hideAppLoader()`.
- `renderRoleGate()` and `renderFatalDataError()` both replace `document.body.innerHTML`
  (which removes `#appLoader`); call `App.LoaderView.stop()` first so the GSAP ticker/listeners
  are torn down rather than left running against detached nodes.

## Non-goals (YAGNI)

- No npm/gsap dependency or build step (CDN instead).
- No change to the separate login page (`/`) — this is only the in-app boot.
- Not blocking boot on image load; the loader hides when data is ready regardless.

## Error handling

- Missing `gsap` → static grid, still hides on boot.
- Image fails → dark tiles (graceful).
- Boot never signals hide → 15s max-timeout dismisses it.
- Role-gate / fatal-error → `stop()` + body replacement remove it.

## Testing

- Manual: load the app → loader shows, animates (mouse parallax on desktop, drift on
  mobile), fades out once tasks render. Reload a few times.
- Manual: throttle network to see it persist during a slow load, then fade.
- `node --check js/views/LoaderView.js`; CSS brace balance.
