window.App = window.App || {};

App.TaskListView = class TaskListView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.wrap = document.getElementById('taskViewWrap');
    this.body = document.getElementById('listBody');
    this.pageEyebrow = document.getElementById('pageEyebrow');
    this.pageTitle = document.getElementById('pageTitle');

    // Task ids whose subtask drawer is expanded in the table. Held here (not on
    // the task) so it survives the frequent full re-renders without persisting.
    this.expandedRows = new Set();

    this.bindStaticButtons();
    this.subscribe();
    this.render();
  }

  bindStaticButtons() {
    document.getElementById('newTaskBtn').addEventListener('click', () => this.controller.openNewTaskModal());
    document.getElementById('filterBtn').addEventListener('click', () => this.controller.toggleFilters());
    const selectBtn = document.getElementById('selectBtn');
    if (selectBtn) {
      selectBtn.addEventListener('click', () => this.controller.toggleBulkMode());
      App.EventBus.on('bulk:changed', () => selectBtn.classList.toggle('active', !!this.controller.uiState.bulkMode));
    }
    document.querySelectorAll('#layoutSwitcher [data-layout]').forEach(btn => {
      btn.addEventListener('click', () => this.controller.setLayout(btn.dataset.layout));
    });
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('time:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('selection:changed', () => { if (this.visible()) this._syncSelectionHighlight(); });
    App.EventBus.on('search:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('layout:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('calendar:changed', () => { if (this.visible() && this.controller.uiState.layout === 'calendar') this.renderList(); });
    App.EventBus.on('view:changed', (view) => {
      this.applyHeader(view);
      if (this.visible()) this.render();
    });
    App.EventBus.on('company:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('role:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('filters:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('sort:changed',    () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('group:changed',   () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('group:collapsed-changed', () => { if (this.visible()) this.renderList(); });
  }

  visible() {
    return !this.wrap.classList.contains('hidden');
  }

  applyHeader(view) {
    const titles = {
      'all':       { eyebrow: 'This week',          title: 'All tasks' },
      'mine':      { eyebrow: 'Assigned to you',    title: 'My tasks' },
      'hot':       { eyebrow: 'Critical + Urgent',  title: 'Urgent tasks' },
      'today':     { eyebrow: 'Today',              title: 'Due today' },
      'overdue':   { eyebrow: 'Past due',           title: 'Overdue' },
      'watching':  { eyebrow: 'Tasks you\'re watching', title: 'Watching' },
      'time:mine':      { eyebrow: 'Time tracking', title: 'My time' },
      'time:resource':  { eyebrow: 'Time tracking', title: 'Team workload' },
      'approvals':      { eyebrow: 'Admin', title: 'Approvals' },
      'admin:clock':    { eyebrow: 'Admin', title: 'Clock dashboard' },
      'team:hierarchy': { eyebrow: 'Org', title: 'Team hierarchy' },
    };
    let t = titles[view];
    if (!t && view.startsWith('company:')) {
      const c = App.COMPANIES[view.split(':')[1]];
      t = { eyebrow: 'Company', title: c.label };
    }
    if (!t && view.startsWith('person:')) {
      const p = App.PEOPLE[view.split(':')[1]];
      t = { eyebrow: 'Assigned to', title: p.name };
    }
    if (t) {
      this.pageEyebrow.textContent = t.eyebrow;
      this.pageTitle.textContent = t.title;
    }
  }

  render() {
    if (!App.can('tasks.view')) return;
    this.renderStats();
    this.syncLayoutSwitcher();
    this.renderList();
  }

  syncLayoutSwitcher() {
    const active = this.controller.uiState.layout;
    document.querySelectorAll('#layoutSwitcher [data-layout]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === active);
    });
    const header = document.querySelector('#taskViewWrap .list-header');
    if (header) header.classList.toggle('hidden', active !== 'table');
  }

  renderStats() {
    const tasks = this.taskModel.all();
    const today = App.utils.todayISO(0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-open', tasks.filter(t => t.status !== 'done').length);
    set('stat-today', tasks.filter(t => t.due === today && t.status !== 'done').length);
    set('stat-review', tasks.filter(t => t.status === 'review').length);
    set('stat-done', tasks.filter(t => t.status === 'done').length);
  }

  // The filtered task set, shared with the calendar + CSV export so all three
  // always agree on what's visible. (Supervisor scoping etc. lives in the
  // controller method.)
  getFilteredTasks() {
    return this.controller.getVisibleTasks();
  }

  renderList() {
    // Preserve the scroll position across full rebuilds so a background poll
    // merge or a timer toggle doesn't jump the user back to the top.
    const pane = this.body.closest('.list-pane');
    const scrollTop = pane ? pane.scrollTop : 0;
    const out = this._renderListInner();
    if (pane && scrollTop) pane.scrollTop = scrollTop;
    return out;
  }

  _renderListInner() {
    // Reflect bulk-select mode on <body> so CSS can reveal the row checkboxes.
    document.body.classList.toggle('is-bulk', !!this.controller.uiState.bulkMode);
    // The Watching view becomes a team-supervision dashboard rather than a
    // task table: it lists direct reports with their overdue/stale flags and
    // a Ping action.
    if (this.controller.uiState.view === 'watching') return this.renderWatchingTeam();
    const layout = this.controller.uiState.layout;
    if (layout === 'kanban') return this.renderKanban();
    if (layout === 'calendar') return this.renderCalendar();
    return this.renderTable();
  }

  /* Selecting a task only changes which row is highlighted — toggle the class
     in place instead of rebuilding the whole list (which lost scroll position
     and thrashed the DOM on every click). The detail pane is opened separately
     by TaskDetailView's own selection:changed handler. */
  _syncSelectionHighlight() {
    const id = this.controller.uiState.selectedTaskId;
    this.body.querySelectorAll('[data-id].selected').forEach(el => el.classList.remove('selected'));
    if (id != null) {
      const safe = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
      const el = this.body.querySelector(`[data-id="${safe}"]`);
      if (el) el.classList.add('selected');
    }
    // Repaint bulk-selection state in place (toggleBulkSelect emits
    // selection:changed rather than re-rendering the whole list).
    const sel = this.controller.uiState.bulkSelected;
    this.body.querySelectorAll('[data-id]').forEach(el => {
      const on = sel.has(el.dataset.id);
      el.classList.toggle('bulk-selected', on);
      const cb = el.querySelector('.bulk-check');
      if (cb) cb.setAttribute('aria-pressed', String(on));
    });
  }

  renderWatchingTeam() {
    this.body.className = 'team-grid';
    this.body.innerHTML = '';

    const header = document.querySelector('#taskViewWrap .list-header');
    if (header) header.classList.add('hidden');

    const me = this.currentUser;
    const profiles = App.PROFILES || [];
    const reports = profiles.filter(p => p.supervisor_id === me && p.approved !== false);

    if (reports.length === 0) {
      this.body.innerHTML = `<div class="empty">
        <i class="ti ti-users"></i>
        <div class="empty-title">No direct reports</div>
        <div class="empty-sub">When team members are assigned to you in the org chart, they'll appear here so you can keep an eye on their workload.</div>
      </div>`;
      return;
    }

    const today = App.utils.todayISO(0);
    const threeDaysAgo = App.utils.todayISO(-3);
    const roleLabels = (App.ROLES || {});

    reports.forEach(p => {
      const memberId = p.member_id;
      const person = App.PEOPLE[memberId] || { name: p.full_name || memberId, full: p.full_name || memberId, color: '#888' };
      const tasks = this.taskModel.all().filter(t => t.assignee === memberId);
      const open = tasks.filter(t => t.status !== 'done');
      const overdue = open.filter(t => t.due && t.due < today);
      const dueToday = open.filter(t => t.due === today);
      const completedRecent = tasks.filter(t => t._completedAt && t._completedAt >= threeDaysAgo);

      const flagOverdue = overdue.length > 0;
      const flagStale = open.length > 0 && completedRecent.length === 0;
      const flagged = flagOverdue || flagStale;
      const initials = App.utils.initials(person.full || person.name || memberId);
      const role = (roleLabels[p.role] && roleLabels[p.role].label) || p.role || 'Member';

      const card = document.createElement('div');
      card.className = 'team-card' + (flagged ? ' is-flagged' : ' is-ok');
      card.dataset.member = memberId;
      card.innerHTML = `
        <div class="team-card-head">
          <div class="team-avatar" style="background:${person.color};">${App.utils.escapeHtml(initials)}</div>
          <div class="team-info">
            <div class="team-name">${App.utils.escapeHtml(person.full || person.name || memberId)}</div>
            <div class="team-role">${App.utils.escapeHtml(role)}</div>
          </div>
          <span class="team-status">
            <i class="ti ${flagged ? 'ti-alert-circle' : 'ti-circle-check'}"></i>
            ${flagged ? 'Needs attention' : 'On track'}
          </span>
        </div>
        <div class="team-stats">
          <div class="team-stat ${overdue.length > 0 ? 'is-warn' : ''}">
            <div class="team-stat-num">${overdue.length}</div>
            <div class="team-stat-label">Overdue</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-num">${dueToday.length}</div>
            <div class="team-stat-label">Today</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-num">${open.length}</div>
            <div class="team-stat-label">Open</div>
          </div>
        </div>
        ${flagStale && !flagOverdue
          ? `<div class="team-note"><i class="ti ti-clock-pause"></i> No task completions in the last 3 days.</div>`
          : ''}
        ${flagOverdue
          ? `<div class="team-note"><i class="ti ti-alert-triangle"></i> ${overdue.length} task${overdue.length > 1 ? 's' : ''} past due.</div>`
          : ''}
        <div class="team-actions">
          <button class="btn btn-sm" data-action="view-tasks" data-member="${memberId}">
            <i class="ti ti-list-details"></i>View tasks
          </button>
          <button class="btn btn-sm btn-primary" data-action="ping" data-member="${memberId}" data-overdue="${overdue.length}" data-stale="${flagStale ? 1 : 0}">
            <i class="ti ti-bell-ringing"></i>Ping
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action]');
        if (!t) return;
        e.stopPropagation();
        const mid = t.dataset.member;
        if (t.dataset.action === 'view-tasks') {
          this.controller.setView('person:' + mid);
        } else if (t.dataset.action === 'ping') {
          this.controller.pingTeamMember(mid, {
            overdue: parseInt(t.dataset.overdue, 10) || 0,
            stale: t.dataset.stale === '1',
          });
        }
      });

      this.body.appendChild(card);
    });
  }

  renderWorkerList() {
    const tasks = this.getFilteredTasks();
    this.body.className = 'worker-task-list';
    this.body.innerHTML = '';

    const header = document.querySelector('#taskViewWrap .list-header');
    if (header) header.classList.add('hidden');

    if (tasks.length === 0) {
      this._renderEmpty({ icon: 'ti-coffee', title: 'Nothing scheduled', sub: 'No tasks are assigned to you right now.' });
      return;
    }

    const groups = this.taskModel.groupByDue(tasks);
    const sections = [
      { key: 'overdue',  label: 'Overdue',   icon: 'ti-alert-triangle',     danger: true  },
      { key: 'today',    label: 'Today',     icon: 'ti-flame' },
      { key: 'tomorrow', label: 'Tomorrow',  icon: 'ti-arrow-narrow-right' },
      { key: 'thisWeek', label: 'This week', icon: 'ti-calendar' },
      { key: 'later',    label: 'Later',     icon: 'ti-clock' },
      { key: 'done',     label: 'Done',      icon: 'ti-circle-check' },
    ];

    sections.forEach(s => {
      if (groups[s.key].length === 0) return;
      const head = document.createElement('div');
      head.className = 'group-head' + (s.danger ? ' danger' : '');
      head.innerHTML = `<i class="ti ${s.icon}"></i>${s.label} <span class="group-count">· ${groups[s.key].length}</span>`;
      this.body.appendChild(head);
      groups[s.key]
        .slice()
        .sort((a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99'))
        .forEach(t => this.body.appendChild(this.renderWorkerRow(t)));
    });
  }

  renderWorkerRow(t) {
    const isDone = t.status === 'done';
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const selected = this.controller.uiState.selectedTaskId === t.id;
    const timeLabel = t.dueTime ? App.utils.formatClockTz(t.dueTime) : 'All day';

    const row = document.createElement('div');
    row.className = 'worker-row' + (selected ? ' selected' : '') + (isDone ? ' done' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <div class="worker-time ${t.dueTime ? '' : 'all-day'}">${App.utils.escapeHtml(timeLabel)}</div>
      <div class="worker-task">
        <div class="worker-task-title">${App.utils.escapeHtml(t.title)}</div>
        ${t.description ? `<div class="worker-task-desc">${App.utils.escapeHtml(t.description)}</div>` : ''}
      </div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Pause — back to General shift' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play'}"></i>
      </button>
    `;

    row.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (target) {
        e.stopPropagation();
        if (target.dataset.action === 'toggle-timer') this.controller.toggleTimerForTask(t.id);
        return;
      }
      if (this.controller.uiState.bulkMode) { this.controller.toggleBulkSelect(t.id); return; }
      this.controller.selectTask(t.id);
    });
    App.utils.makeActivatable(row, null, `Open task: ${t.title}`);
    return row;
  }

  renderTable() {
    const tasks = this.getFilteredTasks();
    this.body.className = '';
    this.body.innerHTML = '';

    if (tasks.length === 0) {
      this._renderEmpty(this._emptyConfig());
      return;
    }

    const { groupBy, sortBy, sortDir, collapsedGroups } = this.controller.uiState;
    const groups = this.taskModel.groupTasks(tasks, { groupBy, sortBy, sortDir });

    groups.forEach(g => {
      const collapsed = collapsedGroups.has(g.key);
      const section = document.createElement('div');
      section.className = 'task-group' + (collapsed ? ' collapsed' : '');
      section.style.setProperty('--group-color', g.color);

      const head = document.createElement('div');
      head.className = 'group-head';
      head.dataset.groupKey = g.key;
      // Show a "Clear" button only on the Done bucket and only for users
      // with task-write permission. Clicking it soft-clears every done task
      // (30-day grace before hard delete) — see AppController.clearDoneTasks.
      const showClearBtn = g.key === 'done' && App.can('tasks.write') && g.items.length > 0;
      head.innerHTML = `
        <button class="group-chevron" aria-label="Toggle group" data-action="toggle-group">
          <i class="ti ti-chevron-down"></i>
        </button>
        <span class="group-pill" style="background:${g.color};">${App.utils.escapeHtml(String(g.label || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="group-title">${App.utils.escapeHtml(g.label)}</span>
        <span class="group-count">${g.items.length}</span>
        ${showClearBtn ? `
          <button class="btn btn-sm group-clear-btn" data-action="clear-done" title="Clear done tasks (deleted in 30 days)">
            <i class="ti ti-eraser"></i>
            <span>Clear</span>
          </button>
        ` : ''}
      `;
      head.querySelector('[data-action="toggle-group"]').addEventListener('click', (e) => {
        e.stopPropagation();
        this.controller.toggleGroupCollapsed(g.key);
      });
      const clearBtn = head.querySelector('[data-action="clear-done"]');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.controller.clearDoneTasks();
        });
      }
      section.appendChild(head);

      if (!collapsed) {
        const body = document.createElement('div');
        body.className = 'group-body';
        g.items.forEach(t => body.appendChild(this.renderRow(t)));
        section.appendChild(body);
      }

      this.body.appendChild(section);
    });
  }

  renderKanban() {
    const tasks = this.getFilteredTasks();
    this.body.className = 'kanban-board';
    this.body.innerHTML = '';

    if (tasks.length === 0) {
      this._renderEmpty(this._emptyConfig());
      return;
    }

    const columns = [
      { key: 'todo',    label: 'Active',  cls: 'col-todo' },
      { key: 'pending', label: 'Pending', cls: 'col-pending' },
      { key: 'hold',    label: 'On hold', cls: 'col-hold' },
      { key: 'review',  label: 'Review',  cls: 'col-review' },
      { key: 'done',    label: 'Done',    cls: 'col-done' },
    ];

    columns.forEach(col => {
      const colTasks = tasks.filter(t => (t.status || 'todo') === col.key);
      const column = document.createElement('div');
      column.className = `kanban-col ${col.cls}`;
      column.innerHTML = `
        <div class="kanban-col-head">
          <span class="kanban-col-title">${col.label}</span>
          <span class="kanban-col-count">${colTasks.length}</span>
        </div>
        <div class="kanban-col-body"></div>
      `;
      const colBody = column.querySelector('.kanban-col-body');
      colTasks.forEach(t => colBody.appendChild(this.renderKanbanCard(t)));
      this.body.appendChild(column);
    });
  }

  renderKanbanCard(t) {
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const company = App.COMPANIES[t.company] || App.COMPANIES.roofing;
    const type = App.TASK_TYPES[t.type] || App.TASK_TYPES.admin;
    const label = t.label && t.label !== 'none' ? App.TASK_LABELS[t.label] : null;
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(t.due);
    const selected = this.controller.uiState.selectedTaskId === t.id;
    const isDone = t.status === 'done';
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subDone = subs.filter(s => s.d).length;

    const card = document.createElement('div');
    card.className = 'kanban-card' + (selected ? ' selected' : '') + (isDone ? ' done' : '');
    card.dataset.id = t.id;
    card.innerHTML = `
      <div class="kanban-card-head">
        <span class="type-text">${type.label}${label ? ` · ${label.label}` : ''}</span>
        <span class="priority-dot ${priority.cls}" title="${priority.label}"></span>
      </div>
      <div class="kanban-card-title">${App.utils.escapeHtml(t.title)}</div>
      <div class="kanban-card-meta">
        <span class="pill ${company.pill}">${App.utils.escapeHtml(company.label)}</span>
        <span class="due-cell ${due.cls}">${due.text}${t.dueTime ? ` · ${App.utils.formatClockTz(t.dueTime)}` : ''}</span>
      </div>
      <div class="kanban-card-foot">
        ${App.utils.avatarHtml(person)}
        <span class="kanban-card-assignee">${App.utils.escapeHtml(person.name)}</span>
        ${subs.length ? `<span class="kanban-subtask-badge" title="${subDone}/${subs.length} subtasks done"><i class="ti ti-checklist"></i>${subDone}/${subs.length}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => this.controller.selectTask(t.id));
    App.utils.makeActivatable(card, null, `Open task: ${t.title}`);
    return card;
  }

  /* ===== Calendar view (month / week) — tasks placed on their due date ===== */
  renderCalendar() {
    const tasks = this.getFilteredTasks();
    this.body.className = 'calendar-view';
    this.body.innerHTML = '';

    const ui = this.controller.uiState;
    const mode = ui.calendarMode === 'week' ? 'week' : 'month';
    const today = App.utils.todayISO(0);
    const anchor = new Date((ui.calendarAnchor || today) + 'T00:00:00');

    // Bucket the filtered tasks by their due date; count the date-less ones.
    const byDate = new Map();
    let noDue = 0;
    tasks.forEach(t => {
      if (!t.due) { noDue++; return; }
      if (!byDate.has(t.due)) byDate.set(t.due, []);
      byDate.get(t.due).push(t);
    });

    // --- Toolbar: nav + Today + period label + Month/Week toggle ---
    const label = mode === 'week'
      ? this._calWeekLabel(anchor)
      : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const toolbar = document.createElement('div');
    toolbar.className = 'cal-toolbar';
    toolbar.innerHTML = `
      <div class="cal-nav">
        <button class="cal-nav-btn" data-cal="prev" aria-label="Previous"><i class="ti ti-chevron-left"></i></button>
        <button class="cal-nav-btn" data-cal="next" aria-label="Next"><i class="ti ti-chevron-right"></i></button>
        <button class="cal-today" data-cal="today">Today</button>
        <span class="cal-label">${App.utils.escapeHtml(label)}</span>
      </div>
      <div class="cal-mode" role="group" aria-label="Calendar range">
        <button class="cal-mode-btn ${mode === 'month' ? 'active' : ''}" data-cal-mode="month" aria-pressed="${mode === 'month'}">Month</button>
        <button class="cal-mode-btn ${mode === 'week' ? 'active' : ''}" data-cal-mode="week" aria-pressed="${mode === 'week'}">Week</button>
      </div>`;
    this.body.appendChild(toolbar);

    // --- Day cells ---
    const days = [];
    if (mode === 'week') {
      const start = new Date(anchor); start.setDate(anchor.getDate() - anchor.getDay());
      for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
    } else {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const start = new Date(first); start.setDate(first.getDate() - first.getDay());
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const cells = Math.ceil((last.getDate() + first.getDay()) / 7) * 7; // 35 or 42
      for (let i = 0; i < cells; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
    }

    const grid = document.createElement('div');
    grid.className = `cal-grid cal-${mode}`;
    grid.innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map(d => `<div class="cal-dow">${d}</div>`).join('');

    const curMonth = anchor.getMonth();
    const maxChips = mode === 'week' ? 10 : 3;
    days.forEach(d => {
      const iso = App.utils.toISODate(d);
      const dayTasks = byDate.get(iso) || [];
      const outside = mode === 'month' && d.getMonth() !== curMonth;
      const cls = [
        'cal-cell',
        outside ? 'outside' : '',
        iso === today ? 'today' : '',
        ui.calendarSelectedDay === iso ? 'selected' : '',
        dayTasks.length ? 'has-tasks' : '',
      ].filter(Boolean).join(' ');
      const chips = dayTasks.slice(0, maxChips).map(t => this._calChip(t)).join('');
      const more = dayTasks.length > maxChips
        ? `<div class="cal-more">+${dayTasks.length - maxChips} more</div>` : '';
      const cell = document.createElement('div');
      cell.className = cls;
      cell.dataset.day = iso;
      cell.innerHTML = `
        <div class="cal-daynum">${d.getDate()}</div>
        <div class="cal-count" aria-hidden="true">${dayTasks.length || ''}</div>
        <div class="cal-chips">${chips}${more}</div>`;
      grid.appendChild(cell);
    });
    this.body.appendChild(grid);

    // --- Selected-day task list (the phone tap-through; harmless on desktop) ---
    if (ui.calendarSelectedDay) {
      const list = byDate.get(ui.calendarSelectedDay) || [];
      const dLabel = new Date(ui.calendarSelectedDay + 'T00:00:00')
        .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      const panel = document.createElement('div');
      panel.className = 'cal-day-panel';
      panel.innerHTML = `<div class="cal-day-panel-head">${App.utils.escapeHtml(dLabel)} · ${list.length} task${list.length === 1 ? '' : 's'}</div>`;
      const pbody = document.createElement('div');
      pbody.className = 'cal-day-panel-body';
      if (list.length) list.forEach(t => pbody.appendChild(this.renderKanbanCard(t)));
      else pbody.innerHTML = `<div class="cal-day-empty">No tasks due this day.</div>`;
      panel.appendChild(pbody);
      this.body.appendChild(panel);
    }

    // --- No-due-date note so those tasks aren't silently hidden ---
    if (noDue) {
      const note = document.createElement('div');
      note.className = 'cal-nodue-note';
      note.innerHTML = `<i class="ti ti-calendar-off"></i> ${noDue} task${noDue === 1 ? '' : 's'} with no due date (not shown here).`;
      this.body.appendChild(note);
    }

    this._bindCalendar();
  }

  _calWeekLabel(anchor) {
    const start = new Date(anchor); start.setDate(anchor.getDate() - anchor.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const sMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const eMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const year = end.getFullYear();
    if (start.getMonth() === end.getMonth()) {
      return `${sMonth} ${start.getDate()} – ${end.getDate()}, ${year}`;
    }
    return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}, ${year}`;
  }

  _calChip(t) {
    const done = t.status === 'done';
    const prio = t.priority || 'medium';
    return `<button type="button" class="cal-chip${done ? ' done' : ''}" data-cal-task="${App.utils.escapeHtml(t.id)}" title="${App.utils.escapeHtml(t.title)}">`
      + `<span class="cal-chip-dot" style="background:var(--u-${App.utils.escapeHtml(prio)});"></span>`
      + `<span class="cal-chip-title">${App.utils.escapeHtml(t.title)}</span></button>`;
  }

  _bindCalendar() {
    const c = this.controller;
    this.body.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.cal;
      if (a === 'prev') c.shiftCalendar(-1);
      else if (a === 'next') c.shiftCalendar(1);
      else if (a === 'today') c.resetCalendarToToday();
    }));
    this.body.querySelectorAll('[data-cal-mode]').forEach(b =>
      b.addEventListener('click', () => c.setCalendarMode(b.dataset.calMode)));
    this.body.querySelectorAll('[data-cal-task]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      c.selectTask(b.dataset.calTask);
    }));
    this.body.querySelectorAll('.cal-cell').forEach(cell => cell.addEventListener('click', (e) => {
      if (e.target.closest('[data-cal-task]')) return; // chip click handled above
      const iso = cell.dataset.day;
      const isPhone = window.matchMedia('(max-width: 720px)').matches;
      // Phone + a day that has tasks → reveal that day's list. Otherwise, jump
      // straight to creating a task on that day (when allowed).
      if (isPhone && cell.classList.contains('has-tasks')) { c.selectCalendarDay(iso); return; }
      if (App.can('tasks.write')) c.openNewTaskModal({ due: iso });
      else c.selectCalendarDay(iso);
    }));
  }

  renderRow(t) {
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const company = App.COMPANIES[t.company] || App.COMPANIES.roofing;
    const type = App.TASK_TYPES[t.type] || App.TASK_TYPES.admin;
    const label = t.label && t.label !== 'none' ? App.TASK_LABELS[t.label] : null;
    const status = App.STATUSES[t.status] || App.STATUSES.todo;
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(t.due);
    const selected = this.controller.uiState.selectedTaskId === t.id;
    const isDone = t.status === 'done';
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;

    // Subtasks: a collapsible drawer hangs under the row. The title cell gets a
    // chevron + "done/total" badge when there are any.
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subCount = subs.length;
    const subDone = subs.filter(s => s.d).length;
    const expanded = this.expandedRows.has(t.id);

    const bulkSel = this.controller.isBulkSelected(t.id);
    const row = document.createElement('div');
    row.className = 'list-row' + (selected ? ' selected' : '') + (bulkSel ? ' bulk-selected' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <button type="button" class="bulk-check" data-action="bulk-toggle" aria-label="Select task" aria-pressed="${bulkSel}"><i class="ti ti-check"></i></button>
      <input type="checkbox" ${isDone ? 'checked' : ''} data-action="toggle-done" ${App.can('tasks.write') ? '' : 'disabled'} />
      <div class="task-title-cell ${isDone ? 'done' : ''}">
        ${subCount ? `<button class="subtask-toggle${expanded ? ' expanded' : ''}" data-action="toggle-subtasks" aria-label="Toggle subtasks" title="${subDone}/${subCount} subtasks done"><i class="ti ti-chevron-right"></i></button>` : ''}
        <span class="tt-text">${App.utils.escapeHtml(t.title)}</span>
        ${subCount ? `<span class="subtask-badge">${subDone}/${subCount}</span>` : ''}
      </div>
      <div class="type-cell">
        <span class="type-text">${type.label}</span>
        ${t.type === 'bid' && App.BID_STATUSES[t.bidStatus] ? `<span class="pill-bid-status ${App.BID_STATUSES[t.bidStatus].cls}">${App.BID_STATUSES[t.bidStatus].label}</span>` : ''}
      </div>
      <div class="label-cell">${label ? `<span class="label-text">${label.label}</span>` : '<span class="label-empty">—</span>'}</div>
      <div class="meta-cell" style="display:flex; align-items:center; gap:6px;">
        ${App.utils.avatarHtml(person)}${App.utils.escapeHtml(person.name)}
      </div>
      <div><span class="priority-block ${priority.cls}" ${App.can('tasks.write') ? 'data-action="cycle-priority" title="Click to change priority"' : ''}>${priority.label}</span></div>
      <div>${App.can('tasks.write')
        ? `<button class="pill-status status-pill-trigger ${status.cls}" data-action="open-status" data-current="${t.status || 'todo'}" title="Change status" aria-haspopup="listbox" aria-expanded="false">
            <span class="status-pill-label">${App.utils.escapeHtml(status.label)}</span>
            <i class="ti ti-chevron-down status-pill-caret"></i>
          </button>`
        : `<span class="pill-status ${status.cls}">${status.label}</span>`}</div>
      <div class="due-cell ${due.cls}">${due.text}${t.dueTime ? `<span class="due-time">${App.utils.formatClockTz(t.dueTime)}</span>` : ''}</div>
      <div class="desc-cell" title="${App.utils.escapeHtml(t.description || '')}">${App.utils.escapeHtml(t.description || '')}</div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Pause — back to General shift' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play'}"></i>
      </button>
      <button class="finish-btn ${isDone ? 'is-done' : ''} ${App.can('tasks.write') ? '' : 'hidden'}" data-action="finish-task" title="${isDone ? 'Mark as not done' : 'Finish this task'}" aria-label="${isDone ? 'Mark as not done' : 'Finish this task'}">
        <i class="ti ${isDone ? 'ti-check' : 'ti-circle-check'}"></i>
      </button>
    `;

    row.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (target) {
        e.stopPropagation();
        const action = target.dataset.action;
        if (action === 'bulk-toggle') this.controller.toggleBulkSelect(t.id);
        else if (action === 'toggle-done') this.controller.toggleTaskDone(t.id);
        else if (action === 'cycle-priority') this.controller.cycleTaskPriority(t.id);
        else if (action === 'toggle-timer') this.controller.toggleTimerForTask(t.id);
        else if (action === 'finish-task') this.controller.completeTask(t.id);
        else if (action === 'toggle-subtasks') this._toggleSubtaskDrawer(t.id, row, target);
        else if (action === 'open-status') this._openStatusMenu(t.id, target);
        return;
      }
      // In bulk mode the whole row toggles selection instead of opening detail.
      if (this.controller.uiState.bulkMode) { this.controller.toggleBulkSelect(t.id); return; }
      this.controller.selectTask(t.id);
    });

    // Priority pill is a click-to-cycle control — make it keyboard-operable.
    const prioBtn = row.querySelector('[data-action="cycle-priority"]');
    if (prioBtn) App.utils.makeActivatable(prioBtn, null, `Priority: ${priority.label}. Activate to change.`);

    // Swipe-to-reveal actions: wrap the row in a horizontal scroll-snap
    // container with Done/Delete buttons that the user swipes left to expose
    // (touch only; the wrapper is inert on desktop). Native scrolling — far
    // more reliable than JS gesture tracking.
    const node = this._wrapSwipe(row, t);

    if (!subCount) return node;

    // Drawer sits as a sibling right after the row inside the group body.
    const drawer = document.createElement('div');
    drawer.className = 'subtask-drawer' + (expanded ? '' : ' hidden');
    drawer.dataset.for = t.id;
    drawer.innerHTML = subs.map((s, i) =>
      `<label class="subtask-line ${s.d ? 'done' : ''}">
        <input type="checkbox" ${s.d ? 'checked' : ''} data-action="toggle-subtask" data-idx="${i}" ${App.can('tasks.write') ? '' : 'disabled'} />
        <span>${App.utils.escapeHtml(s.t)}</span>
      </label>`
    ).join('');
    drawer.addEventListener('click', (e) => {
      const cb = e.target.closest('[data-action="toggle-subtask"]');
      if (!cb) return;
      e.stopPropagation();
      this.controller.toggleSubtask(t.id, parseInt(cb.dataset.idx, 10));
    });

    const frag = document.createDocumentFragment();
    frag.appendChild(node);
    frag.appendChild(drawer);
    return frag;
  }

  // Wrap a task row in a horizontal scroll-snap container with Done / Delete
  // action buttons revealed by swiping left. CSS keeps the wrapper inert
  // (display:contents) on non-touch devices, so desktop is unaffected. Returns
  // the row unchanged when the user can't act on it (nothing to reveal).
  _wrapSwipe(row, t) {
    if (!App.can('tasks.write')) return row;
    const canDelete = this.controller.canDeleteTask(t);
    const isDone = t.status === 'done';
    const wrap = document.createElement('div');
    wrap.className = 'swipe-wrap';
    const actions = document.createElement('div');
    actions.className = 'swipe-actions';
    actions.innerHTML =
      `<button type="button" class="swipe-act swipe-done" data-swipe="done" aria-label="${isDone ? 'Reopen task' : 'Mark done'}">
         <i class="ti ${isDone ? 'ti-rotate' : 'ti-circle-check'}"></i><span>${isDone ? 'Reopen' : 'Done'}</span>
       </button>` +
      (canDelete
        ? `<button type="button" class="swipe-act swipe-del" data-swipe="del" aria-label="Delete task">
             <i class="ti ti-trash"></i><span>Delete</span>
           </button>`
        : '');
    wrap.appendChild(row);
    wrap.appendChild(actions);
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-swipe]');
      if (!b) return;
      e.stopPropagation();
      // Snap the row closed before acting (the delete re-render removes it
      // anyway; the complete keeps it, so reset the scroll position).
      try { wrap.scrollTo({ left: 0, behavior: 'smooth' }); } catch (_) { wrap.scrollLeft = 0; }
      if (b.dataset.swipe === 'done') this.controller.completeTask(t.id);
      else if (b.dataset.swipe === 'del') this.controller.deleteTask(t.id);
    });
    return wrap;
  }

  _toggleSubtaskDrawer(taskId, row, toggleBtn) {
    const willExpand = !this.expandedRows.has(taskId);
    if (willExpand) this.expandedRows.add(taskId);
    else this.expandedRows.delete(taskId);
    const drawer = row.nextElementSibling;
    if (drawer && drawer.classList.contains('subtask-drawer')) {
      drawer.classList.toggle('hidden', !willExpand);
    }
    if (toggleBtn) toggleBtn.classList.toggle('expanded', willExpand);
  }

  // ---- Empty states --------------------------------------------------------
  // Copy is tailored to the active view: a "good" empty (nothing overdue) reads
  // as reassurance with no CTA, while a "blank slate" empty (no tasks at all)
  // offers a New task button when the user can create.
  _emptyConfig() {
    const view = this.controller.uiState.view;
    const byView = {
      all:     { icon: 'ti-clipboard-list', title: 'No tasks yet',          sub: 'Create the first task and it shows up here.',           cta: true },
      mine:    { icon: 'ti-coffee',         title: 'Nothing on your plate', sub: 'No tasks are assigned to you right now.',               cta: true },
      hot:     { icon: 'ti-flame',          title: 'Nothing urgent',        sub: 'No critical or urgent tasks. All calm.' },
      today:   { icon: 'ti-sun',            title: 'Nothing due today',     sub: "You're clear for the day." },
      overdue: { icon: 'ti-circle-check',   title: 'Nothing overdue',       sub: 'Everything is on schedule.' },
    };
    if (byView[view]) return byView[view];
    if (view.startsWith('person:'))  return { icon: 'ti-user',     title: 'No tasks assigned', sub: 'This person has no tasks in the current scope.', cta: true };
    if (view.startsWith('company:')) return { icon: 'ti-building', title: 'No tasks here',     sub: 'No tasks for this company yet.',                cta: true };
    return { icon: 'ti-checks', title: 'Nothing here', sub: 'No tasks match this view.' };
  }

  _renderEmpty({ icon, title, sub, cta }) {
    const showCta = cta && App.can('tasks.write');
    this.body.className = '';
    this.body.innerHTML = `<div class="empty">
      <i class="ti ${icon}"></i>
      <div class="empty-title">${App.utils.escapeHtml(title)}</div>
      <div class="empty-sub">${App.utils.escapeHtml(sub)}</div>
      ${showCta ? `<button class="btn btn-primary empty-cta" type="button" data-action="empty-new-task"><i class="ti ti-plus"></i>New task</button>` : ''}
    </div>`;
    const btn = this.body.querySelector('[data-action="empty-new-task"]');
    if (btn) btn.addEventListener('click', () => this.controller.openNewTaskModal());
  }

  // ---- Inline status menu --------------------------------------------------
  // A single shared popover (one per view, mounted on <body>) replaces the old
  // native <select>. Anchored with position:fixed so it escapes the row's
  // overflow clipping, and fully keyboard-operable (arrows / Enter / Esc).
  _ensureStatusMenu() {
    if (this._statusMenuEl) return this._statusMenuEl;
    const el = document.createElement('div');
    el.className = 'status-menu hidden';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Set status');
    document.body.appendChild(el);
    this._statusMenuEl = el;

    // Dismiss when interaction lands outside the menu/trigger, or on scroll/resize
    // (the popover is fixed and would otherwise float away from its anchor).
    this._statusMenuDismiss = (e) => {
      if (!this._statusMenuEl || this._statusMenuEl.classList.contains('hidden')) return;
      if (this._statusMenuEl.contains(e.target)) return;
      if (this._statusMenuTrigger && this._statusMenuTrigger.contains(e.target)) return;
      this._closeStatusMenu();
    };
    document.addEventListener('pointerdown', this._statusMenuDismiss, true);
    window.addEventListener('resize', () => this._closeStatusMenu());
    window.addEventListener('scroll', () => this._closeStatusMenu(), true);
    return el;
  }

  _openStatusMenu(taskId, trigger) {
    const el = this._ensureStatusMenu();
    // Re-clicking the open trigger toggles it shut.
    if (this._statusMenuTrigger === trigger && !el.classList.contains('hidden')) {
      this._closeStatusMenu();
      return;
    }
    const current = trigger.dataset.current || 'todo';
    el.innerHTML = Object.entries(App.STATUSES).map(([k, v]) =>
      `<button class="status-menu-item" role="option" data-key="${k}" aria-selected="${k === current}">
        <span class="status-dot ${v.cls}"></span>
        <span class="status-menu-label">${App.utils.escapeHtml(v.label)}</span>
        <i class="ti ti-check status-menu-check"></i>
      </button>`
    ).join('');

    this._statusMenuTaskId = taskId;
    this._statusMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');

    el.querySelectorAll('.status-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this._applyStatus(this._statusMenuTaskId, item.dataset.key);
      });
    });

    el.classList.remove('hidden');
    this._positionStatusMenu(trigger);

    this._statusMenuKeydown = (e) => this._onStatusMenuKey(e);
    el.addEventListener('keydown', this._statusMenuKeydown);

    const sel = el.querySelector('[aria-selected="true"]') || el.querySelector('.status-menu-item');
    if (sel) sel.focus();
  }

  _positionStatusMenu(trigger) {
    const el = this._statusMenuEl;
    const r = trigger.getBoundingClientRect();
    el.style.minWidth = Math.max(r.width, 168) + 'px';
    const mh = el.offsetHeight;
    const mw = el.offsetWidth;
    const gap = 6;
    let top = r.bottom + gap;
    let origin = 'top';
    if (top + mh > window.innerHeight - 8) {
      top = r.top - gap - mh;     // flip above when there's no room below
      origin = 'bottom';
    }
    let left = r.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
    el.style.top = Math.max(8, top) + 'px';
    el.style.left = Math.max(8, left) + 'px';
    el.style.setProperty('--menu-origin', origin);
  }

  _onStatusMenuKey(e) {
    const items = [...this._statusMenuEl.querySelectorAll('.status-menu-item')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown')      { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Home')      { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End')       { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (idx >= 0) this._applyStatus(this._statusMenuTaskId, items[idx].dataset.key); }
    else if (e.key === 'Escape')    { e.preventDefault(); this._closeStatusMenu(); }
    else if (e.key === 'Tab')       { this._closeStatusMenu(); }
  }

  _applyStatus(taskId, key) {
    this._closeStatusMenu();
    this.controller.updateTaskField(taskId, 'status', key);
  }

  _closeStatusMenu() {
    const el = this._statusMenuEl;
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    if (this._statusMenuKeydown) { el.removeEventListener('keydown', this._statusMenuKeydown); this._statusMenuKeydown = null; }
    const trigger = this._statusMenuTrigger;
    this._statusMenuTrigger = null;
    this._statusMenuTaskId = null;
    // Return focus to the trigger on keyboard dismiss; skip if the row was
    // re-rendered out from under us (e.g. after a status change).
    if (trigger && document.contains(trigger)) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  }
};
