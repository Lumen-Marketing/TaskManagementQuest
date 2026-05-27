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
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => { if (this.visible()) this.render(); });
    App.EventBus.on('time:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('selection:changed', () => { if (this.visible()) this.renderList(); });
    App.EventBus.on('search:changed', () => { if (this.visible()) this.renderList(); });
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
      'hot':       { eyebrow: 'Critical + Urgent',  title: 'Hot list' },
      'today':     { eyebrow: 'Today',              title: 'Due today' },
      'overdue':   { eyebrow: 'Past due',           title: 'Overdue' },
      'watching':  { eyebrow: 'Tasks you\'re watching', title: 'Watching' },
      'time:mine':      { eyebrow: 'Time tracking', title: 'My time' },
      'time:resource':  { eyebrow: 'Time tracking', title: 'Resource allocation' },
      'time:analytics': { eyebrow: 'Time tracking', title: 'Project analytics' },
      'approvals':      { eyebrow: 'Admin', title: 'Approvals' },
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
    this.renderList();
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

  renderList() {
    const tasks = this.taskModel.getFiltered({
      view: this.controller.uiState.view,
      searchQuery: this.controller.uiState.searchQuery,
      currentUser: this.currentUser,
    });

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
      <div class="due-cell ${due.cls}">${due.text}</div>
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
