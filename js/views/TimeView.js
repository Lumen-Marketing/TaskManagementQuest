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
    // The Team workload roster + its teamScope() read App.PEOPLE / App.PROFILES,
    // which can load (or change) after the board first renders. Re-render on
    // people:changed so it doesn't sit empty/stale until an unrelated event.
    App.EventBus.on('people:changed', () => { if (this.visible()) this.render(); });
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
      if (!at) return;
      // The "Currently tracking" banner (data-live-shift) shows today's running
      // total for the active task so it resumes across task switches; the team
      // board's rows show only the current session's elapsed.
      if (el.hasAttribute('data-live-shift')) {
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        el.textContent = App.utils.formatDuration(this.timeModel.sessionTotalForUserTask(uid, at.taskId, day0.getTime()));
      } else {
        el.textContent = App.utils.formatDuration(Date.now() - at.startedAt);
      }
    });
  }

  render() {
    const view = this.controller.uiState.view;
    if (view === 'time:mine')         this.wrap.innerHTML = this.renderMyTime();
    else if (view === 'time:resource')  this.wrap.innerHTML = this.renderResource();

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
          <td>${company ? `<span class="pill ${company.pill}">${App.utils.escapeHtml(company.label)}</span>` : '—'}</td>
          <td class="mono">${App.utils.formatInstant(e.start, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</td>
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
            <span class="live-time" data-live-timer="${me}" data-live-shift="1">${App.utils.formatDuration(this.timeModel.sessionTotalForUserTask(me, active.taskId, today0.getTime()))}</span>
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

  /* Predicate that narrows the Team workload board to the viewer's own team:
     themselves plus their direct reports (profiles whose supervisor_id points
     at the viewer's member_id) — mirrors the report scoping in
     TaskListView.getFilteredTasks. When the viewer has no direct reports
     (an admin/developer who supervises nobody, a developer previewing "as
     supervisor", or a hierarchy that isn't set up yet) we DON'T narrow, so the
     board never collapses to a single self row. */
  teamScope() {
    const me = (App.currentProfile && App.currentProfile.member_id) || this.currentUser;
    const reportIds = new Set((App.PROFILES || [])
      .filter(p => p.supervisor_id === me && p.approved !== false)
      .map(p => p.member_id));
    if (reportIds.size === 0) return () => true;
    reportIds.add(me);
    return (id) => reportIds.has(id);
  }

  renderResource() {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

    const inTeam = this.teamScope();
    const active = this.timeModel.allActive().filter(timer => inTeam(timer.userId));

    const liveRows = active.map(timer => {
      const p = App.PEOPLE[timer.userId] || App.utils.unknownPerson(timer.userId);
      // Prefer the loaded task; fall back to the label snapshotted on the timer
      // at clock-in so a task the viewer can't load still shows its name.
      const t = this.taskModel.find(timer.taskId);
      const title = t ? t.title : timer.taskTitle;
      const company = App.COMPANIES[t ? t.company : timer.taskCompany];
      return `
        <tr class="live">
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              ${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)}
            </span>
          </td>
          <td>${title ? App.utils.escapeHtml(title) : '—'}</td>
          <td>${company ? `<span class="pill ${company.pill}">${App.utils.escapeHtml(company.label)}</span>` : '—'}</td>
          <td class="mono" data-live-timer="${timer.userId}">${App.utils.formatDuration(Date.now() - timer.startedAt)}</td>
          <td><span style="display:inline-flex; align-items:center; gap:4px; color:var(--green-ink); font-size:11px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span>Live</span></td>
        </tr>
      `;
    }).join('');

    // Roster from team_members, unioned with anyone who actually tracked time
    // (a live timer or an entry in the last 7 days) so their hours always show
    // here — otherwise the current user / non-roster members are dropped. Then
    // narrowed to the viewer's own team (teamScope): unlike the admin Clock
    // dashboard, the Team workload board is a supervisor's view of THEIR people.
    const peopleRows = App.utils.rosterWithActivity(this.timeModel, week0.getTime())
      .filter(p => inTeam(p.id))
      .map(p => {
        const todayMs = this.timeModel.totalForUser(p.id, today0.getTime());
        const weekMs = this.timeModel.totalForUser(p.id, week0.getTime());
        const isActive = this.timeModel.isRunning(p.id);
        return `
          <tr>
            <td>
              <span style="display:inline-flex; align-items:center; gap:6px;">
                ${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)}
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
};
