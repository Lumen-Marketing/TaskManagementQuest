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

    const watcherIds = t.watchers || [];
    const watcherChipsHtml = watcherIds.map(w => {
      const p = App.PEOPLE[w];
      if (!p) return '';
      return `<span class="watcher-chip-detail" data-watcher-id="${App.utils.escapeHtml(w)}">
        ${App.utils.avatarHtml(p)}
        ${App.utils.escapeHtml(p.name)}
        <button class="watcher-remove" data-action="remove-watcher" data-member-id="${App.utils.escapeHtml(w)}" aria-label="Remove ${App.utils.escapeHtml(p.name)}" type="button">×</button>
      </span>`;
    }).join('');
    const addableWatchers = App.utils.activePeople().filter(p =>
      p.id !== t.assignee && !watcherIds.includes(p.id)
    );
    const watcherAddSelect = addableWatchers.length ? `
      <select class="watcher-add-select" data-action="add-watcher">
        <option value="">+ Add watcher…</option>
        ${addableWatchers.map(p =>
          `<option value="${App.utils.escapeHtml(p.id)}">${App.utils.escapeHtml(p.full)}</option>`
        ).join('')}
      </select>
    ` : '';
    const watchersHtml = `
      <div class="watchers-cell">
        ${watcherChipsHtml || (addableWatchers.length ? '' : '<span style="color:var(--ink-3); font-size:11px;">No watchers</span>')}
        ${watcherAddSelect}
      </div>
    `;

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
      <button class="detail-expand-btn" data-action="expand-detail" aria-label="Expand task details" type="button">
        <i class="ti ti-chevrons-left"></i>
      </button>
      <div class="detail-head">
        <div class="detail-head-top">
          <span class="pill ${company.pill}">${company.label}</span>
          <div class="detail-head-actions">
            <button class="icon-btn" data-action="minimize-detail" aria-label="Minimize" title="Minimize" type="button"><i class="ti ti-chevrons-right"></i></button>
            <button class="icon-btn" data-action="close" aria-label="Close" title="Close" type="button"><i class="ti ti-x"></i></button>
          </div>
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
          <span class="label">Company</span>
          <select data-field="company" style="font-size:12px; padding:4px 8px;">
            ${Object.values(App.COMPANIES).map(c => `<option value="${App.utils.escapeHtml(c.id)}" ${t.company === c.id ? 'selected' : ''}>${App.utils.escapeHtml(c.label)}</option>`).join('')}
          </select>
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
          <span class="label">Assignee</span>
          <select data-action="reassign" style="font-size:12px; padding:4px 8px;">
            ${App.utils.activePeople(t.assignee).map(p => `<option value="${p.id}" ${t.assignee === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Created by</span>
          <span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2);">
            ${App.utils.avatarHtml(creator)}${creator.name}
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
          <div class="detail-priority-cell">
            <span class="priority-block ${(App.PRIORITIES[t.priority] || App.PRIORITIES.medium).cls}">${(App.PRIORITIES[t.priority] || App.PRIORITIES.medium).label}</span>
            <select data-field="priority" class="detail-priority-select" style="font-size:12px; padding:4px 8px;">
              ${Object.entries(App.PRIORITIES).map(([k, v]) => `<option value="${k}" ${(t.priority || 'medium') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
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

        ${this.controller.canDeleteTasks() ? `
        <div class="detail-danger-zone">
          <button class="btn-link-danger" data-action="delete-task" type="button">
            <i class="ti ti-trash"></i> Delete task
          </button>
        </div>
        ` : ''}
      </div>
    `;

    this.bindHandlers(t);
  }

  bindHandlers(t) {
    this.pane.querySelector('[data-action="close"]').addEventListener('click', () => this.controller.closeDetail());

    // Restore prior minimize preference whenever this view rerenders.
    if (localStorage.getItem('questhq:detail-minimized') === '1') {
      this.pane.classList.add('minimized');
    }
    const minBtn = this.pane.querySelector('[data-action="minimize-detail"]');
    if (minBtn) minBtn.addEventListener('click', () => {
      this.pane.classList.add('minimized');
      try { localStorage.setItem('questhq:detail-minimized', '1'); } catch (e) {}
    });
    const expandBtn = this.pane.querySelector('[data-action="expand-detail"]');
    if (expandBtn) expandBtn.addEventListener('click', () => {
      this.pane.classList.remove('minimized');
      try { localStorage.setItem('questhq:detail-minimized', '0'); } catch (e) {}
    });

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

    const deleteBtn = this.pane.querySelector('[data-action="delete-task"]');
    if (deleteBtn) deleteBtn.addEventListener('click', () => this.controller.deleteTask(t.id));

    this.pane.querySelectorAll('[data-action="remove-watcher"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controller.removeWatcher(t.id, btn.dataset.memberId);
      });
    });
    const addWatcherSel = this.pane.querySelector('[data-action="add-watcher"]');
    if (addWatcherSel) {
      addWatcherSel.addEventListener('change', () => {
        const id = addWatcherSel.value;
        if (id) this.controller.addWatcher(t.id, id);
      });
    }
  }
};
