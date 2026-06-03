window.App = window.App || {};

/* ClockDashboardView — admin-only "who's clocked in right now?" board.
   Renders into the shared timeViewWrap container.
   - Live elapsed timers update once per second via clock:tick
   - Stale rebuild on tasks/time/view changes */
App.ClockDashboardView = class ClockDashboardView {
  constructor({ taskModel, timeModel, controller }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.wrap = document.getElementById('timeViewWrap');

    this.subscribe();
  }

  subscribe() {
    App.EventBus.on('view:changed', (view) => { if (view === 'admin:clock') this.render(); });
    App.EventBus.on('time:changed', () => { if (this.isActive()) this.render(); });
    App.EventBus.on('tasks:changed', () => { if (this.isActive()) this.render(); });
    App.EventBus.on('people:changed', () => { if (this.isActive()) this.render(); });
    App.EventBus.on('clock:tick', () => this.tickLive());
  }

  isActive() {
    return this.controller.uiState.view === 'admin:clock' && !this.wrap.classList.contains('hidden');
  }

  render() {
    if (!App.can('clock.admin')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><div class="empty-title">No access</div><div class="empty-sub">Only admins can view the clock dashboard.</div></div>`;
      return;
    }

    const active = this.timeModel.allActive();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

    const liveRows = active.map(timer => {
      const p = App.PEOPLE[timer.userId] || { name: timer.userId, full: timer.userId, color: '#E8A03A' };
      const t = this.taskModel.find(timer.taskId);
      const company = t ? App.COMPANIES[t.company] : null;
      const startedAtLabel = new Date(timer.startedAt).toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
      });
      return `
        <tr class="live">
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              ${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.full)}
            </span>
          </td>
          <td>${t ? App.utils.escapeHtml(t.title) : '<em>unknown task</em>'}</td>
          <td>${company ? `<span class="pill ${company.pill}">${company.label}</span>` : '—'}</td>
          <td class="mono">${App.utils.escapeHtml(startedAtLabel)}</td>
          <td class="mono" data-live-timer="${timer.userId}">${App.utils.formatDuration(Math.min(Date.now() - timer.startedAt, App.MAX_SHIFT_MS))}</td>
        </tr>
      `;
    }).join('');

    const everyone = App.utils.activePeople().map(p => {
      const todayMs = this.timeModel.totalForUser(p.id, today0.getTime());
      const weekMs = this.timeModel.totalForUser(p.id, week0.getTime());
      const isLive = this.timeModel.isRunning(p.id);
      return { p, todayMs, weekMs, isLive };
    }).sort((a, b) => (b.isLive - a.isLive) || (b.todayMs - a.todayMs));

    const everyoneRows = everyone.map(({ p, todayMs, weekMs, isLive }) => `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            ${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.full)}
          </span>
        </td>
        <td>${isLive
            ? '<span style="color:var(--green-ink); font-size:11px;">● Clocked in</span>'
            : '<span style="color:var(--ink-3); font-size:11px;">Off the clock</span>'}</td>
        <td class="mono">${App.utils.formatHours(todayMs)}</td>
        <td class="mono">${App.utils.formatHours(weekMs)}</td>
      </tr>
    `).join('');

    this.wrap.innerHTML = `
      <div class="time-page">
        <div class="time-section">
          <div class="time-card-grid">
            <div class="time-card">
              <div class="time-card-label">Live right now</div>
              <div class="time-card-value">${active.length}</div>
              <div class="time-card-sub">${active.length === 1 ? 'person clocked in' : 'people clocked in'}</div>
            </div>
            <div class="time-card">
              <div class="time-card-label">Team hours today</div>
              <div class="time-card-value">${App.utils.formatHours(everyone.reduce((sum, r) => sum + r.todayMs, 0))}</div>
            </div>
            <div class="time-card">
              <div class="time-card-label">Team hours · last 7d</div>
              <div class="time-card-value">${App.utils.formatHours(everyone.reduce((sum, r) => sum + r.weekMs, 0))}</div>
            </div>
          </div>
        </div>

        <div class="time-section">
          <div class="time-section-title">Active right now</div>
          ${active.length ? `
            <table class="time-table">
              <thead><tr><th>Person</th><th>Current task</th><th>Project</th><th>Started</th><th>Elapsed</th></tr></thead>
              <tbody>${liveRows}</tbody>
            </table>
          ` : `<div class="empty"><i class="ti ti-zzz"></i><div class="empty-title">Nobody is clocked in</div><div class="empty-sub">When someone starts a timer it'll appear here.</div></div>`}
        </div>

        <div class="time-section">
          <div class="time-section-title">Everyone</div>
          <table class="time-table">
            <thead><tr><th>Person</th><th>Status</th><th>Today</th><th>Last 7 days</th></tr></thead>
            <tbody>${everyoneRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  tickLive() {
    if (!this.isActive()) return;
    this.wrap.querySelectorAll('[data-live-timer]').forEach(el => {
      const uid = el.getAttribute('data-live-timer');
      const at = this.timeModel.activeFor(uid);
      if (at) el.textContent = App.utils.formatDuration(Math.min(Date.now() - at.startedAt, App.MAX_SHIFT_MS));
    });
  }
};
