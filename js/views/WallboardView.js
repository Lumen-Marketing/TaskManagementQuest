window.App = window.App || {};

/* WallboardView — full-screen, auto-refreshing "office TV" board of the whole
   company team and each person's open tasks. Entered via the sidebar; exits on
   Esc or the Exit button. Read-only. Follows the app's current theme. */
App.WallboardView = class WallboardView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('wallboardWrap');
    this._clockTimer = null;
    this._fallbackTimer = null;
    this._prevView = 'home';          // where Esc / Exit returns to
    this._onKeydown = this._onKeydown.bind(this);
    App.wallboardView = this;          // exposed for tests / debugging
    this.subscribe();
  }

  subscribe() {
    const rerender = () => { if (this._active()) this.render(); };
    App.EventBus.on('tasks:changed',   rerender);
    App.EventBus.on('people:changed',  rerender);
    App.EventBus.on('company:changed', rerender);
    App.EventBus.on('view:changed', (v) => {
      if (v === 'wallboard') this._enter();
      else { this._prevView = v; this._leave(); }
    });
  }

  _active() { return !!this.wrap && !this.wrap.classList.contains('hidden'); }
  _timersActive() { return !!(this._clockTimer || this._fallbackTimer); }

  _enter() {
    document.addEventListener('keydown', this._onKeydown);
    this._startTimers();
    this.render();
  }

  _leave() {
    document.removeEventListener('keydown', this._onKeydown);
    this._stopTimers();
  }

  _startTimers() {
    this._stopTimers();
    this._clockTimer = setInterval(() => this._renderClock(), 1000);
    this._fallbackTimer = setInterval(() => this.render(), 60000);
  }

  _stopTimers() {
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
  }

  _onKeydown(e) {
    // Don't steal Esc from an open modal.
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
      this.controller.setView(this._prevView || 'home');
    }
  }

  _renderClock() {
    const el = this.wrap && this.wrap.querySelector('.wb-clock');
    if (el) el.textContent = this._clockText();
  }

  _clockText() {
    const tz = (App.timezone && App.timezone()) || undefined;
    try {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date());
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date());
    }
  }

  _scopedTasks() {
    return this.controller.visibleTasks({ includeDone: true });
  }

  _roleSub(personId) {
    const profile = (App.PROFILES || []).find(pr => pr.member_id === personId);
    return (profile && profile.role) ? String(profile.role) : '';
  }

  _prioColor(priority) {
    switch (priority) {
      case 'critical':
      case 'urgent': return 'var(--rust)';
      case 'high':   return 'var(--u-high)';
      case 'medium': return 'var(--u-medium)';
      default:       return 'var(--u-low)';
    }
  }

  _fmtDue(due) {
    if (!due) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(due + 'T00:00:00'));
    } catch (e) { return String(due).slice(5); }
  }

  // blocked (hold) first, then overdue, then soonest due.
  _sortTasks(tasks, today) {
    const rank = (t) => (t.status === 'hold' ? 0 : (t.due && t.due < today ? 1 : 2));
    return tasks.slice().sort((a, b) =>
      rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }

  _initials(name) {
    const s = String(name || '?').trim();
    const parts = s.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  _taskRow(t, today) {
    const esc = App.utils.escapeHtml;
    const blocked = t.status === 'hold';
    const overdue = !blocked && t.due && t.due < today;
    return `
      <div class="wb-task ${blocked ? 'wb-task--blocked' : ''}">
        <span class="wb-dot" style="background:${this._prioColor(t.priority)}"></span>
        <span class="wb-task-t">${esc(t.title)}</span>
        ${blocked
          ? `<span class="wb-badge">BLOCKED</span>`
          : `<span class="wb-due ${overdue ? 'over' : ''}">${esc(this._fmtDue(t.due))}</span>`}
      </div>`;
  }

  _personCard(person, tasks, today) {
    const esc = App.utils.escapeHtml;
    const open = this._sortTasks(tasks.filter(t => t.status !== 'done'), today);
    const sub = this._roleSub(person.id);
    const shown = open.slice(0, 4).map(t => this._taskRow(t, today)).join('');
    const moreCount = open.length - Math.min(open.length, 4);
    const body = open.length
      ? shown + (moreCount > 0 ? `<div class="wb-more">+${moreCount} more</div>` : '')
      : `<div class="wb-clear">All clear ✅</div>`;
    return `
      <div class="wb-card">
        <div class="wb-card-head">
          <span class="avatar-sm" style="background:${esc(person.color || 'var(--ink)')}">${esc(this._initials(person.full || person.name))}</span>
          <div class="wb-who">
            <div class="wb-name">${esc(person.full || person.name || person.id)}</div>
            ${sub ? `<div class="wb-role">${esc(sub)}</div>` : ''}
          </div>
          <div class="wb-open"><span class="wb-open-n">${open.length}</span><span class="wb-open-l">open</span></div>
        </div>
        <div class="wb-tasks">${body}</div>
      </div>`;
  }

  render() {
    if (!this.wrap) return;
    const esc = App.utils.escapeHtml;
    const today = App.utils.todayISO(0);
    const all = this._scopedTasks();
    const open = all.filter(t => t.status !== 'done');
    const done = all.filter(t => t.status === 'done');
    const blocked = all.filter(t => t.status === 'hold');

    const people = App.utils.activePeople();
    const tasksByPerson = (id) => all.filter(t => t.assignee === id);

    const dateLine = (() => {
      try {
        return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
      } catch (e) { return today; }
    })();

    const cards = people.map(p => this._personCard(p, tasksByPerson(p.id), today)).join('');

    this.wrap.innerHTML = `
      <div class="wb-head">
        <div class="wb-head-l">
          <div class="wb-title">Quest HQ — Today</div>
          <div class="wb-sub">${esc(dateLine)} · everybody's tasks for the day</div>
        </div>
        <div class="wb-head-r">
          <div class="wb-stats">
            <div class="wb-stat"><span class="wb-stat-n">${open.length}</span><span class="wb-stat-l">Active</span></div>
            <div class="wb-stat"><span class="wb-stat-n">${done.length}</span><span class="wb-stat-l">Done</span></div>
            <div class="wb-stat"><span class="wb-stat-n wb-stat-blocked">${blocked.length}</span><span class="wb-stat-l">Blocked</span></div>
          </div>
          <div class="wb-clock">${esc(this._clockText())}</div>
          <button type="button" class="wb-exit" data-action="exit"><i class="ti ti-x"></i> Exit</button>
        </div>
      </div>
      <div class="wb-grid">${cards}</div>
      <div class="wb-foot"><span class="wb-live"></span> Live · Auto-refreshing · press Esc to exit</div>`;

    const exitBtn = this.wrap.querySelector('.wb-exit');
    if (exitBtn) exitBtn.addEventListener('click', () => this.controller.setView(this._prevView || 'home'));
  }
};
