window.App = window.App || {};

/* TourView — a lightweight, dependency-free interactive product tour.
   Dims the screen, spotlights a real UI element, and anchors a tooltip with an
   arrow pointing at it. Steps are role-aware: any step whose target isn't
   present/visible for the current role is skipped automatically. */
App.TourView = class TourView {
  constructor() {
    this.steps = [];
    this.index = 0;
    this.onFinish = null;
    this.els = null;
    this._renderSeq = 0;     // guards stale navigate-and-wait callbacks
    this._startView = null;  // view to restore when the tour ends
    this._reposition = () => this._render();
  }

  /* ---------- step definitions (role-aware) ----------
     The ordered step table + the pure inclusion logic live in TourSteps so they
     can be unit-tested without a DOM. Here we just supply the three predicates
     that decide inclusion: role permissions, per-view access, and — for the two
     always-present chrome steps — live DOM visibility. */
  buildSteps() {
    const preds = {
      can: (p) => App.can(p),
      canView: (v) => !!(App.controller && App.controller.canView(v)),
      isVisible: (sel) => this._visible(sel),
    };
    return App.TourSteps.selectSteps(App.TourSteps.STEPS, preds);
  }

  _visible(sel) {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ---------- lifecycle ---------- */
  start({ onFinish } = {}) {
    if (this.els) this._teardown();
    this.onFinish = onFinish || null;
    // Remember where the user was so we can return them there — the tour walks
    // through other sections along the way.
    this._startView = (App.controller && App.controller.uiState)
      ? App.controller.uiState.view : null;
    this.steps = this.buildSteps();
    if (!this.steps.length) return;
    this.index = 0;
    this._mount();
    this._render();
    window.addEventListener('resize', this._reposition);
    window.addEventListener('keydown', this._onKey);
  }

  _onKey = (e) => {
    if (e.key === 'Escape') this.end(false);
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
  };

  next() { if (this.index < this.steps.length - 1) { this.index++; this._render(); } else { this.end(true); } }
  prev() { if (this.index > 0) { this.index--; this._render(); } }

  end(completed) {
    this._teardown();
    // Return to wherever the user started — completing and skipping both restore,
    // so replaying from "Show tour again" never strands them in an admin view.
    if (this._startView && App.controller && App.controller.uiState
        && App.controller.uiState.view !== this._startView) {
      try { App.controller.setView(this._startView); } catch (e) {}
    }
    // Dismiss (Skip/Esc) counts the same as finishing — the user has seen it
    // and doesn't want it again. The `completed` flag is kept on the callback
    // in case a caller wants to distinguish, but it no longer gates the call.
    if (typeof this.onFinish === 'function') this.onFinish(completed);
  }

  _teardown() {
    window.removeEventListener('resize', this._reposition);
    window.removeEventListener('keydown', this._onKey);
    if (this.els) { this.els.root.remove(); this.els = null; }
  }

  /* ---------- DOM ---------- */
  _mount() {
    const root = document.createElement('div');
    root.className = 'tour-root';
    root.innerHTML = `
      <div class="tour-catch"></div>
      <div class="tour-highlight"></div>
      <div class="tour-tooltip" role="dialog" aria-modal="true">
        <div class="tour-arrow"></div>
        <div class="tour-title"></div>
        <div class="tour-body"></div>
        <div class="tour-foot">
          <div class="tour-dots"></div>
          <div class="tour-actions">
            <button class="btn btn-sm" data-tour="skip">Skip</button>
            <button class="btn btn-sm" data-tour="prev">Back</button>
            <button class="btn btn-sm btn-primary" data-tour="next">Next</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.els = {
      root,
      catch: root.querySelector('.tour-catch'),
      highlight: root.querySelector('.tour-highlight'),
      tooltip: root.querySelector('.tour-tooltip'),
      arrow: root.querySelector('.tour-arrow'),
      title: root.querySelector('.tour-title'),
      body: root.querySelector('.tour-body'),
      dots: root.querySelector('.tour-dots'),
      prev: root.querySelector('[data-tour="prev"]'),
      next: root.querySelector('[data-tour="next"]'),
      skip: root.querySelector('[data-tour="skip"]'),
    };
    this.els.catch.addEventListener('click', () => { /* swallow clicks to the app */ });
    this.els.prev.addEventListener('click', () => this.prev());
    this.els.next.addEventListener('click', () => this.next());
    this.els.skip.addEventListener('click', () => this.end(false));
  }

  _render() {
    if (!this.els) return;
    const step = this.steps[this.index];
    const last = this.index === this.steps.length - 1;
    this.els.title.textContent = step.title;
    this.els.body.textContent = step.body;
    this.els.prev.style.visibility = this.index === 0 ? 'hidden' : 'visible';
    this.els.next.textContent = last ? 'Done' : 'Next';
    this.els.dots.innerHTML = this.steps.map((_, i) =>
      `<span class="tour-dot ${i === this.index ? 'on' : ''}"></span>`).join('');

    // Walk into the step's section first, if it isn't already open. Navigation
    // is driven from _render (not next()), so Back and Next both re-navigate.
    if (step.view && App.controller && App.controller.uiState.view !== step.view) {
      try { App.controller.setView(step.view); } catch (e) {}
    }

    // The section may have just navigated, so wait for the spotlight target to
    // lay out before measuring. Guard against a stale wait finishing after the
    // user has already advanced to another step.
    const seq = ++this._renderSeq;
    this._waitForTarget(step.sel, (target) => {
      if (seq !== this._renderSeq || !this.els) return;
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
      }
      requestAnimationFrame(() => { if (seq === this._renderSeq) this._place(target); });
    });
  }

  /* Resolve a spotlight target once it's actually laid out. Polls a few frames
     (a freshly-navigated view mounts async) then gives up — a null target makes
     _place fall back to a centered card, so the tour never hangs. */
  _waitForTarget(sel, cb) {
    if (!sel) { cb(null); return; }
    let frames = 0;
    const tick = () => {
      if (!this.els) return; // torn down mid-wait
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { cb(el); return; }
      }
      if (++frames > 20) { cb(el || null); return; } // ~330ms fallback
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _place(target) {
    if (!this.els) return;
    const { highlight, tooltip, arrow } = this.els;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tRect = tooltip.getBoundingClientRect();
    const tw = tRect.width || 320;
    const th = tRect.height || 160;
    const gap = 14;

    if (!target) {
      // Centered (welcome / closing steps): dim everything, no spotlight.
      highlight.style.opacity = '0';
      arrow.style.display = 'none';
      tooltip.style.left = Math.round((vw - tw) / 2) + 'px';
      tooltip.style.top = Math.round((vh - th) / 2) + 'px';
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 6;
    highlight.style.opacity = '1';
    highlight.style.left = Math.round(r.left - pad) + 'px';
    highlight.style.top = Math.round(r.top - pad) + 'px';
    highlight.style.width = Math.round(r.width + pad * 2) + 'px';
    highlight.style.height = Math.round(r.height + pad * 2) + 'px';

    const below = r.bottom + gap + th <= vh;
    let top = below ? r.bottom + gap : r.top - gap - th;
    if (top < 8) top = 8;
    if (top + th > vh - 8) top = vh - 8 - th;

    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, vw - tw - 8));

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';

    // Arrow points at the target's horizontal centre, clamped to the tooltip.
    arrow.style.display = 'block';
    arrow.classList.toggle('down', !below); // arrow on bottom edge when tooltip is above
    const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, tw - 14));
    arrow.style.left = Math.round(arrowX) + 'px';
  }
};
