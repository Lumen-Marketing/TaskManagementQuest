/* Menu (CONTEXT.md) — a transient contextual chooser. This module owns the
   choreography every menu used to hand-roll (and drift on): body-appended
   element, anchored positioning with viewport clamping + flip, click-away
   (pointerdown, capture), Escape, passive scroll/resize repositioning,
   aria-expanded, and focus return. Call sites own only their CONTENT via
   opts.build. Two presentations sit behind the seam: 'anchored' (popover) and
   'sheet' (bottom sheet with backdrop — the mobile quick-actions pattern).
   One Menu is open at a time; opening another closes the current ('reopen'). */
(function () {
  'use strict';
  window.App = window.App || {};

  let current = null; // the open handle, if any

  function place(el, anchor, opts) {
    const r = anchor.getBoundingClientRect();
    el.style.position = 'fixed';
    if (opts.matchAnchorWidth) el.style.minWidth = `${Math.round(r.width)}px`;
    // Measure after content render.
    const mw = el.offsetWidth, mh = el.offsetHeight;
    let top = r.bottom + opts.offset;
    if (top + mh > window.innerHeight - 8 && r.top - opts.offset - mh > 8) {
      top = r.top - opts.offset - mh; // flip above
    }
    let left = r.left;
    left = Math.min(left, window.innerWidth - mw - 12);
    left = Math.max(8, left);
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }

  function openAnchored(opts) {
    const el = document.createElement('div');
    el.className = opts.className;
    if (!el.getAttribute('role')) el.setAttribute('role', 'menu');
    document.body.appendChild(el);

    let closed = false;
    function reposition() { if (!closed) place(el, opts.anchor, opts); }
    const handle = { el, close, reposition };

    opts.build(el, handle);
    place(el, opts.anchor, opts);
    if (opts.anchor) opts.anchor.setAttribute('aria-expanded', 'true');

    const onAway = (e) => {
      if (el.contains(e.target) || (opts.anchor && opts.anchor.contains(e.target))) return;
      close('away');
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('esc'); } };
    const onScroll = (e) => {
      if (el.contains(e.target)) return; // scrolling inside the menu itself
      if (opts.repositionOnScroll) reposition(); else close('away');
    };
    const onResize = () => reposition();

    // pointerdown-capture so the menu closes before the underlying control
    // reacts; deferred a tick so the opening click doesn't instantly close it.
    let bound = false;
    const bindTimer = setTimeout(() => {
      bound = true;
      document.addEventListener('pointerdown', onAway, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('resize', onResize, { passive: true });
    }, 0);

    function close(reason) {
      if (closed) return;
      closed = true;
      clearTimeout(bindTimer);
      if (bound) {
        document.removeEventListener('pointerdown', onAway, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('resize', onResize);
      }
      el.remove();
      if (opts.anchor) {
        opts.anchor.setAttribute('aria-expanded', 'false');
        if (opts.returnFocus && reason !== 'reopen' && opts.anchor.focus) opts.anchor.focus();
      }
      if (current && current.handle === handle) current = null;
      if (opts.onClose) opts.onClose(reason || 'api');
    }

    return handle;
  }

  function openSheet(opts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'quick-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = opts.className || 'quick-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (opts.backdropTitle) {
      const h = document.createElement('div');
      h.className = 'quick-sheet-title';
      h.textContent = opts.backdropTitle;
      sheet.appendChild(h);
    }
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    let closed = false;
    const handle = { el: sheet, close, reposition: () => {} };
    opts.build(sheet, handle);

    const onBackdrop = (e) => { if (e.target === backdrop) close('away'); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('esc'); } };
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);

    function close(reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (opts.anchor && opts.returnFocus && reason !== 'reopen' && opts.anchor.focus) opts.anchor.focus();
      if (current && current.handle === handle) current = null;
      if (opts.onClose) opts.onClose(reason || 'api');
    }

    return handle;
  }

  App.Menu = {
    open(userOpts) {
      const opts = Object.assign({
        present: 'anchored', className: '', placement: 'bottom-start', offset: 6,
        matchAnchorWidth: false, onClose: null, repositionOnScroll: true,
        returnFocus: true, backdropTitle: '',
      }, userOpts);
      if (current) current.handle.close('reopen');
      const handle = opts.present === 'sheet' ? openSheet(opts) : openAnchored(opts);
      current = { handle };
      return handle;
    },
    closeCurrent(reason) { if (current) current.handle.close(reason || 'api'); },
    get isOpen() { return !!current; },
  };
})();
