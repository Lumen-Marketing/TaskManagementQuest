window.App = window.App || {};

App.TaskDetailView = class TaskDetailView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.pane = document.getElementById('detailPane');
    this.mainEl = document.getElementById('mainPane');
    // The detail pane is shown as a centered popup (same shell as the New task
    // modal). We relocate the existing #detailPane node into this backdrop on
    // open so all the render/query code below keeps targeting `this.pane`.
    this.backdrop = null;

    // Id of the task currently open in the staged Edit form, or null. While set,
    // background re-renders are suppressed so unsaved input survives. editDraft
    // holds the staged field values until Save (or is discarded on Cancel).
    this.editingId = null;
    this.editDraft = null;

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

  /* Mount the detail pane inside a centered modal backdrop (idempotent — called
     on every re-render). The #detailPane node is moved into the panel so the
     rest of this view's innerHTML/querySelector code is unchanged. */
  _openModal() {
    if (this.backdrop) return;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.id = 'taskDetailModal';

    const panel = document.createElement('div');
    panel.className = 'modal modal-detail';
    panel.setAttribute('data-stop', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Task details');

    this.pane.classList.remove('hidden');
    panel.appendChild(this.pane);
    this.backdrop.appendChild(panel);
    document.body.appendChild(this.backdrop);

    // Click outside the panel closes, like the New task modal.
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.controller.closeDetail();
    });
  }

  // Placeholder shown in the detail modal when a task is selected but its data
  // hasn't loaded yet (rare — the detail normally renders instantly from the
  // in-memory model). Keeps a working Close button.
  _detailSkeletonHtml() {
    const rows = Array.from({ length: 7 }).map(() =>
      `<div class="detail-row"><span class="sk sk-line" style="width:70px;"></span><span class="sk sk-line" style="width:130px;"></span></div>`
    ).join('');
    return `
      <div class="detail-head">
        <div class="detail-head-top">
          <span class="sk sk-pill" style="width:88px;"></span>
          <div class="detail-head-actions">
            <button class="icon-btn" data-action="close" aria-label="Close" title="Close" type="button"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="sk sk-line" style="height:24px; width:75%; margin-top:8px;"></div>
      </div>
      <div class="detail-body detail-skeleton" aria-hidden="true">
        <div class="sk sk-line" style="height:38px; margin-bottom:14px;"></div>
        ${rows}
      </div>
    `;
  }

  _closeModal() {
    // Legacy side-panel layout class (no longer used, kept defensive).
    this.mainEl.classList.remove('with-detail');
    if (this.backdrop) {
      // Removing the backdrop detaches #detailPane with it; we keep the JS
      // reference in this.pane and re-attach it on the next _openModal().
      this.backdrop.remove();
      this.backdrop = null;
    }
  }

  render() {
    const selId = this.controller.uiState.selectedTaskId;
    const view = this.controller.uiState.view;

    // Mid-edit: keep the staged form on screen and don't clobber unsaved input
    // on background re-renders (sync polls, time ticks). Drop edit mode only if
    // the selection moved to another task or a time view.
    if (this.editingId) {
      if (this.editingId === selId && !view.startsWith('time:')) return;
      this.editingId = null;
    }

    // Time-tracking views don't show a detail pane
    if (!selId || view.startsWith('time:')) {
      this._closeModal();
      return;
    }

    const t = this.taskModel.find(selId);
    if (!t) {
      // Selected but not in the model. If nothing has loaded yet (e.g. a
      // deep-linked / notification selection during boot), show a skeleton
      // instead of closing; once tasks are loaded, a missing task is gone.
      if (this.taskModel.all().length === 0) {
        this._openModal();
        this.pane.innerHTML = this._detailSkeletonHtml();
        const cb = this.pane.querySelector('[data-action="close"]');
        if (cb) cb.addEventListener('click', () => this.controller.closeDetail());
        return;
      }
      this._closeModal();
      return;
    }

    this._openModal();

    try {
    // Fall back gracefully if a task references a person or company that no
    // longer exists (e.g. a removed company or a deleted member). Without these
    // guards a single missing lookup throws while building the template and the
    // detail pane renders blank.
    const creator = App.PEOPLE[t.creator] || { name: t.creator || 'Unknown', full: t.creator || 'Unknown', color: 'var(--ink-3)' };
    const assignee = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: 'var(--ink-3)' };
    const company = App.COMPANIES[t.company] || { pill: '', label: t.company || '—' };
    const delegated = t.creator !== t.assignee;
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const totalMs = this.timeModel.totalForTask(t.id);

    // Read-only watcher chips — editing watchers lives in the Edit form.
    const watcherIds = t.watchers || [];
    const watchersHtml = `
      <div class="watchers-cell">
        ${watcherIds.map(w => {
          const p = App.PEOPLE[w];
          return p ? `<span class="watcher-chip-detail">${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)}</span>` : '';
        }).join('') || '<span style="color:var(--ink-3); font-size:11px;">No watchers</span>'}
      </div>
    `;

    // Read-only subtasks — toggling moved into the Edit form.
    const subtasksHtml = (t.subtasks || []).map((s) =>
      `<div class="subtask ${s.d ? 'done' : ''}">
         <i class="ti ${s.d ? 'ti-circle-check-filled' : 'ti-circle'}"></i>${App.utils.escapeHtml(s.t)}
       </div>`
    ).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No subtasks yet</div>`;

    const activityHtml = (t.activity || []).map(a => {
      // Prefer the real timestamp (relative); fall back to the legacy `when`
      // label for seed data / rows written before activity carried a timestamp.
      const ago = App.utils.timeAgo(a.at) || a.when || '';
      return `<div class="activity-item"><span class="who">${App.utils.escapeHtml(a.who)}</span> ${App.utils.escapeHtml(a.what)}${ago ? ` · ${App.utils.escapeHtml(ago)}` : ''}</div>`;
    }).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No activity yet</div>`;

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
          <div class="detail-head-actions">
            ${App.can('tasks.write') ? `<button class="icon-btn" data-action="edit-task" aria-label="Edit task" title="Edit task" type="button"><i class="ti ti-pencil"></i></button>` : ''}
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
          <span style="font-size:12px; color:var(--ink-2);">${App.utils.escapeHtml(company.label)}</span>
        </div>
        <div class="detail-row">
          <span class="label">Type</span>
          <span style="font-size:12px; color:var(--ink-2);">${App.utils.escapeHtml((App.TASK_TYPES[t.type] || App.TASK_TYPES.admin || { label: t.type || '—' }).label)}</span>
        </div>
        ${t.type === 'bid' ? `
        <div class="detail-row">
          <span class="label">Bid status</span>
          <span style="font-size:12px; color:var(--ink-2);">${App.utils.escapeHtml((App.BID_STATUSES[t.bidStatus] || { label: t.bidStatus || '—' }).label)}</span>
        </div>` : ''}
        <div class="detail-row">
          <span class="label">Status</span>
          <span style="font-size:12px; color:var(--ink-2);">${App.utils.escapeHtml((App.STATUSES[t.status] || { label: t.status || '—' }).label)}</span>
        </div>
        <div class="detail-row">
          <span class="label">Assignee</span>
          <span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2);">
            ${App.utils.avatarHtml(assignee)}${App.utils.escapeHtml(assignee.name)}
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Created by</span>
          <span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2);">
            ${App.utils.avatarHtml(creator)}${App.utils.escapeHtml(creator.name)}
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Due</span>
          <span style="font-size:12px; color:var(--ink-2);">${App.utils.escapeHtml(this._formatDue(t.due))}</span>
        </div>
        <div class="detail-row">
          <span class="label">Time</span>
          <span style="font-size:12px; color:var(--ink-2);">${t.dueTime ? App.utils.escapeHtml(App.utils.formatClockTz(t.dueTime)) : '—'}</span>
        </div>
        <div class="detail-row">
          <span class="label">Reminder</span>
          <span style="font-size:12px; color:var(--ink-2);">${t.reminderAt ? App.utils.escapeHtml(this._formatReminder(t.reminderAt)) : '—'}</span>
        </div>
        <div class="detail-row">
          <span class="label">Priority</span>
          <span class="priority-block ${(App.PRIORITIES[t.priority] || App.PRIORITIES.medium).cls}">${(App.PRIORITIES[t.priority] || App.PRIORITIES.medium).label}</span>
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
    } catch (err) {
      // Never leave the pane blank: show a message with a working Close button.
      if (App.observability) App.observability.captureException(err, { source: 'TaskDetailView.render' });
      console.error('[TaskDetailView] render failed', err);
      this.pane.innerHTML = `
        <div class="detail-head"><div class="detail-head-top">
          <span></span>
          <div class="detail-head-actions">
            <button class="icon-btn" data-action="close" aria-label="Close" title="Close" type="button"><i class="ti ti-x"></i></button>
          </div>
        </div></div>
        <div style="padding:20px; font-size:13px; color:var(--ink-2); line-height:1.5;">
          Couldn't open this task's details — it may reference a removed company or person.
        </div>`;
      const closeBtn = this.pane.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.addEventListener('click', () => this.controller.closeDetail());
    }
  }

  bindHandlers(t) {
    this.pane.querySelector('[data-action="close"]').addEventListener('click', () => this.controller.closeDetail());

    const editBtn = this.pane.querySelector('[data-action="edit-task"]');
    if (editBtn) editBtn.addEventListener('click', () => {
      this.editingId = t.id;
      this.editDraft = this._draftFromTask(t);
      this.renderEditMode(t, { focusTitle: true });
    });

    const timerBtn = this.pane.querySelector('[data-action="toggle-timer"]');
    if (timerBtn) timerBtn.addEventListener('click', () => this.controller.toggleTimerForTask(t.id));

    // View mode is read-only — all field editing lives behind the Edit button.
    const deleteBtn = this.pane.querySelector('[data-action="delete-task"]');
    if (deleteBtn) deleteBtn.addEventListener('click', () => this.controller.deleteTask(t.id));
  }

  _formatDue(due) {
    if (!due) return '—';
    const d = new Date(due + 'T00:00:00');
    if (isNaN(d.getTime())) return due;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* Snapshot the task's editable fields into a mutable draft. The Edit form
     reads and writes only this draft; nothing reaches the model until Save, so
     Cancel discards the draft and the task is untouched. */
  _draftFromTask(t) {
    return {
      title: t.title || '',
      description: t.description || '',
      company: t.company,
      type: t.type || 'admin',
      bidStatus: t.bidStatus || 'queue',
      status: t.status || 'todo',
      assignee: t.assignee,
      due: t.due || '',
      dueTime: t.dueTime || '',
      reminderAt: t.reminderAt || '',
      priority: t.priority || 'medium',
      watchers: (t.watchers || []).slice(),
      subtasks: (t.subtasks || []).map(s => ({ t: s.t, d: !!s.d })),
    };
  }

  /* Pull the current scalar input values back into the draft. Called before any
     re-render (type toggle, watcher/subtask change) so unsaved text/selections
     survive, and before Save. The watcher/subtask lists already live on the
     draft and are mutated directly by their handlers. */
  _syncDraftFromDom() {
    const d = this.editDraft;
    if (!d) return;
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const set = (key, id) => { const v = val(id); if (v !== undefined) d[key] = v; };
    set('title', 'edit-title');
    set('description', 'edit-desc');
    set('company', 'edit-company');
    set('type', 'edit-type');
    set('bidStatus', 'edit-bidStatus');
    set('status', 'edit-status');
    set('assignee', 'edit-assignee');
    set('due', 'edit-due');
    set('dueTime', 'edit-dueTime');
    set('reminderAt', 'edit-reminderAt');
    set('priority', 'edit-priority');
  }

  _formatReminder(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return s || '—';
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* Staged Edit form for every editable field. Renders entirely from this.editDraft
     (initialised on entering edit mode), so it can re-render on a type toggle or a
     watcher/subtask change without losing other unsaved input. Save commits the
     draft via the controller; Cancel throws it away. */
  renderEditMode(t, { focusTitle = false } = {}) {
    const d = this.editDraft;
    const company = App.COMPANIES[d.company] || { pill: '', label: d.company || '—' };
    const opts = (entries, selected) => entries
      .map(([k, label]) => `<option value="${App.utils.escapeHtml(k)}" ${k === selected ? 'selected' : ''}>${App.utils.escapeHtml(label)}</option>`)
      .join('');

    const watcherChips = d.watchers.map(w => {
      const p = App.PEOPLE[w] || App.utils.unknownPerson(w);
      return `<span class="watcher-chip-detail" data-watcher-id="${App.utils.escapeHtml(w)}">
        ${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)}
        <button class="watcher-remove" data-action="remove-watcher" data-member-id="${App.utils.escapeHtml(w)}" aria-label="Remove ${App.utils.escapeHtml(p.name)}" type="button">×</button>
      </span>`;
    }).join('');
    const addable = App.utils.activePeople().filter(p => p.id !== d.assignee && !d.watchers.includes(p.id));
    const watcherAdd = addable.length ? `
      <select class="watcher-add-select" data-action="add-watcher">
        <option value="">+ Add watcher…</option>
        ${addable.map(p => `<option value="${App.utils.escapeHtml(p.id)}">${App.utils.escapeHtml(p.full)}</option>`).join('')}
      </select>` : '';

    const subtaskRows = d.subtasks.length ? d.subtasks.map((s, i) =>
      `<div class="edit-subtask-row">
         <div class="subtask ${s.d ? 'done' : ''}" data-action="toggle-subtask" data-idx="${i}" style="cursor:pointer; flex:1;">
           <i class="ti ${s.d ? 'ti-circle-check-filled' : 'ti-circle'}"></i>${App.utils.escapeHtml(s.t)}
         </div>
         <button class="subtask-remove" data-action="remove-subtask" data-idx="${i}" aria-label="Remove subtask" title="Remove" type="button">×</button>
       </div>`
    ).join('') : `<div style="font-size:11.5px; color:var(--ink-3);">No subtasks yet</div>`;

    this.pane.innerHTML = `
      <div class="detail-head">
        <div class="detail-head-top">
          <span class="pill ${company.pill}">${App.utils.escapeHtml(company.label)}</span>
          <div class="detail-head-actions">
            <button class="icon-btn" data-action="cancel-edit" aria-label="Cancel" title="Cancel" type="button"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="detail-title">Edit task</div>
      </div>
      <div class="detail-body">
        <div class="field">
          <label class="field-label" for="edit-title">Title</label>
          <input type="text" id="edit-title" value="${App.utils.escapeHtml(d.title)}" maxlength="200" style="width:100%; font-size:13px; padding:6px 8px;" />
        </div>
        <div class="field" style="margin-top:12px;">
          <label class="field-label" for="edit-desc">Description</label>
          <textarea id="edit-desc" rows="5" maxlength="5000" placeholder="Add a description…" style="width:100%; font-size:12.5px; padding:6px 8px; resize:vertical;">${App.utils.escapeHtml(d.description)}</textarea>
        </div>

        <div class="detail-row" style="margin-top:14px;">
          <span class="label">Company</span>
          <select id="edit-company" style="font-size:12px; padding:4px 8px;">
            ${opts(Object.values(App.COMPANIES).map(c => [c.id, c.label]), d.company)}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Type</span>
          <select id="edit-type" data-action="type-change" style="font-size:12px; padding:4px 8px;">
            ${opts(Object.entries(App.TASK_TYPES).map(([k, v]) => [k, v.label]), d.type)}
          </select>
        </div>
        ${d.type === 'bid' ? `
        <div class="detail-row">
          <span class="label">Bid status</span>
          <select id="edit-bidStatus" style="font-size:12px; padding:4px 8px;">
            ${opts(Object.entries(App.BID_STATUSES).map(([k, v]) => [k, v.label]), d.bidStatus)}
          </select>
        </div>` : ''}
        <div class="detail-row">
          <span class="label">Status</span>
          <select id="edit-status" style="font-size:12px; padding:4px 8px;">
            ${opts(Object.entries(App.STATUSES).map(([k, v]) => [k, v.label]), d.status)}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Assignee</span>
          <select id="edit-assignee" style="font-size:12px; padding:4px 8px;">
            ${App.utils.activePeople(d.assignee).map(p => `<option value="${App.utils.escapeHtml(p.id)}" ${p.id === d.assignee ? 'selected' : ''}>${App.utils.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Due</span>
          <input type="date" id="edit-due" value="${App.utils.escapeHtml(d.due)}" class="picker-input" style="font-size:12px; padding:4px 8px;" />
        </div>
        <div class="detail-row">
          <span class="label">Time <span class="field-optional">Optional</span></span>
          <input type="time" id="edit-dueTime" value="${App.utils.escapeHtml(d.dueTime)}" class="picker-input" style="font-size:12px; padding:4px 8px;" />
        </div>
        <div class="detail-row">
          <span class="label">Reminder <span class="field-optional">Optional</span></span>
          <input type="datetime-local" id="edit-reminderAt" value="${App.utils.escapeHtml(d.reminderAt)}" class="picker-input" style="font-size:12px; padding:4px 8px;" />
        </div>
        <div class="detail-row">
          <span class="label">Priority</span>
          <select id="edit-priority" style="font-size:12px; padding:4px 8px;">
            ${opts(Object.entries(App.PRIORITIES).map(([k, v]) => [k, v.label]), d.priority)}
          </select>
        </div>
        <div class="detail-row">
          <span class="label">Watchers</span>
          <div class="watchers-cell">${watcherChips}${watcherAdd}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Subtasks</div>
          ${subtaskRows}
          <div class="subtask-add-row" style="margin-top:8px;">
            <input type="text" id="edit-subtask-input" maxlength="200" placeholder="Add a step and press Enter" />
            <button class="btn btn-sm" data-action="add-subtask" type="button">Add</button>
          </div>
        </div>

        <div class="modal-actions" style="margin-top:18px; display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn" data-action="cancel-edit" type="button">Cancel</button>
          <button class="btn btn-primary" data-action="save-edit" type="button">Save</button>
        </div>
      </div>
    `;
    this.bindEditHandlers(t, { focusTitle });
  }

  bindEditHandlers(t, { focusTitle = false } = {}) {
    const exitEdit = () => { this.editingId = null; this.editDraft = null; this.render(); };
    const rerender = () => { this._syncDraftFromDom(); this.renderEditMode(t); };

    this.pane.querySelectorAll('[data-action="cancel-edit"]').forEach(el =>
      el.addEventListener('click', exitEdit)
    );

    const save = () => {
      this._syncDraftFromDom();
      const ok = this.controller.updateTaskDetails(t.id, this.editDraft);
      if (ok) exitEdit(); // else stay in edit mode with input preserved
    };
    const saveBtn = this.pane.querySelector('[data-action="save-edit"]');
    if (saveBtn) saveBtn.addEventListener('click', save);

    // Type toggle re-renders so the Bid-status row appears/disappears.
    const typeSel = this.pane.querySelector('[data-action="type-change"]');
    if (typeSel) typeSel.addEventListener('change', rerender);

    // Watchers + subtasks mutate the draft in place, then re-render.
    this.pane.querySelectorAll('[data-action="remove-watcher"]').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._syncDraftFromDom();
        this.editDraft.watchers = this.editDraft.watchers.filter(w => w !== btn.dataset.memberId);
        this.renderEditMode(t);
      })
    );
    const addWatcherSel = this.pane.querySelector('[data-action="add-watcher"]');
    if (addWatcherSel) addWatcherSel.addEventListener('change', () => {
      const id = addWatcherSel.value;
      if (!id) return;
      this._syncDraftFromDom();
      if (!this.editDraft.watchers.includes(id)) this.editDraft.watchers.push(id);
      this.renderEditMode(t);
    });
    this.pane.querySelectorAll('[data-action="toggle-subtask"]').forEach(el =>
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.idx, 10);
        this._syncDraftFromDom();
        if (this.editDraft.subtasks[i]) this.editDraft.subtasks[i].d = !this.editDraft.subtasks[i].d;
        this.renderEditMode(t);
      })
    );
    this.pane.querySelectorAll('[data-action="remove-subtask"]').forEach(el =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(el.dataset.idx, 10);
        this._syncDraftFromDom();
        this.editDraft.subtasks.splice(i, 1);
        this.renderEditMode(t);
      })
    );
    // Add a new subtask to the draft (Add button or Enter in the input). Re-
    // renders and refocuses the input so several can be added in a row.
    const addSubtask = () => {
      const inp = this.pane.querySelector('#edit-subtask-input');
      if (!inp) return;
      const text = inp.value.trim();
      if (!text) return;
      this._syncDraftFromDom();
      this.editDraft.subtasks.push({ t: text.slice(0, 200), d: false });
      this.renderEditMode(t);
      const next = this.pane.querySelector('#edit-subtask-input');
      if (next) next.focus();
    };
    const addSubtaskBtn = this.pane.querySelector('[data-action="add-subtask"]');
    if (addSubtaskBtn) addSubtaskBtn.addEventListener('click', addSubtask);
    const subtaskInput = this.pane.querySelector('#edit-subtask-input');
    if (subtaskInput) subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); addSubtask(); }
    });

    this.pane.querySelectorAll('.picker-input').forEach(input =>
      input.addEventListener('click', () => {
        try { input.showPicker(); } catch (e) { /* unsupported or not user-activated */ }
      })
    );

    // Keydown on the edit body (replaced each render) so listeners can't stack.
    const editBody = this.pane.querySelector('.detail-body');
    if (editBody) editBody.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') exitEdit();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    });

    if (focusTitle) {
      const titleInput = document.getElementById('edit-title');
      if (titleInput) { titleInput.focus(); titleInput.select(); }
    }
  }
};
