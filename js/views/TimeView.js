window.App = window.App || {};

App.TimeView = class TimeView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.wrap = document.getElementById('timeViewWrap');

    this.subscribe();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('time:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('view:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('clock:tick', () => this.tickLive());
  }

  visible() {
    return !this.wrap.classList.contains('hidden');
  }

  tickLive() {
    if (!this.visible()) return;
    this.wrap.querySelectorAll('[data-live-timer]').forEach(el => {
      const uid = el.getAttribute('data-live-timer');
      const at = this.timeModel.activeFor(uid);
      if (at) el.textContent = App.utils.formatDuration(Date.now() - at.startedAt);
    });
  }

  render() {
    const view = this.controller.uiState.view;
    if (view === 'time:mine')         this.wrap.innerHTML = this.renderMyTime();
    else if (view === 'time:resource')  this.wrap.innerHTML = this.renderResource();
    else if (view === 'time:analytics') this.wrap.innerHTML = this.renderAnalytics();

    this.bindHandlers();
  }

  bindHandlers() {
    this.wrap.querySelectorAll('[data-action="stop-timer"]').forEach(el => {
      el.addEventListener('click', () => this.controller.stopTimer(el.dataset.user));
    });
  }

  renderMyTime() {
    const me = this.currentUser;
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

    const todayMs = this.timeModel.totalForUser(me, today0.getTime());
    const weekMs = this.timeModel.totalForUser(me, week0.getTime());
    const allMs = this.timeModel.totalForUser(me);
    const active = this.timeModel.activeFor(me);
    const myEntries = this.timeModel.entriesForUser(me).slice(0, 20);

    const rows = myEntries.map(e => {
      const t = this.taskModel.find(e.taskId);
      const company = t ? App.COMPANIES[t.company] : null;
      return `
        <tr>
          <td>${t ? App.utils.escapeHtml(t.title) : '<em>unknown task</em>'}</td>
          <td>${company ? `<span class="pill ${company.pill}">${company.label}</span>` : '—'}</td>
          <td class="mono">${new Date(e.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
          <td class="mono">${App.utils.formatHours(e.durationMs)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="time-page">
        ${active ? `
          <div class="timer-banner" style="margin: 16px 0 0;">
            <i class="ti ti-player-record-filled"></i>
            <span>Currently tracking: <strong>${App.utils.escapeHtml((this.taskModel.find(active.taskId) || {}).title || 'task')}</strong></span>
            <span class="live-time" data-live-timer="${me}">${App.utils.formatDuration(Date.now() - active.startedAt)}</span>
            <button class="btn btn-danger btn-sm" data-action="stop-timer" data-user="${me}"><i class="ti ti-player-stop-filled"></i>Clock out</button>
          </div>
        ` : ''}

        <div class="time-section">
          <div class="time-card-grid">
            <div class="time-card">
              <div class="time-card-label">Today</div>
              <div class="time-card-value">${App.utils.formatHours(todayMs)}</div>
              <div class="time-card-sub">${active ? 'Clock running' : 'Clocked out'}</div>
            </div>
            <div class="time-card">
              <div class="time-card-label">Last 7 days</div>
              <div class="time-card-value">${App.utils.formatHours(weekMs)}</div>
            </div>
            <div class="time-card">
              <div class="time-card-label">All time</div>
              <div class="time-card-value">${App.utils.formatHours(allMs)}</div>
            </div>
            <div class="time-card">
              <div class="time-card-label">Entries</div>
              <div class="time-card-value">${this.timeModel.entriesForUser(me).length}</div>
            </div>
          </div>
        </div>

        <div class="time-section">
          <div class="time-section-title">Recent entries</div>
          ${myEntries.length ? `
            <table class="time-table">
              <thead><tr><th>Task</th><th>Project</th><th>Started</th><th>Hours</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          ` : `<div class="empty"><i class="ti ti-clock"></i><div class="empty-title">No entries yet</div><div class="empty-sub">Hit play on a task or press <kbd>T</kbd> to clock in.</div></div>`}
        </div>
      </div>
    `;
  }

  renderResource() {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

    const active = this.timeModel.allActive();

    const liveRows = active.map(timer => {
      const p = App.PEOPLE[timer.userId];
      const t = this.taskModel.find(timer.taskId);
      const company = t ? App.COMPANIES[t.company] : null;
      return `
        <tr class="live">
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.name}
            </span>
          </td>
          <td>${t ? App.utils.escapeHtml(t.title) : '—'}</td>
          <td>${company ? `<span class="pill ${company.pill}">${company.label}</span>` : '—'}</td>
          <td class="mono" data-live-timer="${timer.userId}">${App.utils.formatDuration(Date.now() - timer.startedAt)}</td>
          <td><span style="display:inline-flex; align-items:center; gap:4px; color:var(--green-ink); font-size:11px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span>Live</span></td>
        </tr>
      `;
    }).join('');

    const peopleRows = Object.values(App.PEOPLE).map(p => {
      const todayMs = this.timeModel.totalForUser(p.id, today0.getTime());
      const weekMs = this.timeModel.totalForUser(p.id, week0.getTime());
      const isActive = this.timeModel.isRunning(p.id);
      return `
        <tr>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.name}
            </span>
          </td>
          <td class="mono">${App.utils.formatHours(todayMs)}</td>
          <td class="mono">${App.utils.formatHours(weekMs)}</td>
          <td>${isActive
              ? '<span style="color:var(--green-ink); font-size:11px;">● Clocked in</span>'
              : '<span style="color:var(--ink-3); font-size:11px;">Off the clock</span>'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="time-page">
        <div class="time-section">
          <div class="time-section-title">Active right now</div>
          ${active.length ? `
            <table class="time-table">
              <thead><tr><th>Person</th><th>Task</th><th>Project</th><th>Elapsed</th><th></th></tr></thead>
              <tbody>${liveRows}</tbody>
            </table>
          ` : `<div class="empty"><i class="ti ti-zzz"></i><div class="empty-title">Nobody is clocked in</div><div class="empty-sub">When someone starts a timer it'll show up here.</div></div>`}
        </div>

        <div class="time-section">
          <div class="time-section-title">This team</div>
          <table class="time-table">
            <thead><tr><th>Person</th><th>Today</th><th>Last 7 days</th><th>Status</th></tr></thead>
            <tbody>${peopleRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderAnalytics() {
    const companyTotals = Object.keys(App.COMPANIES).map(c => {
      const taskIds = this.taskModel.byCompany(c).map(t => t.id);
      return {
        id: c,
        label: App.COMPANIES[c].label,
        ms: this.timeModel.totalForTaskIds(taskIds),
      };
    });
    const grand = companyTotals.reduce((s, c) => s + c.ms, 0);

    const companyBars = companyTotals.map(c => {
      const pct = grand > 0 ? Math.max(2, Math.round((c.ms / grand) * 100)) : 0;
      return `
        <div class="bar-row">
          <div>${c.label}</div>
          <div class="bar-track"><div class="bar-fill ${c.id}" style="width:${pct}%;"></div></div>
          <div class="bar-value">${App.utils.formatHours(c.ms)}</div>
        </div>
      `;
    }).join('');

    const taskTotals = this.taskModel.all()
      .map(t => ({ t, ms: this.timeModel.totalForTask(t.id) }))
      .filter(x => x.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10);

    const topTaskRows = taskTotals.map(x => {
      const company = App.COMPANIES[x.t.company];
      const person = App.PEOPLE[x.t.assignee];
      return `
        <tr>
          <td>${App.utils.escapeHtml(x.t.title)}</td>
          <td><span class="pill ${company.pill}">${company.label}</span></td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span class="avatar-xs" style="background:${person.color};">${App.utils.initials(person.full)}</span>${person.name}
            </span>
          </td>
          <td class="mono">${App.utils.formatHours(x.ms)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="time-page">
        <div class="time-section">
          <div class="time-card-grid">
            ${companyTotals.map(c => `
              <div class="time-card">
                <div class="time-card-label">${c.label}</div>
                <div class="time-card-value">${App.utils.formatHours(c.ms)}</div>
                <div class="time-card-sub">${grand > 0 ? Math.round(c.ms / grand * 100) : 0}% of total</div>
              </div>
            `).join('')}
            <div class="time-card">
              <div class="time-card-label">Total tracked</div>
              <div class="time-card-value">${App.utils.formatHours(grand)}</div>
              <div class="time-card-sub">All projects, all time</div>
            </div>
          </div>
        </div>

        <div class="time-section">
          <div class="time-section-title">Hours by project</div>
          <div class="time-card" style="padding:18px;">
            ${companyBars}
          </div>
        </div>

        <div class="time-section">
          <div class="time-section-title">Top tasks by time spent</div>
          ${taskTotals.length ? `
            <table class="time-table">
              <thead><tr><th>Task</th><th>Project</th><th>Owner</th><th>Hours</th></tr></thead>
              <tbody>${topTaskRows}</tbody>
            </table>
          ` : `<div class="empty"><i class="ti ti-chart-bar"></i><div class="empty-title">No data yet</div><div class="empty-sub">Track time on a few tasks to see the breakdown.</div></div>`}
        </div>
      </div>
    `;
  }
};
