window.App = window.App || {};

/* AppController — orchestrates everything.
   - Owns UI state (selected task, current view, search query).
   - Receives commands from views, calls model methods.
   - Cross-model coordination (e.g. stopping a timer adds task activity) lives here. */
App.AppController = class AppController {
  constructor({ taskModel, timeModel, notifModel, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.notifModel = notifModel;
    this.currentUser = currentUser;

    this.uiState = {
      view: 'all',
      searchQuery: '',
      selectedTaskId: null,
    };

    // Views are attached after construction by app.js
    this.toastView = null;
    this.newTaskModal = null;
  }

  attachViews({ toastView, newTaskModal }) {
    this.toastView = toastView;
    this.newTaskModal = newTaskModal;
  }

  /* ---------- helpers ---------- */
  getTask(id) { return this.taskModel.find(id); }
  getUserName(userId) { return App.PEOPLE[userId] ? App.PEOPLE[userId].name : userId; }

  /* ---------- UI state ---------- */
  setView(view) {
    if (this.uiState.view === view) return;
    this.uiState.view = view;
    this.uiState.selectedTaskId = null;
    this._togglePanes();
    App.EventBus.emit('view:changed', view);
    App.EventBus.emit('selection:changed');
  }

  setSearchQuery(q) {
    this.uiState.searchQuery = q;
    App.EventBus.emit('search:changed', q);
  }

  selectTask(id) {
    this.uiState.selectedTaskId = (this.uiState.selectedTaskId === id) ? null : id;
    App.EventBus.emit('selection:changed');
  }

  closeDetail() {
    this.uiState.selectedTaskId = null;
    App.EventBus.emit('selection:changed');
  }

  _togglePanes() {
    const isTimeView = this.uiState.view.startsWith('time:');
    document.getElementById('taskViewWrap').classList.toggle('hidden', isTimeView);
    document.getElementById('timeViewWrap').classList.toggle('hidden', !isTimeView);
  }

  /* ---------- task actions ---------- */
  toggleTaskDone(id) {
    this.taskModel.toggleDone(id, this.getUserName(this.currentUser));
  }

  cycleTaskUrgency(id) {
    this.taskModel.cycleUrgency(id, this.getUserName(this.currentUser));
  }

  updateTaskField(id, field, value) {
    this.taskModel.setField(id, field, value, this.getUserName(this.currentUser));
  }

  toggleSubtask(taskId, idx) {
    this.taskModel.toggleSubtask(taskId, idx);
  }

  reassignTask(id, newAssignee) {
    const result = this.taskModel.reassign(id, newAssignee, this.getUserName(this.currentUser));
    if (!result) return;
    if (newAssignee !== this.currentUser) {
      const task = this.taskModel.find(id);
      this.notifModel.add({
        taskId: id,
        meta: 'Reassigned · just now',
        html: `<strong>${this.getUserName(this.currentUser)}</strong> reassigned <em>${App.utils.escapeHtml(task.title)}</em> to <strong>${App.PEOPLE[newAssignee].name}</strong>`,
      });
      this.toastView.show({
        title: `Reassigned to ${App.PEOPLE[newAssignee].name}`,
        sub: `Email sent to ${App.PEOPLE[newAssignee].email}`,
      });
    }
  }

  openNewTaskModal() {
    this.newTaskModal.open();
  }

  createTask(payload) {
    const task = {
      id: App.utils.uid('t'),
      title: payload.title,
      description: payload.description,
      company: payload.company,
      due: payload.due,
      urgency: payload.urgency,
      priority: payload.priority,
      status: payload.status,
      creator: this.currentUser,
      assignee: payload.assignee,
      watchers: payload.watchers || [],
      subtasks: [],
      activity: [{
        who: this.getUserName(this.currentUser),
        what: payload.assignee === this.currentUser
          ? 'created this task'
          : `assigned this to ${App.PEOPLE[payload.assignee].name}`,
        when: 'just now',
      }],
    };
    this.taskModel.add(task);

    const delegated = payload.assignee !== this.currentUser;
    if (delegated && payload.notify.inapp) {
      this.notifModel.add({
        taskId: task.id,
        meta: 'Task assigned · just now',
        html: `<strong>${this.getUserName(this.currentUser)}</strong> assigned <em>${App.utils.escapeHtml(task.title)}</em> to <strong>${App.PEOPLE[payload.assignee].name}</strong>`,
      });
    }
    if (payload.notify.watchers && payload.watchers.length) {
      payload.watchers.forEach(() => {
        this.notifModel.add({
          taskId: task.id,
          meta: 'Watching · just now',
          html: `You're now watching <em>${App.utils.escapeHtml(task.title)}</em> (assigned to ${App.PEOPLE[payload.assignee].name})`,
        });
      });
    }

    if (delegated) {
      this.toastView.show({
        title: `Task assigned to ${App.PEOPLE[payload.assignee].name}`,
        sub: payload.notify.email ? `Email sent to ${App.PEOPLE[payload.assignee].email}` : 'No email sent',
      });
    } else {
      this.toastView.show({
        title: 'Task created',
        sub: payload.watchers.length ? `${payload.watchers.length} watcher${payload.watchers.length > 1 ? 's' : ''} notified` : '',
      });
    }
    if (payload.notify.whatsapp) {
      this.toastView.show({ title: 'WhatsApp queued', sub: 'Ping will fire if marked urgent.' });
    }

    // If we're in a time view, switch back to a task view so the new task is visible
    if (this.uiState.view.startsWith('time:')) {
      this.setView('all');
    }
    this.uiState.selectedTaskId = task.id;
    App.EventBus.emit('selection:changed');
  }

  /* ---------- timer actions ---------- */
  startTimer(userId, taskId) {
    const { priorEntry } = this.timeModel.startTimer(userId, taskId);
    if (priorEntry) {
      this.taskModel.addActivity(priorEntry.taskId, {
        who: this.getUserName(userId),
        what: `clocked ${App.utils.formatHours(priorEntry.durationMs)} on this task`,
        when: 'just now',
      });
    }
    const task = this.taskModel.find(taskId);
    if (task) {
      this.taskModel.addActivity(taskId, {
        who: this.getUserName(userId),
        what: 'clocked in on this task',
        when: 'just now',
      });
    }
    this.toastView.show({
      title: 'Clocked in',
      sub: task ? `Tracking time on "${task.title}"` : 'Timer started',
    });
  }

  stopTimer(userId) {
    const entry = this.timeModel.stopTimer(userId);
    if (!entry) return;
    this.taskModel.addActivity(entry.taskId, {
      who: this.getUserName(userId),
      what: `clocked ${App.utils.formatHours(entry.durationMs)} on this task`,
      when: 'just now',
    });
    this.toastView.show({
      title: 'Clocked out',
      sub: `${App.utils.formatHours(entry.durationMs)} logged`,
    });
  }

  toggleTimerForTask(taskId) {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active && active.taskId === taskId) {
      this.stopTimer(this.currentUser);
    } else {
      this.startTimer(this.currentUser, taskId);
    }
  }

  toggleGlobalClock() {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active) {
      this.stopTimer(this.currentUser);
      return;
    }
    let target = this.uiState.selectedTaskId
      ? this.taskModel.find(this.uiState.selectedTaskId)
      : this.taskModel.all().find(t => t.assignee === this.currentUser && t.status !== 'done');
    if (!target) {
      this.toastView.show({ title: 'No task selected', sub: 'Open a task or assign yourself one to clock in.' });
      return;
    }
    this.startTimer(this.currentUser, target.id);
  }

  /* ---------- notifications ---------- */
  markAllNotifsRead() {
    this.notifModel.markAllRead();
  }

  openNotification(notifId, taskId) {
    this.notifModel.markRead(notifId);
    if (taskId) {
      this.uiState.selectedTaskId = taskId;
      if (this.uiState.view.startsWith('time:')) {
        this.setView('all');
      } else {
        App.EventBus.emit('selection:changed');
      }
    }
  }

  /* ---------- misc ---------- */
  showFiltersHint() {
    this.toastView.show({ title: 'Filters', sub: 'Use the sidebar views, search, or click urgency to cycle.' });
  }

  handleEscape() {
    if (this.uiState.selectedTaskId) {
      this.closeDetail();
    }
  }
};
