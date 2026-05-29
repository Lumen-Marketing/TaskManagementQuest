window.App = window.App || {};

/* AppController — orchestrates everything.
   - Owns UI state (selected task, current view, search query).
   - Receives commands from views, calls model methods.
   - Cross-model coordination (e.g. stopping a timer adds task activity) lives here. */
App.AppController = class AppController {
  constructor({ taskModel, timeModel, notifModel, currentUser, dataStore }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.notifModel = notifModel;
    this.currentUser = currentUser;
    this.dataStore = dataStore;

    this.uiState = {
      view: App.can('tasks.view') ? 'all' : 'time:mine',
      searchQuery: '',
      selectedTaskId: null,
      layout: 'table',
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
  can(permission) { return App.can(permission); }
  canView(view) {
    if (view === 'approvals') return App.can('roles.manage');
    if (view === 'admin:clock') return App.can('clock.admin');
    if (view === 'team:hierarchy') return App.can('team.view');
    if (view === 'time:mine') return App.can('time.own') || App.can('clock.use');
    if (view === 'time:resource' || view === 'time:analytics') return App.can('time.team');
    return App.can('tasks.view');
  }

  /* ---------- UI state ---------- */
  setView(view) {
    if (!this.canView(view)) {
      if (this.toastView) this.toastView.show({ title: 'No access', sub: 'Your role cannot open that view.' });
      return;
    }
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

  setLayout(layout) {
    if (!['table', 'timeline', 'kanban'].includes(layout)) return;
    if (this.uiState.layout === layout) return;
    this.uiState.layout = layout;
    App.EventBus.emit('layout:changed', layout);
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
    const v = this.uiState.view;
    const isTimeView = v.startsWith('time:') || v === 'approvals' || v === 'team:hierarchy' || v.startsWith('admin:');
    document.getElementById('taskViewWrap').classList.toggle('hidden', isTimeView);
    document.getElementById('timeViewWrap').classList.toggle('hidden', !isTimeView);
  }

  /* ---------- task actions ---------- */
  toggleTaskDone(id) {
    if (!App.can('tasks.write')) return;
    this.taskModel.toggleDone(id, this.getUserName(this.currentUser));
  }

  cycleTaskUrgency(id) {
    if (!App.can('tasks.write')) return;
    this.taskModel.cycleUrgency(id, this.getUserName(this.currentUser));
  }

  updateTaskField(id, field, value) {
    if (!App.can('tasks.write')) return;
    this.taskModel.setField(id, field, value, this.getUserName(this.currentUser));
  }

  toggleSubtask(taskId, idx) {
    if (!App.can('tasks.write')) return;
    this.taskModel.toggleSubtask(taskId, idx);
  }

  reassignTask(id, newAssignee) {
    if (!App.can('tasks.write')) return;
    const result = this.taskModel.reassign(id, newAssignee, this.getUserName(this.currentUser));
    if (!result) return;
    if (newAssignee !== this.currentUser) {
      const task = this.taskModel.find(id);
      const creatorName = this.getUserName(this.currentUser);
      const person = App.PEOPLE[newAssignee] || { name: newAssignee, email: '' };
      const titleEsc = App.utils.escapeHtml(task.title);
      this._deliver(
        [{
          memberId: newAssignee,
          taskId: id,
          meta: 'Reassigned · just now',
          html: `<strong>${App.utils.escapeHtml(creatorName)}</strong> reassigned <em>${titleEsc}</em> to you`,
        }],
        person.email ? [person.email] : [],
        { subject: `Quest HQ — ${task.title}`, html: this._emailBody(`<strong>${App.utils.escapeHtml(creatorName)}</strong> reassigned <strong>${titleEsc}</strong> to you.`, task) }
      );
      this.toastView.show({
        title: `Reassigned to ${person.name}`,
        sub: person.email ? `Notifying ${person.email}` : 'In-app notification sent',
      });
    }
  }

  /* Deliver notifications (in-app + best-effort email) to recipients other than
     the current user. In-app failures surface a toast; email is best-effort. */
  async _deliver(inappRecipients, emails, emailContent) {
    try {
      if (inappRecipients && inappRecipients.length) {
        await this.dataStore.sendNotifications(inappRecipients);
      }
    } catch (err) {
      if (this.toastView) this.toastView.show({ title: 'Notification delivery failed', sub: (err && err.message) || 'Recipients may not see this until reload.' });
    }
    const unique = Array.from(new Set((emails || []).filter(Boolean)));
    if (unique.length && emailContent) {
      const res = await this.dataStore.sendEmail({ to: unique, subject: emailContent.subject, html: emailContent.html });
      if (res && res.ok === false && !res.skipped) {
        console.warn('[notify] email delivery failed:', res.error);
      }
    }
  }

  _emailBody(intro, task) {
    const when = task.dueTime
      ? `${App.utils.escapeHtml(task.due)} at ${App.utils.escapeHtml(App.utils.formatClock(task.dueTime))}`
      : App.utils.escapeHtml(task.due || 'no due date');
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#23180D;line-height:1.5;">
        <p>${intro}</p>
        <p style="margin:12px 0;padding:12px 14px;background:#FFF9EF;border:1px solid #E2D3BC;border-radius:6px;">
          <strong>${App.utils.escapeHtml(task.title)}</strong><br/>
          Due: ${when}
          ${task.description ? `<br/>${App.utils.escapeHtml(task.description)}` : ''}
        </p>
        <p style="color:#6E5B45;font-size:12px;">Sent from Quest HQ.</p>
      </div>
    `;
  }

  openNewTaskModal() {
    if (!App.can('tasks.write')) {
      this.toastView.show({ title: 'No access', sub: 'Your role cannot create tasks.' });
      return;
    }
    this.newTaskModal.open();
  }

  createTask(payload) {
    if (!App.can('tasks.write')) return;
    const task = {
      id: App.utils.uid('t'),
      title: payload.title,
      description: payload.description,
      type: payload.type || 'admin',
      bidStatus: payload.type === 'bid' ? (payload.bidStatus || 'queue') : null,
      company: payload.company,
      due: payload.due,
      dueTime: payload.dueTime || null,
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
    const creatorName = this.getUserName(this.currentUser);
    const assigneeName = App.PEOPLE[payload.assignee] ? App.PEOPLE[payload.assignee].name : payload.assignee;
    const assigneeEmail = App.PEOPLE[payload.assignee] ? App.PEOPLE[payload.assignee].email : '';
    const titleEsc = App.utils.escapeHtml(task.title);

    const inapp = [];
    const emails = [];

    if (delegated && payload.notify.inapp) {
      inapp.push({
        memberId: payload.assignee,
        taskId: task.id,
        meta: 'Task assigned · just now',
        html: `<strong>${App.utils.escapeHtml(creatorName)}</strong> assigned <em>${titleEsc}</em> to you`,
      });
    }
    if (delegated && payload.notify.email && assigneeEmail) emails.push(assigneeEmail);

    if (payload.notify.watchers) {
      (payload.watchers || []).forEach(w => {
        inapp.push({
          memberId: w,
          taskId: task.id,
          meta: 'Watching · just now',
          html: `You're now watching <em>${titleEsc}</em> (assigned to ${App.utils.escapeHtml(assigneeName)})`,
        });
        if (App.PEOPLE[w] && App.PEOPLE[w].email) emails.push(App.PEOPLE[w].email);
      });
    }

    this._deliver(inapp, emails, {
      subject: `Quest HQ — ${task.title}`,
      html: this._emailBody(`<strong>${App.utils.escapeHtml(creatorName)}</strong> created the task <strong>${titleEsc}</strong> (assigned to ${App.utils.escapeHtml(assigneeName)}).`, task),
    });

    if (delegated) {
      this.toastView.show({
        title: `Task assigned to ${assigneeName}`,
        sub: payload.notify.email && assigneeEmail ? `Notifying ${assigneeEmail}` : 'In-app notification sent',
      });
    } else {
      const watcherCount = (payload.watchers || []).length;
      this.toastView.show({
        title: 'Task created',
        sub: watcherCount ? `${watcherCount} watcher${watcherCount > 1 ? 's' : ''} notified` : '',
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
    if (!App.can('clock.use')) return;
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
    if (!App.can('clock.use')) return;
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
    if (!App.can('clock.use')) return;
    const active = this.timeModel.activeFor(this.currentUser);
    if (active && active.taskId === taskId) {
      this.stopTimer(this.currentUser);
    } else {
      this.startTimer(this.currentUser, taskId);
    }
  }

  toggleGlobalClock() {
    if (!App.can('clock.use')) return;
    const active = this.timeModel.activeFor(this.currentUser);
    if (active) {
      this.stopTimer(this.currentUser);
      return;
    }
    let target = App.can('tasks.view') && this.uiState.selectedTaskId
      ? this.taskModel.find(this.uiState.selectedTaskId)
      : this.taskModel.all().find(t => t.assignee === this.currentUser && t.status !== 'done');
    if (!target) target = this.taskModel.find(App.DEFAULT_CLOCK_TASK_ID);
    if (!target) {
      this.toastView.show({ title: 'Clock task missing', sub: 'Ask an admin to restore the General shift task.' });
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
