window.App = window.App || {};

App.TaskDetailView = class TaskDetailView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.pane = document.getElementById('detailPane');
    this.mainEl = document.getElementById('mainPane');
    // The detail pane is shown as a full-page surface (#taskDetailWrap) rather
    // than a centered popup. We relocate the existing #detailPane node into that
    // wrapper on open so all the render/query code below keeps targeting
    // `this.pane`. _pageOpen guards against repeated mounts on re-render.
    this._pageOpen = false;

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
    App.EventBus.on('comments:changed', () => this.render());
    App.EventBus.on('clock:tick', () => this.tickLive());
  }

  tickLive() {
    const active = this.timeModel.activeFor(this.currentUser);
    const liveEl = this.pane.querySelector('#detail-live-timer');
    if (active && liveEl) {
      liveEl.textContent = App.utils.formatDuration(Date.now() - active.startedAt);
    }
  }

  /* Mount the detail pane into the full-page #taskDetailWrap surface (idempotent
     — called on every re-render). The #detailPane node is moved into the wrapper
     so the rest of this view's innerHTML/querySelector code is unchanged. The
     list pane behind it is hidden so the detail reads as its own page, with the
     topbar + sidebar kept in place (the Home/Reports full-page pattern). */
  _openModal() {
    if (this._pageOpen) return;
    const wrap = document.getElementById('taskDetailWrap');
    if (!wrap) return;
    this._wrap = wrap;

    this.pane.classList.remove('hidden');
    wrap.appendChild(this.pane);
    wrap.classList.remove('hidden');

    // Hide every sibling work-surface behind the detail page. A task can be
    // opened from any view — the list (#listPane) but also the Home / Reports
    // full-page surfaces (their Up next / recents rows call selectTask) — so all
    // of them must be hidden or they'd stack in-flow above the detail. On close,
    // _togglePanes restores whichever one the current view calls for.
    ['listPane', 'homeWrap', 'reportsWrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Esc closes the detail in view mode via the app's global Escape handler
    // (app.js → controller.handleEscape → closeDetail); no local handler needed.
    // Edit mode stops Esc from reaching it so editing exits to the read view.
    this._pageOpen = true;
    this._justOpened = true;
    try { window.scrollTo(0, 0); wrap.scrollTop = 0; } catch (e) { /* noop */ }
  }

  // Placeholder shown on the detail page when a task is selected but its data
  // hasn't loaded yet (rare — the detail normally renders instantly from the
  // in-memory model). Keeps a working "Back to tasks" button.
  _detailSkeletonHtml() {
    const rows = Array.from({ length: 7 }).map(() =>
      `<div class="detail-row"><span class="sk sk-line" style="width:70px;"></span><span class="sk sk-line" style="width:130px;"></span></div>`
    ).join('');
    return `
      <div class="detail-head">
        <button class="detail-back" data-action="close" aria-label="Back to tasks" type="button"><i class="ti ti-arrow-left"></i> Back to tasks</button>
        <div class="detail-head-top">
          <span class="sk sk-pill" style="width:88px;"></span>
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
    if (!this._pageOpen) return;
    // Hide the full-page surface and the detail node (parked inside the hidden
    // wrapper for reuse on the next open).
    if (this._wrap) this._wrap.classList.add('hidden');
    this.pane.classList.add('hidden');
    this._pageOpen = false;
    this._justOpened = false;
    // Restore whichever pane the current view calls for (un-hides #listPane for
    // task views; leaves Home/Reports as-is). Leaves the detail wrapper hidden.
    if (typeof this.controller._togglePanes === 'function') this.controller._togglePanes();
    else { const lp = document.getElementById('listPane'); if (lp) lp.classList.remove('hidden'); }
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

    // Same protection for an open inline (single-field) editor: a background
    // re-render must not wipe the editor before the user hits ✓ / ✗.
    if (this._inlineEdit) {
      if (this._inlineEdit.taskId === selId && !view.startsWith('time:')) return;
      this._inlineEdit = null;
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
             <span class="who">${App.utils.escapeHtml(App.PEOPLE[e.userId] ? App.PEOPLE[e.userId].name : e.userId)}</span> logged
             <strong style="color:var(--ink-2);">${App.utils.formatHours(e.durationMs)}</strong>
             · ${App.utils.timeAgo(e.end)}
           </div>`
        ).join('')
      : `<div style="font-size:11.5px; color:var(--ink-3);">No time logged yet</div>`;

    const statusObj = App.STATUSES[t.status] || { label: t.status || '—', cls: '' };
    const typeObj = App.TASK_TYPES[t.type] || App.TASK_TYPES.admin || { label: t.type || '—' };
    const priObj = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const labelObj = (t.label && t.label !== 'none') ? (App.TASK_LABELS[t.label] || { label: '—' }) : { label: '—' };
    const bidObj = App.BID_STATUSES[t.bidStatus] || { label: t.bidStatus || '—' };
    const isDone = App.taxonomy.isDone(t);
    const today = App.utils.todayISO(0);
    const overdue = !!(t.due && t.due < today && !isDone);
    let daysOverdue = 0;
    if (overdue) {
      const d1 = new Date(t.due + 'T00:00:00'), d2 = new Date(today + 'T00:00:00');
      daysOverdue = Math.max(1, Math.round((d2 - d1) / 86400000));
    }
    const isWatching = watcherIds.includes(this.currentUser);
    const commentsCount = (t.comments || []).length;
    const subtaskCount = (t.subtasks || []).length;
    const canDelete = this.controller.canDeleteTask(t);
    // Project folder chip — a picker trigger for writers, read-only otherwise.
    const proj = t.project && App.projects ? App.projects[t.project] : null;
    const projectChipHtml = App.can('tasks.write')
      ? `<button class="projtag projtag-btn ${proj ? '' : 'projtag-empty'}" data-action="open-project" aria-haspopup="listbox" aria-expanded="false" ${proj ? `style="--pc:${App.utils.escapeHtml(proj.color)}"` : ''}><i class="ti ${proj ? 'ti-folder' : 'ti-folder-plus'}"></i>${proj ? App.utils.escapeHtml(proj.name) : 'Project'}</button>`
      : (proj ? `<span class="projtag" style="--pc:${App.utils.escapeHtml(proj.color)}"><i class="ti ti-folder"></i>${App.utils.escapeHtml(proj.name)}</span>` : '<span class="detail-val">—</span>');
    const watcherChipsHtml = watcherIds.map(w => {
      const p = App.PEOPLE[w];
      return p ? `<span class="watcher-chip-detail">${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)}</span>` : '';
    }).join('');
    // Remember which tab the user is on so a background re-render (a posted
    // comment, a sync poll) doesn't yank them off it. Tabs are
    // Comments / Activity / History; default to Comments.
    if (!this._activeTab) this._activeTab = 'comments';
    const tabActive = (name) => this._activeTab === name ? ' active' : '';

    // Inline per-field editing: Details-card values are click-to-edit for users
    // with write access. `ev(field, baseCls)` returns the class + data attrs that
    // mark a value cell editable; read-only viewers just get the base class.
    const canWrite = App.can('tasks.write');
    const ev = (field, baseCls = 'detail-val') => canWrite
      ? `class="${baseCls} tdp-editable" data-edit-field="${field}" title="Click to edit" tabindex="0" role="button"`
      : `class="${baseCls}"`;

    this.pane.innerHTML = `
      <div class="tdp-head">
        <button class="detail-back" data-action="close" aria-label="Back to tasks" type="button"><i class="ti ti-arrow-left"></i> Tasks</button>
        <div class="tdp-chiprow">
          <button class="tdp-chip tdp-chip-status ${statusObj.cls}" data-action="status-menu" type="button">${App.utils.escapeHtml(statusObj.label)} <i class="ti ti-chevron-down"></i></button>
          ${t.type === 'bid' ? `<span class="tdp-chip">${App.utils.escapeHtml(bidObj.label)}</span>` : ''}
          <span class="tdp-chip">${App.utils.escapeHtml(typeObj.label)}</span>
        </div>
        <div class="tdp-title-row">
          <h1 class="tdp-title">${App.utils.escapeHtml(t.title)}</h1>
          <div class="tdp-head-actions">
            <button class="btn" data-action="focus-comment" type="button"><i class="ti ti-message"></i>Comment</button>
            <button class="btn ${isWatching ? 'is-on' : ''}" data-action="toggle-watch" type="button"><i class="ti ti-eye"></i>${isWatching ? 'Watching' : 'Watch'}</button>
            ${App.can('tasks.write') ? `<button class="btn" data-action="edit-task" type="button"><i class="ti ti-pencil"></i>Edit</button>` : ''}
            <button class="btn icon-btn" data-action="overflow" aria-label="More actions" aria-haspopup="true" type="button"><i class="ti ti-dots"></i></button>
            <div class="tdp-overflow-menu hidden" id="tdpOverflow">
              <button class="tdp-overflow-item" data-action="qa-duplicate" type="button"><i class="ti ti-copy"></i>Duplicate</button>
              ${canDelete ? `<button class="tdp-overflow-item danger" data-action="delete-task" type="button"><i class="ti ti-trash"></i>Delete task</button>` : ''}
            </div>
          </div>
        </div>
        <div class="tdp-meta">
          <span class="tdp-meta-item">${App.utils.avatarHtml(assignee)}${App.utils.escapeHtml(assignee.name)}</span>
          <span class="tdp-meta-item ${overdue ? 'over' : ''}"><i class="ti ti-calendar"></i>Due ${App.utils.escapeHtml(this._formatDue(t.due))}${overdue ? ` · ${daysOverdue}d overdue` : ''}</span>
          <span class="tdp-meta-item"><span class="tdp-pri-dot ${priObj.cls}"></span>${App.utils.escapeHtml(priObj.label)}</span>
        </div>
      </div>

      <div class="tdp-stats">
        <span class="pill ${statusObj.cls}">${App.utils.escapeHtml(statusObj.label)}</span>
        <div class="tdp-stat"><b>${commentsCount}</b><span>Comments</span></div>
        <div class="tdp-stat"><b>${watcherIds.length}</b><span>Watchers</span></div>
        <div class="tdp-stat"><b>${subtaskCount}</b><span>Subtasks</span></div>
        ${overdue ? `<div class="tdp-stat over"><b>${daysOverdue}d</b><span>Overdue</span></div>` : ''}
        <div class="tdp-stats-spacer"></div>
        ${App.can('tasks.write') ? `<button class="btn btn-primary tdp-complete ${isDone ? 'is-done' : ''}" data-action="mark-complete" type="button"><i class="ti ${isDone ? 'ti-rotate-clockwise' : 'ti-circle-check'}"></i>${isDone ? 'Reopen' : 'Mark complete'}</button>` : ''}
      </div>

      <div class="tdp-top">
          ${delegated ? `
            <div class="delegation-banner">
              <i class="ti ti-send"></i>
              <span><strong>${App.utils.escapeHtml(assignee.name)}</strong> assigned by <strong>${App.utils.escapeHtml(creator.name)}</strong></span>
            </div>
          ` : ''}

          ${myTimerOnThis ? `
            <div class="timer-banner">
              <i class="ti ti-player-record-filled"></i>
              <span>Tracking time on this task</span>
              <span class="live-time" id="detail-live-timer">${App.utils.formatDuration(Date.now() - myActive.startedAt)}</span>
            </div>
          ` : ''}

          <div class="detail-actions-row">
            <button class="btn ${myTimerOnThis ? '' : 'btn-primary'}" style="flex:1;" data-action="toggle-timer">
              <i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play-filled'}"></i>
              ${myTimerOnThis ? 'Back to General shift' : 'Clock in on this task'}
            </button>
          </div>
      </div>

      <div class="tdp-body">
        <div class="tdp-col-main">
          <div class="taf-meta taf-meta-detail">
            <div class="taf-field"><span class="taf-field-lbl">Status</span><span ${ev('status')}>${App.utils.escapeHtml(statusObj.label)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Priority</span><span ${ev('priority', `priority-block ${priObj.cls}`)}>${App.utils.escapeHtml(priObj.label)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Assignee</span><span ${ev('assignee', 'detail-val detail-person')}>${App.utils.avatarHtml(assignee)}${App.utils.escapeHtml(assignee.name)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Created by</span><span class="detail-val detail-person">${App.utils.avatarHtml(creator)}${App.utils.escapeHtml(creator.name)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Due</span><span ${ev('due', `detail-val ${overdue ? 'over' : ''}`)}>${App.utils.escapeHtml(this._formatDue(t.due))}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Time</span><span ${ev('dueTime')}>${t.dueTime ? App.utils.escapeHtml(App.utils.formatClockTz(t.dueTime)) : '—'}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Reminder</span><span ${ev('reminderAt')}>${t.reminderAt ? App.utils.escapeHtml(this._formatReminder(t.reminderAt)) : '—'}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Type</span><span ${ev('type')}>${App.utils.escapeHtml(typeObj.label)}</span></div>
            ${t.type === 'bid' ? `<div class="taf-field"><span class="taf-field-lbl">Bid status</span><span ${ev('bidStatus')}>${App.utils.escapeHtml(bidObj.label)}</span></div>` : ''}
            <div class="taf-field"><span class="taf-field-lbl">Label</span><span ${ev('label')}>${App.utils.escapeHtml(labelObj.label)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Company</span><span ${ev('company')}>${App.utils.escapeHtml(company.label)}</span></div>
            <div class="taf-field"><span class="taf-field-lbl">Project</span>${projectChipHtml}</div>
            <div class="taf-field"><span class="taf-field-lbl">Time spent</span><span class="detail-val" style="font-family:'SFMono-Regular',monospace;">${App.utils.formatHours(totalMs)} total</span></div>
          </div>

          <div class="tdp-card">
            <div class="tdp-card-title">Description</div>
            <div class="detail-desc">${App.utils.escapeHtml(t.description || 'No description yet.')}</div>
          </div>

          ${subtaskCount ? `
          <div class="tdp-card">
            <div class="tdp-card-title">Subtasks</div>
            ${subtasksHtml}
          </div>` : ''}
        </div>

        <aside class="tdp-col-right">
          <div class="tdp-card">
            <div class="tdp-card-title">Quick actions</div>
            <div class="tdp-qa-grid">
              <button class="tdp-qa" data-action="qa-reassign" type="button"><i class="ti ti-user-share"></i>Reassign</button>
              <button class="tdp-qa" data-action="qa-subtask" type="button"><i class="ti ti-subtask"></i>Add subtask</button>
              <button class="tdp-qa" data-action="qa-setdue" type="button"><i class="ti ti-calendar"></i>Set due</button>
              <button class="tdp-qa" data-action="qa-note" type="button"><i class="ti ti-note"></i>Add note</button>
              <button class="tdp-qa" data-action="qa-logcall" type="button"><i class="ti ti-phone"></i>Log call</button>
              <button class="tdp-qa" data-action="qa-duplicate" type="button"><i class="ti ti-copy"></i>Duplicate</button>
            </div>
          </div>

          <div class="tdp-card tdp-tabs">
            <div class="tdp-tablist" role="tablist">
              <button class="tdp-tab${tabActive('comments')}" data-tab="comments" type="button"><i class="ti ti-message"></i>Comments</button>
              <button class="tdp-tab${tabActive('activity')}" data-tab="activity" type="button"><i class="ti ti-bolt"></i>Activity</button>
              <button class="tdp-tab${tabActive('history')}" data-tab="history" type="button"><i class="ti ti-history"></i>History</button>
            </div>
            <div class="tdp-tabpanel${tabActive('comments')}" data-panel="comments">${this._commentsInner(t)}</div>
            <div class="tdp-tabpanel${tabActive('activity')}" data-panel="activity"><div class="tdp-activity">${activityHtml}</div></div>
            <div class="tdp-tabpanel${tabActive('history')}" data-panel="history">${entriesHtml}</div>
          </div>

          <div class="tdp-card">
            <div class="tdp-card-title"><i class="ti ti-eye"></i> Watchers</div>
            <div class="watchers-cell tdp-watchers">
              ${watcherChipsHtml || '<span class="tdp-empty">No watchers</span>'}
              <button class="tdp-watch-add" data-action="toggle-watch" title="${isWatching ? 'Stop watching' : 'Watch this task'}" aria-label="Toggle watch" type="button"><i class="ti ${isWatching ? 'ti-eye-off' : 'ti-plus'}"></i></button>
            </div>
          </div>
        </aside>
      </div>
    `;

    this.bindHandlers(t);
    } catch (err) {
      // Never leave the pane blank: show a message with a working Close button.
      if (App.observability) App.observability.captureException(err, { source: 'TaskDetailView.render' });
      console.error('[TaskDetailView] render failed', err);
      this.pane.innerHTML = `
        <div class="detail-head">
          <button class="detail-back" data-action="close" aria-label="Back to tasks" type="button"><i class="ti ti-arrow-left"></i> Back to tasks</button>
        </div>
        <div style="padding:20px; font-size:13px; color:var(--ink-2); line-height:1.5;">
          Couldn't open this task's details — it may reference a removed company or person.
        </div>`;
      const closeBtn = this.pane.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.addEventListener('click', () => this.controller.closeDetail());
    }
  }

  bindHandlers(t) {
    const q = (sel) => this.pane.querySelector(sel);
    const qa = (sel) => this.pane.querySelectorAll(sel);

    q('[data-action="close"]').addEventListener('click', () => this.controller.closeDetail());

    // Enter the staged Edit form, optionally focusing a specific field. The
    // Reassign / Set due / Add subtask quick actions reuse this rather than
    // bespoke popovers — same proven save path, far less surface area.
    const enterEdit = (focusId) => {
      this.editingId = t.id;
      this.editDraft = this._draftFromTask(t);
      this.renderEditMode(t, { focusTitle: focusId === 'edit-title' });
      if (focusId && focusId !== 'edit-title') {
        const el = document.getElementById(focusId);
        if (el) { el.focus(); try { el.showPicker && el.showPicker(); } catch (e) { /* not user-activated */ } }
      }
    };

    const editBtn = q('[data-action="edit-task"]');
    if (editBtn) editBtn.addEventListener('click', () => enterEdit('edit-title'));

    const timerBtn = q('[data-action="toggle-timer"]');
    if (timerBtn) timerBtn.addEventListener('click', () => this.controller.toggleTimerForTask(t.id));

    // Delete lives in the ⋯ overflow menu now (may be absent if not permitted).
    qa('[data-action="delete-task"]').forEach(el => el.addEventListener('click', () => this.controller.deleteTask(t.id)));

    const completeBtn = q('[data-action="mark-complete"]');
    if (completeBtn) completeBtn.addEventListener('click', () => this.controller.completeTask(t.id));

    // Watch toggle — header button AND the watchers-card "+" share one action.
    qa('[data-action="toggle-watch"]').forEach(el => el.addEventListener('click', () => this.controller.toggleSelfWatch(t.id)));

    // Tabs — switch active class locally (no re-render) and remember the choice
    // so the next background re-render restores it (see _activeTab in render).
    const setTab = (name) => {
      this._activeTab = name;
      qa('.tdp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
      qa('.tdp-tabpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    };
    qa('.tdp-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

    const focusComment = () => {
      setTab('comments');
      const input = q('#cmInput');
      if (input) input.focus();
    };

    // Header Comment button + the "Add note" quick action both jump to comments.
    const fc = q('[data-action="focus-comment"]');
    if (fc) fc.addEventListener('click', focusComment);
    const qaNote = q('[data-action="qa-note"]');
    if (qaNote) qaNote.addEventListener('click', focusComment);

    const qaReassign = q('[data-action="qa-reassign"]');
    if (qaReassign) qaReassign.addEventListener('click', () => enterEdit('edit-assignee'));
    const qaSubtask = q('[data-action="qa-subtask"]');
    if (qaSubtask) qaSubtask.addEventListener('click', () => enterEdit('edit-subtask-input'));
    const qaSetdue = q('[data-action="qa-setdue"]');
    if (qaSetdue) qaSetdue.addEventListener('click', () => enterEdit('edit-due'));
    const qaLogcall = q('[data-action="qa-logcall"]');
    if (qaLogcall) qaLogcall.addEventListener('click', () => { this._activeTab = 'comments'; this.controller.addCallLog(t.id); });
    qa('[data-action="qa-duplicate"]').forEach(el => el.addEventListener('click', () => this.controller.duplicateTask(t.id)));

    // Overflow (⋯) menu toggle.
    const overflowBtn = q('[data-action="overflow"]');
    const overflowMenu = q('#tdpOverflow');
    if (overflowBtn && overflowMenu) {
      overflowBtn.addEventListener('click', (e) => { e.stopPropagation(); overflowMenu.classList.toggle('hidden'); });
    }
    // Close the overflow menu on any outside click — bound ONCE for the view's
    // lifetime (the menu node is re-queried each click, since render replaces it).
    if (!this._docClickBound) {
      this._docClickBound = true;
      document.addEventListener('click', (e) => {
        const menu = this.pane && this.pane.querySelector('#tdpOverflow');
        if (!menu || menu.classList.contains('hidden')) return;
        const btn = this.pane.querySelector('[data-action="overflow"]');
        if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
        menu.classList.add('hidden');
      });
    }

    // Status chip → quick status menu.
    const statusBtn = q('[data-action="status-menu"]');
    if (statusBtn) statusBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openStatusMenu(t, statusBtn); });

    const projBtn = q('[data-action="open-project"]');
    if (projBtn) projBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      App.projectPicker.open({
        anchor: projBtn,
        companyId: t.company,
        currentId: t.project || null,
        onSelect: (projectId) => this.controller.updateTaskField(t.id, 'project', projectId),
      });
    });

    // Inline per-field editing: click (or Enter/Space on) a Details value to edit it.
    qa('.tdp-editable').forEach(el => {
      el.addEventListener('click', () => this._openInlineEdit(t, el.dataset.editField));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._openInlineEdit(t, el.dataset.editField); }
      });
    });

    // Comments: lazy-load on first render, then wire the composer.
    if (!t._commentsLoaded) this.controller.loadTaskComments(t.id);
    this._wireComments(t);

    // On first open, move focus into the dialog (not on background re-renders).
    if (this._justOpened) {
      this._justOpened = false;
      const cb = q('[data-action="close"]');
      if (cb) cb.focus();
    }
  }

  /* ---------- inline per-field editing (Details card) ---------- */

  // Swap a single Details value for an inline editor with ✓ (save) / ✗ (cancel).
  // Only one is open at a time — opening another first re-renders to a clean state.
  // While open, render() is suppressed for this task (see the _inlineEdit guard),
  // so a background sync poll can't wipe the editor mid-edit.
  _openInlineEdit(t, field) {
    if (!App.can('tasks.write') || !field) return;
    // Already editing this exact field (e.g. a bubbled click) — leave it be.
    if (this._inlineEdit && this._inlineEdit.taskId === t.id && this._inlineEdit.field === field) return;
    // Close any other open editor by re-rendering to the plain display first.
    if (this._inlineEdit) { this._inlineEdit = null; this.render(); }

    this._inlineEdit = { taskId: t.id, field };
    const cell = this.pane.querySelector(`[data-edit-field="${field}"]`);
    if (!cell) { this._inlineEdit = null; return; }
    cell.classList.add('is-editing');
    cell.innerHTML = `
      <span class="tdp-inline-edit">
        ${this._inlineEditorHtml(t, field)}
        <button class="tdp-ie-save" data-ie="save" title="Save" aria-label="Save" type="button"><i class="ti ti-check"></i></button>
        <button class="tdp-ie-cancel" data-ie="cancel" title="Cancel" aria-label="Cancel" type="button"><i class="ti ti-x"></i></button>
      </span>`;

    const wrap = cell.querySelector('.tdp-inline-edit');
    const input = cell.querySelector('#tdp-ie-input');
    // Keep clicks inside the editor from bubbling to the cell's own click handler
    // (which would otherwise re-open the editor) or the document Escape/close.
    if (wrap) wrap.addEventListener('click', (e) => e.stopPropagation());

    const commit = () => this._commitInlineEdit(t, field, input ? input.value : '');
    const cancel = () => { this._inlineEdit = null; this.render(); };
    const saveBtn = cell.querySelector('[data-ie="save"]');
    const cancelBtn = cell.querySelector('[data-ie="cancel"]');
    if (saveBtn) saveBtn.addEventListener('click', commit);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      });
      input.focus();
      // Open the native date/time picker straight away where supported.
      if (/^(date|time|datetime-local)$/.test(input.type)) {
        try { input.showPicker(); } catch (e) { /* not user-activated / unsupported */ }
      }
    }
  }

  // Build the editor element (id="tdp-ie-input") for a given field.
  _inlineEditorHtml(t, field) {
    const esc = App.utils.escapeHtml;
    const sel = (entries, selected) =>
      `<select id="tdp-ie-input" class="tdp-ie-input">${entries.map(([k, label]) =>
        `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    switch (field) {
      case 'status':    return sel(Object.entries(App.STATUSES).map(([k, v]) => [k, v.label]), t.status);
      case 'priority':  return sel(Object.entries(App.PRIORITIES).map(([k, v]) => [k, v.label]), t.priority);
      case 'type':      return sel(Object.entries(App.TASK_TYPES).map(([k, v]) => [k, v.label]), t.type);
      case 'label':     return sel(Object.entries(App.TASK_LABELS).map(([k, v]) => [k, v.label]), t.label || 'none');
      case 'bidStatus': return sel(Object.entries(App.BID_STATUSES).map(([k, v]) => [k, v.label]), t.bidStatus || 'queue');
      case 'company':   return sel(Object.values(App.COMPANIES).map(c => [c.id, c.label]), t.company);
      case 'assignee':  return sel(App.utils.peopleInCompany(t.company, t.assignee).map(p => [p.id, p.name]), t.assignee);
      case 'due':       return `<input type="date" id="tdp-ie-input" class="tdp-ie-input picker-input" value="${esc(t.due || '')}" />`;
      case 'dueTime':   return `<input type="time" id="tdp-ie-input" class="tdp-ie-input picker-input" value="${esc(t.dueTime || '')}" />`;
      case 'reminderAt':return `<input type="datetime-local" id="tdp-ie-input" class="tdp-ie-input picker-input" value="${esc((t.reminderAt || '').slice(0, 16))}" />`;
      default:          return '';
    }
  }

  // Save the edited value (✓). assignee uses reassignTask (notifies the new
  // assignee); everything else uses updateTaskField. A no-op change just restores
  // the display. Clearing the _inlineEdit guard BEFORE saving lets the resulting
  // tasks:changed re-render the card with the saved value.
  _commitInlineEdit(t, field, rawValue) {
    this._inlineEdit = null;
    if (field === 'assignee') {
      if (rawValue && rawValue !== t.assignee) { this.controller.reassignTask(t.id, rawValue); this._toastSaved(); }
      else this.render();
      return;
    }
    // Optional date/time/reminder clear to null; the rest are constrained selects.
    let value = rawValue;
    if (field === 'due' || field === 'dueTime' || field === 'reminderAt') value = rawValue || null;
    const cur = t[field] == null ? '' : String(t[field]);
    const next = value == null ? '' : String(value);
    if (cur !== next) { this.controller.updateTaskField(t.id, field, value); this._toastSaved(); }
    else this.render();
  }

  _toastSaved() {
    const tv = this.controller && this.controller.toastView;
    if (tv && tv.show) tv.show({ title: 'Saved' });
  }

  // Tiny popover to change a task's status straight from the header chip, without
  // entering full Edit mode. Persists through updateTaskDetails (which notifies
  // watchers of the status change). Re-clicking the chip closes it.
  _openStatusMenu(t, anchor) {
    const existing = this.pane.querySelector('.tdp-status-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'tdp-status-menu';
    menu.innerHTML = Object.entries(App.STATUSES).map(([k, v]) =>
      `<button class="tdp-status-opt ${k === t.status ? 'is-cur' : ''}" data-status="${App.utils.escapeHtml(k)}" type="button">${App.utils.escapeHtml(v.label)}</button>`
    ).join('');
    anchor.parentElement.appendChild(menu);
    menu.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = b.dataset.status;
      menu.remove();
      if (status && status !== t.status) {
        this.controller.updateTaskDetails(t.id, {
          title: t.title, description: t.description, company: t.company,
          type: t.type, label: t.label, bidStatus: t.bidStatus, status,
          assignee: t.assignee, due: t.due, dueTime: t.dueTime, reminderAt: t.reminderAt,
          priority: t.priority, watchers: t.watchers, subtasks: t.subtasks,
        });
      }
    }));
    const close = (e) => {
      if (menu.contains(e.target) || (anchor && anchor.contains(e.target))) return;
      menu.remove();
      document.removeEventListener('click', close);
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  /* ---------- comments ---------- */
  // Inner comments markup (list + composer) for the Activity/Comments/History
  // tab panel. No outer card — the tab panel is the container. `_wireComments`
  // finds #cmInput/#cmSend/#cmMentionMenu within this.pane after render.
  _commentsInner(t) {
    const esc = App.utils.escapeHtml;
    const comments = t.comments || [];
    const rows = comments.length
      ? comments.map(c => this._commentRow(c)).join('')
      : (t._commentsLoaded
          ? `<div class="cm-empty">No comments yet. Start the conversation.</div>`
          : `<div class="cm-empty">Loading comments…</div>`);
    const draft = (this._commentDraft && this._commentDraft[t.id]) || '';
    return `
      <div class="cm-list">${rows}</div>
      <div class="cm-composer">
        <textarea id="cmInput" class="cm-input" rows="2" placeholder="Write an update or @mention…">${esc(draft)}</textarea>
        <div id="cmMentionMenu" class="cm-mention-menu hidden" role="listbox"></div>
        <div class="cm-actions">
          <span class="cm-hint">Type <b>@</b> to mention a teammate</span>
          <button id="cmSend" class="btn btn-primary cm-send" type="button">Comment</button>
        </div>
      </div>`;
  }

  _commentRow(c) {
    const esc = App.utils.escapeHtml;
    const person = App.PEOPLE[c.authorId] || { name: c.authorId || 'Someone', full: c.authorId || 'Someone', color: 'var(--ink-3)' };
    const ago = (c.createdAt && App.utils.timeAgo(c.createdAt)) || '';
    // Escape first, then lightly highlight @mention tokens.
    const body = esc(c.body || '').replace(/@(\w[\w.]*)/g, '<span class="cm-at">@$1</span>');
    return `
      <div class="cm-row">
        <div class="cm-av">${App.utils.avatarHtml(person)}</div>
        <div class="cm-bubble">
          <div class="cm-meta"><span class="cm-who">${esc(person.name)}</span>${ago ? `<span class="cm-ago">· ${esc(ago)}</span>` : ''}</div>
          <div class="cm-text">${body}</div>
        </div>
      </div>`;
  }

  // People who can be @mentioned (id + names), from the known directory.
  _mentionCandidates() {
    return Object.keys(App.PEOPLE || {}).map(id => {
      const p = App.PEOPLE[id] || {};
      const full = p.full || p.name || id;
      return { id, full, first: String(full).trim().split(/\s+/)[0] };
    });
  }

  _wireComments(t) {
    const input = this.pane.querySelector('#cmInput');
    const sendBtn = this.pane.querySelector('#cmSend');
    const menu = this.pane.querySelector('#cmMentionMenu');
    if (!input || !sendBtn || !menu) return;
    this._composerMentions = this._composerMentions || new Set();

    const persistDraft = () => {
      this._commentDraft = this._commentDraft || {};
      this._commentDraft[t.id] = input.value;
    };

    const closeMenu = () => { menu.classList.add('hidden'); menu.innerHTML = ''; };

    const renderMenu = () => {
      const caret = input.selectionStart;
      const upto = input.value.slice(0, caret);
      const m = upto.match(/@(\w*)$/);
      if (!m) { closeMenu(); return; }
      const q = m[1].toLowerCase();
      const matches = this._mentionCandidates()
        .filter(c => c.full.toLowerCase().includes(q))
        .slice(0, 6);
      if (!matches.length) { closeMenu(); return; }
      menu.innerHTML = matches.map(c =>
        `<div class="cm-mention-item" role="option" data-id="${App.utils.escapeHtml(c.id)}" data-first="${App.utils.escapeHtml(c.first)}">${App.utils.escapeHtml(c.full)}</div>`).join('');
      menu.classList.remove('hidden');
      menu.querySelectorAll('.cm-mention-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus in the textarea
          const caret2 = input.selectionStart;
          const before = input.value.slice(0, caret2).replace(/@(\w*)$/, '@' + el.dataset.first + ' ');
          const after = input.value.slice(caret2);
          input.value = before + after;
          const pos = before.length;
          input.setSelectionRange(pos, pos);
          this._composerMentions.add(el.dataset.id);
          persistDraft();
          closeMenu();
          input.focus();
        });
      });
    };

    input.addEventListener('input', () => { persistDraft(); renderMenu(); });
    input.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Enter sends; Escape closes the mention menu.
      if (e.key === 'Escape' && !menu.classList.contains('hidden')) { e.stopPropagation(); closeMenu(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
    input.addEventListener('blur', () => setTimeout(closeMenu, 120));

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      // Only keep mentions whose @first token still appears in the final text.
      const lower = text.toLowerCase();
      const cands = this._mentionCandidates();
      const mentions = Array.from(this._composerMentions).filter(id => {
        const c = cands.find(x => x.id === id);
        return c && lower.includes('@' + c.first.toLowerCase());
      });
      this.controller.addTaskComment(t.id, text, mentions);
      input.value = '';
      this._composerMentions = new Set();
      if (this._commentDraft) delete this._commentDraft[t.id];
      closeMenu();
    };
    sendBtn.addEventListener('click', send);
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
      project: t.project || null,
      type: t.type || 'admin',
      label: t.label || 'roof',
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
    set('label', 'edit-label');
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
    const addable = App.utils.peopleInCompany(d.company, d.assignee).filter(p => p.id !== d.assignee && !d.watchers.includes(p.id));
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
      <div class="detail-body taf-edit">
        <div class="field field-title">
          <input type="text" id="edit-title" class="taf-title-input" value="${App.utils.escapeHtml(d.title)}" maxlength="200" placeholder="Task title" aria-label="Task title" />
        </div>

        <div class="taf-meta">
          <label class="taf-field"><span class="taf-field-lbl">Company</span><select id="edit-company">${opts(Object.values(App.COMPANIES).map(c => [c.id, c.label]), d.company)}</select></label>
          <label class="taf-field"><span class="taf-field-lbl">Type</span><select id="edit-type" data-action="type-change">${opts(Object.entries(App.TASK_TYPES).map(([k, v]) => [k, v.label]), d.type)}</select></label>
          ${d.type === 'bid' ? `<label class="taf-field"><span class="taf-field-lbl">Bid status</span><select id="edit-bidStatus">${opts(Object.entries(App.BID_STATUSES).map(([k, v]) => [k, v.label]), d.bidStatus)}</select></label>` : ''}
          <label class="taf-field"><span class="taf-field-lbl">Status</span><select id="edit-status">${opts(Object.entries(App.STATUSES).map(([k, v]) => [k, v.label]), d.status)}</select></label>
          <label class="taf-field"><span class="taf-field-lbl">Label</span><select id="edit-label">${opts(Object.entries(App.TASK_LABELS).map(([k, v]) => [k, v.label]), d.label)}</select></label>
          <label class="taf-field"><span class="taf-field-lbl">Priority</span><select id="edit-priority">${opts(Object.entries(App.PRIORITIES).map(([k, v]) => [k, v.label]), d.priority)}</select></label>
          <label class="taf-field"><span class="taf-field-lbl">Assignee</span><select id="edit-assignee">${App.utils.peopleInCompany(d.company, d.assignee).map(p => `<option value="${App.utils.escapeHtml(p.id)}" ${p.id === d.assignee ? 'selected' : ''}>${App.utils.escapeHtml(p.name)}</option>`).join('')}</select></label>
          <label class="taf-field"><span class="taf-field-lbl">Due</span><input type="date" id="edit-due" value="${App.utils.escapeHtml(d.due)}" class="picker-input" /></label>
          <label class="taf-field"><span class="taf-field-lbl">Time <span class="field-optional">Optional</span></span><input type="time" id="edit-dueTime" value="${App.utils.escapeHtml(d.dueTime)}" class="picker-input" /></label>
          <label class="taf-field"><span class="taf-field-lbl">Reminder <span class="field-optional">Optional</span></span><input type="datetime-local" id="edit-reminderAt" value="${App.utils.escapeHtml(d.reminderAt)}" class="picker-input" /></label>
          <div class="taf-field"><span class="taf-field-lbl">Project</span>${(() => {
            const p = d.project && App.projects ? App.projects[d.project] : null;
            return `<button type="button" id="edit-project" class="projtag projtag-btn ${p ? '' : 'projtag-empty'}" data-action="edit-open-project" aria-haspopup="listbox" ${p ? `style="--pc:${App.utils.escapeHtml(p.color)}"` : ''}><i class="ti ${p ? 'ti-folder' : 'ti-folder-plus'}"></i>${p ? App.utils.escapeHtml(p.name) : 'No project'}</button>`;
          })()}</div>
        </div>

        <div class="taf-section">
          <div class="taf-section-lbl">Description</div>
          <textarea id="edit-desc" class="taf-desc" rows="5" maxlength="5000" placeholder="Add a description…">${App.utils.escapeHtml(d.description)}</textarea>
        </div>

        <div class="taf-section">
          <div class="taf-section-lbl">Watchers</div>
          <div class="watchers-cell">${watcherChips}${watcherAdd}</div>
        </div>

        <div class="taf-section">
          <div class="taf-section-lbl">Subtasks</div>
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

    // Project picker in edit mode: stage the choice on the draft, then re-render
    // so the button reflects it. Scope to the company currently selected.
    const editProjBtn = this.pane.querySelector('[data-action="edit-open-project"]');
    if (editProjBtn) editProjBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._syncDraftFromDom();
      const companyId = (document.getElementById('edit-company') || {}).value || this.editDraft.company;
      App.projectPicker.open({
        anchor: editProjBtn,
        companyId,
        currentId: this.editDraft.project || null,
        onSelect: (id) => { this.editDraft.project = id; this.renderEditMode(t); },
      });
    });

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
      // Escape exits edit mode back to the read view only. Stop it bubbling to
      // the document-level Escape handler (controller.handleEscape), which would
      // otherwise also closeDetail() and kick the user all the way to the list.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitEdit(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    });

    if (focusTitle) {
      const titleInput = document.getElementById('edit-title');
      if (titleInput) { titleInput.focus(); titleInput.select(); }
    }
  }
};
