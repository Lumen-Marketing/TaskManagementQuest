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

    this.bindStaticButtons();
    this.subscribe();
    this.render();
  }

  bindStaticButtons() {
    document.getElementById('newTaskBtn').addEventListener('click', () => this.controller.openNewTaskModal());
    document.getElementById('filterBtn').addEventListener('click', () => this.controller.showFiltersHint());
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
      'time:analytics': { eyebrow: 'Time tracking', title: 'Reports' },
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
    return this.taskModel.getFiltered({
      view: this.controller.uiState.view,
      searchQuery: this.controller.uiState.searchQuery,
      currentUser: this.currentUser,
    });
  }

  isWorkerRole() {
    return (App.currentProfile && App.currentProfile.role) === 'worker';
  }

  renderList() {
    // Workers get a focused, two-column Time | Task layout regardless of layout switcher.
    if (this.isWorkerRole()) return this.renderWorkerList();
    const layout = this.controller.uiState.layout;
    if (layout === 'kanban') return this.renderKanban();
    if (layout === 'timeline') return this.renderTimeline();
    return this.renderTable();
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
    const timeLabel = t.dueTime ? App.utils.formatClock(t.dueTime) : 'All day';

    const row = document.createElement('div');
    row.className = 'worker-row' + (selected ? ' selected' : '') + (isDone ? ' done' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <div class="worker-time ${t.dueTime ? '' : 'all-day'}">${App.utils.escapeHtml(timeLabel)}</div>
      <div class="worker-task">
        <div class="worker-task-title">${App.utils.escapeHtml(t.title)}</div>
        ${t.description ? `<div class="worker-task-desc">${App.utils.escapeHtml(t.description)}</div>` : ''}
      </div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Stop timer' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-stop-filled' : 'ti-player-play'}"></i>
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

    const groups = this.taskModel.groupByDue(tasks);
    const sections = [
      { key: 'overdue',  label: 'Overdue',   icon: 'ti-alert-triangle',     danger: true  },
      { key: 'today',    label: 'Due today', icon: 'ti-flame' },
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
      groups[s.key].forEach(t => this.body.appendChild(this.renderRow(t)));
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
    const urgency = App.URGENCIES[t.urgency] || App.URGENCIES.medium;
    const due = App.utils.formatDue(t.due);
    const selected = this.controller.uiState.selectedTaskId === t.id;
    const isDone = t.status === 'done';

    const card = document.createElement('div');
    card.className = 'kanban-card' + (selected ? ' selected' : '') + (isDone ? ' done' : '');
    card.dataset.id = t.id;
    card.innerHTML = `
      <div class="kanban-card-head">
        <span class="pill-type ${type.cls}">${type.label}</span>
        <span class="urgency-dot ${urgency.cls}" title="${urgency.label}"></span>
      </div>
      <div class="kanban-card-title">${App.utils.escapeHtml(t.title)}</div>
      <div class="kanban-card-meta">
        <span class="pill ${company.pill}">${company.label}</span>
        <span class="due-cell ${due.cls}">${due.text}${t.dueTime ? ` · ${App.utils.formatClock(t.dueTime)}` : ''}</span>
      </div>
      <div class="kanban-card-foot">
        <span class="avatar-xs" style="background:${person.color};">${App.utils.initials(person.full)}</span>
        <span class="kanban-card-assignee">${App.utils.escapeHtml(person.name)}</span>
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
    const urgency = App.URGENCIES[t.urgency] || App.URGENCIES.medium;
    const due = App.utils.formatDue(t.due);
    const selected = this.controller.uiState.selectedTaskId === t.id;
    const isDone = t.status === 'done';
    const myActive = this.timeModel.activeFor(this.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;

    const row = document.createElement('div');
    row.className = 'list-row' + (selected ? ' selected' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <input type="checkbox" ${isDone ? 'checked' : ''} data-action="toggle-done" ${App.can('tasks.write') ? '' : 'disabled'} />
      <div class="task-title-cell ${isDone ? 'done' : ''}">${App.utils.escapeHtml(t.title)}</div>
      <div class="type-cell">
        <span class="pill-type ${type.cls}">${type.label}</span>
        ${t.type === 'bid' && App.BID_STATUSES[t.bidStatus] ? `<span class="pill-bid-status ${App.BID_STATUSES[t.bidStatus].cls}">${App.BID_STATUSES[t.bidStatus].label}</span>` : ''}
      </div>
      <div><span class="pill ${company.pill}">${company.label}</span></div>
      <div class="meta-cell" style="display:flex; align-items:center; gap:6px;">
        <span class="avatar-xs" style="background:${person.color};">${App.utils.initials(person.full)}</span>${person.name}
      </div>
      <div><span class="urgency-block ${urgency.cls}" ${App.can('tasks.write') ? 'data-action="cycle-urgency" title="Click to change urgency"' : ''}>${urgency.label}</span></div>
      <div class="due-cell ${due.cls}">${due.text}${t.dueTime ? `<span class="due-time">${App.utils.formatClock(t.dueTime)}</span>` : ''}</div>
      <div><span class="pill-status ${status.cls}">${status.label}</span></div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Stop timer' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-stop-filled' : 'ti-player-play'}"></i>
      </button>
      <button class="more-btn" data-action="more" aria-label="More"><i class="ti ti-dots"></i></button>
    `;

    row.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (target) {
        e.stopPropagation();
        const action = target.dataset.action;
        if (action === 'toggle-done') this.controller.toggleTaskDone(t.id);
        else if (action === 'cycle-urgency') this.controller.cycleTaskUrgency(t.id);
        else if (action === 'toggle-timer') this.controller.toggleTimerForTask(t.id);
        return;
      }
      this.controller.selectTask(t.id);
    });

    return row;
  }
};
