window.App = window.App || {};

App.TaskDetailView = class TaskDetailView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.pane = document.getElementById('detailPane');
    this.mainEl = document.getElementById('mainPane');

    this.subscribe();
    this.render();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.render());
    App.EventBus.on('time:changed', () => this.render());
    App.EventBus.on('selection:changed', () => this.render());
    App.EventBus.on('view:changed', () => this.render());
    App.EventBus.on('clock:tick', () => this.tickLive());
  }

  tickLive() {
    const active = this.timeModel.activeFor(this.currentUser);
    const liveEl = this.pane.querySelector('#detail-live-timer');
    if (active && liveEl) {
      liveEl.textContent = App.utils.formatDuration(Date.now() - active.startedAt);
    }
  }

  render() {
    const selId = this.controller.uiState.selectedTaskId;
    const view = this.controller.uiState.view;

    // Time-tracking views don't show a detail pane
    if (!selId || view.startsWith('time:')) {
      this.pane.classList.add('hidden');
      this.mainEl.classList.remove('with-detail');
      return;
    }

    const t = this.taskModel.find(selId);
    if (!t) {
      this.pane.classList.add('hidden');
      this.mainEl.classList.remove('with-detail');
      return;
    }

    this.pane.classList.remove('hidden');
    this.mainEl.classList.add('with-detail');

    const creator = App.PEOPLE[t.creator];
    const assignee = App.PEOPLE[t.assignee];
    const company = App.COMPANIES[t.company];
    const delegated = t.creator !== t.assignee;
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const totalMs = this.timeModel.totalForTask(t.id);

    const watchersHtml = (t.watchers || []).map(w => {
      const p = App.PEOPLE[w];
      return `<span style="display:inline-flex; align-items:center; gap:4px; background:var(--bg-2); padding:2px 7px; border-radius:10px; font-size:11px; margin-right:4px;"><span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.name}</span>`;
    }).join('') || `<span style="color:var(--ink-3); font-size:11px;">No watchers</span>`;

    const subtasksHtml = (t.subtasks || []).map((s, i) =>
      `<div class="subtask ${s.d ? 'done' : ''}" data-action="toggle-subtask" data-idx="${i}">
         <i class="ti ${s.d ? 'ti-circle-check-filled' : 'ti-circle'}"></i>${App.utils.escapeHtml(s.t)}
       </div>`
    ).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No subtasks yet</div>`;

    const activityHtml = (t.activity || []).map(a =>
      `<div class="activity-item"><span class="who">${App.utils.escapeHtml(a.who)}</span> ${App.utils.escapeHtml(a.what)} · ${App.utils.escapeHtml(a.when)}</div>`
    ).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No activity yet</div>`;

    const recentEntries = this.timeModel.entriesForTask(t.id).slice(0, 5);
    const entriesHtml = recentEntries.length
      ? recentEntries.map(e =>
          `<div class="activity-item">
             <span class="who">${App.PEOPLE[e.userId] ? App.PEOPLE[e.userId].name : e.userId}</span> logged
             <strong style="color:var(--ink-2);">${App.utils.formatHours(e.durationMs)}</strong>
             · ${App.utils.timeAgo(e.end)}
           </div>`
        ).join('')
      : `<div style="font-size:11.5px; color:var(--ink-3);">No time logged yet</div>`;

    this.pane.innerHTML = `
      <div class="detail-head">
        <div class="detail-head-top">
          <span class="pill ${company.pill}">${company.label}</span>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="detail-title">${App.utils.escapeHtml(t.title)}</div>
      </div>
      <div class="detail-body">
        ${delegated ? `
          <div class="delegation-banner">
            <i class="ti ti-send"></i>
            <span><strong>${assignee.name}</strong> assigned by <strong>${creator.name}</strong></span>
          </div>
        ` : ''}

        ${myTimerOnThis ? `
          <div class="timer-banner">
            <i class="ti ti-player-record-filled"></i>
            <span>Tracking time on this task</span>
            <span class="live-time" id="detail-live-timer">${App.utils.formatDuration(Date.now() - myActive.startedAt)}</span>
          </div>
        ` : ''}

        <div style="display:flex; gap:6px; margin-bottom:14px;">
          <button class="btn ${myTimerOnThis ? 'btn-danger' : 'btn-primary'}" style="flex:1;" data-action="toggle-timer">
            <i class="ti ${myTimerOnThis ? 'ti-player-stop-filled' : 'ti-player-play-filled'}"></i>
            ${myTimerOnThis ? 'Clock out' : 'Clock in on this task'}
          </button>
        </div>

        <div class="detail-row">
          <span class="label">Type</span>
          <select data-field="type" style="font-size:12px; padding:4px 8px;">
            ${Object.entries(App.TASK_TYPES).map(([k, v]) => `<option value="${k}" ${(t.type || 'admin') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        ${t.type === 'bid' ? `
        <div class="detail-row">
          <span class="label">Bid status</span>
          <select data-field="bidStatus" style="font-size:12px; padding:4px 8px;">
            ${Object.entries(App.BID_STATUSES).map(([k, v]) => `<option value="${k}" ${(t.bidStatus || 'queue') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="detail-row">
          <span class="label">Status</span>
          <select data-field="status" style="font-size:12px; padding:4px 8px;">
            ${Object.entries(App.STATUSES).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Owner</span>
          <select data-action="reassign" style="font-size:12px; padding:4px 8px;">
            ${Object.values(App.PEOPLE).map(p => `<option value="${p.id}" ${t.assignee === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Created by</span>
          <span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2);">
            <span class="avatar-xs" style="background:${creator.color};">${App.utils.initials(creator.full)}</span>${creator.name}
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Due</span>
          <input type="date" value="${t.due}" data-field="due" class="picker-input" style="font-size:12px; padding:4px 8px;" />
        </div>
        <div class="detail-row">
          <span class="label">Time <span class="field-optional">Optional</span></span>
          <input type="time" value="${t.dueTime || ''}" data-field="dueTime" class="picker-input" style="font-size:12px; padding:4px 8px;" />
        </div>
        <div class="detail-row">
          <span class="label">Priority</span>
          <select data-field="priority" style="font-size:12px; padding:4px 8px;">
            <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>Low</option>
            <option value="medium" ${(t.priority || 'medium') === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high"   ${t.priority === 'high'   ? 'selected' : ''}>High</option>
            <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Urgency</span>
          <select data-field="urgency" style="font-size:12px; padding:4px 8px;">
            ${Object.entries(App.URGENCIES).map(([k, v]) => `<option value="${k}" ${(t.urgency || 'medium') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Time spent</span>
          <span style="font-family:'SFMono-Regular',monospace; font-size:12px; color:var(--ink-2);">${App.utils.formatHours(totalMs)} total</span>
        </div>
        <div class="detail-row">
          <span class="label">Watchers</span>
          <div>${watchersHtml}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Description</div>
          <div class="detail-desc">${App.utils.escapeHtml(t.description || '—')}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Subtasks</div>
          ${subtasksHtml}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Time entries</div>
          ${entriesHtml}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Activity</div>
          ${activityHtml}
        </div>
      </div>
    `;

    this.bindHandlers(t);
  }

  bindHandlers(t) {
    this.pane.querySelector('[data-action="close"]').addEventListener('click', () => this.controller.closeDetail());

    const timerBtn = this.pane.querySelector('[data-action="toggle-timer"]');
    if (timerBtn) timerBtn.addEventListener('click', () => this.controller.toggleTimerForTask(t.id));

    this.pane.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', () => this.controller.updateTaskField(t.id, el.dataset.field, el.value || null));
    });

    this.pane.querySelectorAll('.picker-input').forEach(input => {
      input.addEventListener('click', () => {
        try { input.showPicker(); } catch (e) { /* unsupported or not user-activated */ }
      });
    });

    const reassignSelect = this.pane.querySelector('[data-action="reassign"]');
    if (reassignSelect) reassignSelect.addEventListener('change', () => this.controller.reassignTask(t.id, reassignSelect.value));

    this.pane.querySelectorAll('[data-action="toggle-subtask"]').forEach(el => {
      el.addEventListener('click', () => this.controller.toggleSubtask(t.id, parseInt(el.dataset.idx, 10)));
    });
  }
};
