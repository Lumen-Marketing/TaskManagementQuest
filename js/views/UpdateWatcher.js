window.App = window.App || {};

/* Auto-update on deploy. An open tab keeps running the version it booted with,
   so a new deploy to main isn't picked up until a manual refresh. env.json ships
   a per-deploy `release` (the git commit SHA) and is never cached, so we poll it
   and, when it changes, reload — but only when the user isn't mid-edit, so typed
   input is never lost. Network-first SW + no-store env.json means the reload
   fetches the new deploy's assets. */
App.UpdateWatcher = (function () {
  const POLL_MS = 2 * 60 * 1000; // background check cadence
  const RETRY_MS = 4000;         // re-check "is it safe to reload yet" while pending

  let baseRelease = null;
  let pending = false;
  let started = false;
  let retryTimer = null;

  function envUrl() {
    return `${App.basePath || '/'}env.json`;
  }

  // True only when reloading now won't clobber unsaved input.
  function isSafe() {
    const uiState = App.controller && App.controller.uiState;
    if (uiState && uiState.creatingTask) return false; // new-task page open

    const ae = document.activeElement;
    if (ae) {
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return false;
    }
    // Detail page in edit mode (single-column form) or an inline field open.
    if (document.querySelector('#taskDetailWrap .detail-body:not(.detail-grid)')) return false;
    if (document.querySelector('.tdp-editable.is-editing')) return false;
    // Any open modal (profile, etc.).
    if (document.querySelector('.modal-backdrop')) return false;
    return true;
  }

  function maybeReload() {
    if (!pending) return;
    if (isSafe()) {
      try { window.location.reload(); } catch (e) { /* ignore */ }
      return;
    }
    // Not safe yet (mid-edit) — try again shortly; focus/visibility handlers also retry.
    clearTimeout(retryTimer);
    retryTimer = setTimeout(maybeReload, RETRY_MS);
  }

  async function check() {
    if (pending) { maybeReload(); return; }
    let rel = '';
    try {
      const res = await fetch(envUrl(), { cache: 'no-store', credentials: 'same-origin' });
      if (!res || !res.ok) return;
      const env = await res.json();
      rel = typeof env.release === 'string' ? env.release.trim() : '';
    } catch (e) {
      return; // offline / transient — try again next tick
    }
    if (!rel) return;
    if (!baseRelease) { baseRelease = rel; return; } // adopt first seen (dev / missing)
    if (rel !== baseRelease) { pending = true; maybeReload(); }
  }

  function start() {
    if (started) return;
    started = true;
    baseRelease = (typeof App.release === 'string' && App.release.trim()) || null;

    setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
  }

  return { start, check };
})();
