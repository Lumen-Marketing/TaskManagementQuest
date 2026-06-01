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
    this._reposition = () => this._render();
  }

  /* ---------- step definitions (role-aware) ---------- */
  buildSteps() {
    const can = (p) => App.can(p);
    const defs = [];
    defs.push({ sel: null, title: 'Welcome to Quest HQ', body: "Here's a 30-second tour of the basics. You can replay it anytime from the ? button up top." });

    if (can('tasks.view')) {
      defs.push({ sel: '.grp-views', title: 'Your views', body: "Switch between All tasks, the ones assigned to you (Mine), what's Urgent, and what's due Today." });
    }
    defs.push({ sel: '#listPane', title: 'Your task list', body: can('tasks.view')
      ? 'Each row shows the task, its due date/time and status. Tap a task to open its details.'
      : 'The work assigned to you shows up here, with the scheduled time on the left.' });

    if (can('tasks.write')) {
      defs.push({ sel: '#newTaskBtn', title: 'Create a task', body: 'Add a task, set a date and an optional time, choose who it’s for, and notify them.' });
    }
    if (can('clock.use')) {
      defs.push({ sel: '#clockWidget', title: 'Clock in & out', body: 'Tap here to start and stop your timer. If you forget, it auto-closes after 12 hours.' });
    }
    if (can('tasks.view')) {
      defs.push({ sel: '#moreViewsBtn', title: 'More views', body: 'Company filters (Roofing, Drafting, Lumen) and time reports are tucked in here to keep things tidy.' });
    }
    if (can('team.view')) {
      defs.push({ sel: '[data-view="team:hierarchy"]', title: 'Team chart', body: 'See the people who report to you and the staff you oversee.' });
    }
    if (can('roles.manage')) {
      defs.push({ sel: '[data-view="approvals"]', title: 'Approvals', body: 'Approve new accounts, set each person’s role, and choose who they report to.' });
    }
    defs.push({ sel: '#notifBtn', title: 'Notifications', body: 'When someone assigns you a task or adds you as a watcher, it shows up here.' });
    defs.push({ sel: '#userAvatar', title: 'Your account', body: 'Switch between light and dark mode, or sign out, from this menu.' });
    defs.push({ sel: null, title: "You're all set", body: 'That’s the tour. Reopen it anytime with the ? button. Welcome aboard!' });

    return defs.filter(s => !s.sel || this._visible(s.sel));
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

    const target = step.sel ? document.querySelector(step.sel) : null;
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    }
    // Position after any scroll settles.
    requestAnimationFrame(() => this._place(target));
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
