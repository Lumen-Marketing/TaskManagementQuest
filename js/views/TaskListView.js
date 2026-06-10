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
    document.querySelectorAll('#layoutSwitcher [data-layout]').forEach(btn => {
      btn.addEventListener('click', () => this.controller.setLayout(btn.dataset.layout));
    });
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('time:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('selection:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('search:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('layout:changed', () => { if (this.visible()) this.render(); });
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

  getFilteredTasks() {
    const role = App.effectiveRole();
    const me = (App.currentProfile && App.currentProfile.member_id) || this.currentUser;
    // Supervisors are scoped to their direct reports (profiles whose
    // supervisor_id points at this supervisor's member_id). When a DEVELOPER
    // previews "as supervisor", they have no real reports, so we leave this
    // null — the supervisor preview then shows the whole selected company's
    // team (company-level supervisor view).
    const reportMemberIds = (role === 'supervisor' && App.realRole() !== 'developer')
      ? new Set((App.PROFILES || [])
          .filter(p => p.supervisor_id === me)
          .map(p => p.member_id))
      : null;
    return this.taskModel.getFiltered({
      view: this.controller.uiState.view,
      searchQuery: this.controller.uiState.searchQuery,
      currentUser: this.currentUser,
      activeFilters: this.controller.uiState.filters,
      currentCompany: this.controller.uiState.currentCompany,
      role,
      reportMemberIds,
    });
  }

  renderList() {
    // The Watching view becomes a team-supervision dashboard rather than a
    // task table: it lists direct reports with their overdue/stale flags and
    // a Ping action.
    if (this.controller.uiState.view === 'watching') return this.renderWatchingTeam();
    const layout = this.controller.uiState.layout;
    if (layout === 'kanban') return this.renderKanban();
    if (layout === 'timeline') return this.renderTimeline();
    return this.renderTable();
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
      this.body.innerHTML = `<div class="empty"><i class="ti ti-checks"></i><div class="empty-title">Nothing scheduled</div><div class="empty-sub">No tasks assigned to you yet.</div></div>`;
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
      this.controller.selectTask(t.id);
    });
    return row;
  }

  renderTable() {
    const tasks = this.getFilteredTasks();
    this.body.className = '';
    this.body.innerHTML = '';

    if (tasks.length === 0) {
      this.body.innerHTML = `<div class="empty"><i class="ti ti-checks"></i><div class="empty-title">Nothing here</div><div class="empty-sub">No tasks match this view.</div></div>`;
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
      this.body.innerHTML = `<div class="empty"><i class="ti ti-checks"></i><div class="empty-title">Nothing here</div><div class="empty-sub">No tasks match this view.</div></div>`;
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
        <span class="pill-type ${type.cls}">${type.label}</span>
        <span class="priority-dot ${priority.cls}" title="${priority.label}"></span>
      </div>
      <div class="kanban-card-title">${App.utils.escapeHtml(t.title)}</div>
      <div class="kanban-card-meta">
        <span class="pill ${company.pill}">${company.label}</span>
        <span class="due-cell ${due.cls}">${due.text}${t.dueTime ? ` · ${App.utils.formatClockTz(t.dueTime)}` : ''}</span>
      </div>
      <div class="kanban-card-foot">
        ${App.utils.avatarHtml(person)}
        <span class="kanban-card-assignee">${App.utils.escapeHtml(person.name)}</span>
        ${subs.length ? `<span class="kanban-subtask-badge" title="${subDone}/${subs.length} subtasks done"><i class="ti ti-checklist"></i>${subDone}/${subs.length}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => this.controller.selectTask(t.id));
    return card;
  }

  renderTimeline() {
    const tasks = this.getFilteredTasks();
    this.body.className = 'timeline-board';
    this.body.innerHTML = '';

    if (tasks.length === 0) {
      this.body.innerHTML = `<div class="empty"><i class="ti ti-checks"></i><div class="empty-title">Nothing here</div><div class="empty-sub">No tasks match this view.</div></div>`;
      return;
    }

    const sorted = tasks.slice().sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const byDate = new Map();
    sorted.forEach(t => {
      const key = t.due || 'no-date';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(t);
    });

    const today = App.utils.todayISO(0);
    [...byDate.entries()].forEach(([date, list]) => {
      const lane = document.createElement('div');
      lane.className = 'timeline-lane';
      const label = this.formatTimelineDate(date, today);
      lane.innerHTML = `
        <div class="timeline-lane-head">
          <span class="timeline-dot ${date < today ? 'past' : (date === today ? 'today' : 'future')}"></span>
          <span class="timeline-lane-date">${label}</span>
          <span class="timeline-lane-count">${list.length} task${list.length === 1 ? '' : 's'}</span>
        </div>
        <div class="timeline-lane-body"></div>
      `;
      const body = lane.querySelector('.timeline-lane-body');
      list.forEach(t => body.appendChild(this.renderKanbanCard(t)));
      this.body.appendChild(lane);
    });
  }

  formatTimelineDate(date, today) {
    if (date === 'no-date') return 'No due date';
    if (date === today) return 'Today';
    const d = new Date(date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return date;
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  }

  renderRow(t) {
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const company = App.COMPANIES[t.company] || App.COMPANIES.roofing;
    const type = App.TASK_TYPES[t.type] || App.TASK_TYPES.admin;
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

    const row = document.createElement('div');
    row.className = 'list-row' + (selected ? ' selected' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <input type="checkbox" ${isDone ? 'checked' : ''} data-action="toggle-done" ${App.can('tasks.write') ? '' : 'disabled'} />
      <div class="task-title-cell ${isDone ? 'done' : ''}">
        ${subCount ? `<button class="subtask-toggle${expanded ? ' expanded' : ''}" data-action="toggle-subtasks" aria-label="Toggle subtasks" title="${subDone}/${subCount} subtasks done"><i class="ti ti-chevron-right"></i></button>` : ''}
        <span class="tt-text">${App.utils.escapeHtml(t.title)}</span>
        ${subCount ? `<span class="subtask-badge">${subDone}/${subCount}</span>` : ''}
      </div>
      <div class="type-cell">
        <span class="pill-type ${type.cls}">${type.label}</span>
        ${t.type === 'bid' && App.BID_STATUSES[t.bidStatus] ? `<span class="pill-bid-status ${App.BID_STATUSES[t.bidStatus].cls}">${App.BID_STATUSES[t.bidStatus].label}</span>` : ''}
      </div>
      <div class="meta-cell" style="display:flex; align-items:center; gap:6px;">
        ${App.utils.avatarHtml(person)}${person.name}
      </div>
      <div><span class="priority-block ${priority.cls}" ${App.can('tasks.write') ? 'data-action="cycle-priority" title="Click to change priority"' : ''}>${priority.label}</span></div>
      <div>${App.can('tasks.write')
        ? `<select class="pill-status status-select ${status.cls}" data-action="set-status" title="Change status" aria-label="Status">
            ${Object.entries(App.STATUSES).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${App.utils.escapeHtml(v.label)}</option>`).join('')}
          </select>`
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
        if (action === 'toggle-done') this.controller.toggleTaskDone(t.id);
        else if (action === 'cycle-priority') this.controller.cycleTaskPriority(t.id);
        else if (action === 'toggle-timer') this.controller.toggleTimerForTask(t.id);
        else if (action === 'finish-task') this.controller.completeTask(t.id);
        else if (action === 'toggle-subtasks') this._toggleSubtaskDrawer(t.id, row, target);
        return;
      }
      this.controller.selectTask(t.id);
    });

    // Inline status change — pick a status straight from the row without
    // opening Edit. Stop the click so opening the dropdown doesn't also select
    // the task; the change is applied via updateTaskField (which notifies
    // watchers and, on "done", drops a running timer back to General shift).
    const statusSelect = row.querySelector('[data-action="set-status"]');
    if (statusSelect) {
      statusSelect.addEventListener('click', (e) => e.stopPropagation());
      statusSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        this.controller.updateTaskField(t.id, 'status', e.target.value);
      });
    }

    if (!subCount) return row;

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
    frag.appendChild(row);
    frag.appendChild(drawer);
    return frag;
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
};
