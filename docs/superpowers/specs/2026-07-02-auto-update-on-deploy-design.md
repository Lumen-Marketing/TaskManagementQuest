# Auto-update the app on a new deploy

**Date:** 2026-07-02
**Status:** Approved (design); ready for implementation
**Surface:** `app.html` runtime (PWA freshness)

## Problem

The app is a PWA with a network-first service worker. An already-open tab keeps
running the version it booted with — a new deploy to `main` (auto-deployed by
Vercel) isn't picked up until the user manually hard-refreshes. We want an open tab
to notice a new deploy and reload itself, without interrupting active work.

## Version signal (already exists)

`tools/build-env.mjs` writes `env.json` with `release = VERCEL_GIT_COMMIT_SHA`.
`js/config.js` fetches env.json on boot and sets `App.release`. env.json is never
cached (SW passes it through; served `no-store`). So the deploy's commit SHA is a
ready-made, always-fresh version marker — no build or SW changes needed.

## Design

**Module — `js/views/UpdateWatcher.js`** (`App.UpdateWatcher`)
- `start()` records `baseRelease = App.release` (the SHA booted with).
- Checks for a new version:
  - on a ~2-minute interval, and
  - on `visibilitychange` → visible and on window `focus` (a revisited stale tab).
- `check()` fetches `${App.basePath}env.json` with `cache: 'no-store'`, reads
  `release`. If it's a non-empty string that differs from `baseRelease`, a new
  deploy is live → set `pending = true` and try to reload. If we booted with an
  empty `baseRelease` (local/dev with no `release`), adopt the first seen value
  instead of treating it as a change (prevents dev noise + a false first reload).
- **Safe reload** — `maybeReload()` calls `location.reload()` only when it is safe;
  otherwise it retries every ~4s (and again on the focus/visibility handlers).
  Unsafe = any of:
  - `App.controller.uiState.creatingTask` (new-task page open),
  - detail edit mode present (`#taskDetailWrap .detail-body:not(.detail-grid)`),
  - an inline field open (`.tdp-editable.is-editing`),
  - a text control focused (`document.activeElement` is INPUT / TEXTAREA / SELECT /
    contenteditable),
  - a modal open (`.modal-backdrop`).
- Guards: `pending` is latched so repeated checks don't stack; all fetches are
  wrapped in try/catch (offline / transient failures are ignored).

**Why the reload is fresh** — network-first SW + `no-store` env.json → an online
reload fetches the new deploy's assets. No cache-busting needed.

**No loops** — after reload, `App.release` equals the served `release`, so the next
check is a no-op.

**Wiring**
- `app.html`: `<script src="js/views/UpdateWatcher.js"></script>` before `js/app.js`.
- `js/app.js`: after boot completes (near the loader hide), `if (App.UpdateWatcher) App.UpdateWatcher.start();`.

## Non-goals (YAGNI)

- No build/SW changes; no version.json endpoint (env.json already suffices).
- No visible "updating…" UI (the boot loader already shows on the reload).
- Preview mode: `App.release` may be empty; the watcher simply stays quiet.

## Error handling

- env.json fetch fails → ignored (try again next tick).
- Empty/missing `release` → no reload (adopt-first-seen behavior).
- User never goes idle → reload waits (acceptable; fires on next focus when safe).

## Testing

- Manual: open the app; change the served `release` (e.g. redeploy or edit the
  local env.json) → within ~2 min or on tab refocus it reloads (or waits while a
  form/field is open, then reloads when you close it).
- Manual: confirm no reload loop and no reload in local/dev (no `release`).
- `node --check js/views/UpdateWatcher.js`.
