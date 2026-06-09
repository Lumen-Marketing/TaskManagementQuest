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
      filters: { assignees: [], companies: [], statuses: [], priorities: [], types: [], dueRange: 'all' },
      filtersOpen: false,
      sortBy: 'priority',
      sortDir: 'asc',
      groupBy: 'due',
      collapsedGroups: new Set(),
      // Company scoping: the companies this user may access, and the one
      // currently in focus. Populated by initCompanyContext().
      currentCompany: null,
      companies: [],
    };

    // Views are attached after construction by app.js
    this.toastView = null;
    this.newTaskModal = null;
  }

  attachViews({ toastView, newTaskModal, profileView }) {
    this.toastView = toastView;
    this.newTaskModal = newTaskModal;
    this.profileView = profileView;
  }

  openProfile() {
    if (this.profileView) this.profileView.open();
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
    if (view === 'time:analytics') return false; // Reports view retired
    if (view === 'time:resource') return App.can('time.team');
    return App.can('tasks.view');
  }

  /* ---------- company context ---------- */
  // Determine which companies this user can access and pick the active one.
  // Developers bypass scoping entirely (every company). Everyone else is
  // confined to their profiles.company_ids. Mirrors migration 028 RLS.
  initCompanyContext() {
    // Company access follows the real account (a developer keeps all-company
    // access even while previewing another role).
    const role = App.realRole();
    const all = Object.keys(App.COMPANIES || {});
    let companies;
    let fallback;
    if (role === 'developer') {
      // Developers get an "All companies" sentinel ('*') across every company,
      // and default to it. '*' means no company filter (god mode).
      companies = ['*'].concat(all);
      fallback = '*';
    } else {
      const assigned = (App.currentProfile && App.currentProfile.company_ids) || [];
      const mine = all.filter(id => assigned.includes(id));
      // Anyone who spans more than one company also gets an "All companies"
      // option. For them '*' isn't god mode — it just drops the company filter,
      // so they see every company they can access (still RLS-scoped to those).
      // Default to their first real company, not All.
      companies = mine.length > 1 ? ['*'].concat(mine) : mine;
      fallback = mine[0] || null;
    }
    this.uiState.companies = companies;

    let current = null;
    try {
      const stored = localStorage.getItem(this._companyKey());
      if (stored && companies.includes(stored)) current = stored;
    } catch (e) { /* localStorage unavailable */ }
    if (!current) current = fallback;
    this.uiState.currentCompany = current;
  }

  _companyKey() {
    const uid = (App.currentProfile && App.currentProfile.id) || 'anon';
    return `questhq:current-company:${uid}`;
  }

  // Developer-only: preview the app as another role (worker/supervisor/admin),
  // or pass 'developer'/null to return to full god mode. Re-gates every
  // permission-dependent surface and re-renders.
  setViewAs(role) {
    if (App.realRole() !== 'developer') return;
    const next = (!role || role === 'developer') ? null : role;
    if (App.viewAsRole === next) return;
    App.viewAsRole = next;

    // Reflect the effective role on <body> for CSS (column hiding etc.).
    const eff = App.effectiveRole();
    document.body.className = document.body.className.replace(/\brole-\S+/g, '').trim();
    document.body.classList.add('role-' + eff);
    document.body.classList.toggle('viewing-as-role', !!next);

    // The current view may no longer be permitted under the previewed role.
    if (!this.canView(this.uiState.view)) {
      this.uiState.view = App.can('tasks.view') ? 'all' : 'time:mine';
      this._togglePanes();
    }
    if (App.applyRoleChrome) App.applyRoleChrome(this);

    this.uiState.selectedTaskId = null;
    App.EventBus.emit('role:changed', eff);
    App.EventBus.emit('view:changed', this.uiState.view);
    App.EventBus.emit('selection:changed');
  }

  setCompany(id) {
    if (!this.uiState.companies.includes(id)) return;
    if (this.uiState.currentCompany === id) return;
    this.uiState.currentCompany = id;
    try { localStorage.setItem(this._companyKey(), id); } catch (e) { /* ignore */ }
    this.uiState.selectedTaskId = null;
    App.EventBus.emit('company:changed', id);
    // Reuse the existing re-render path so every list/sidebar refreshes.
    App.EventBus.emit('view:changed', this.uiState.view);
    App.EventBus.emit('selection:changed');
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
    this._persistUiState();
    App.EventBus.emit('view:changed', view);
    App.EventBus.emit('selection:changed');
  }

  /* ---------- last-state persistence ----------
     Persist the lightweight "where was I" UI state (current view + layout) so
     that force-closing and reopening the app restores the last screen instead
     of always dropping the user back on the default All-tasks table. Kept tiny
     and versioned so a future shape change is ignored rather than crashing on
     a stale blob written by an older app version (data-integrity-on-update). */
  _uiStateKey() {
    const uid = (App.currentProfile && App.currentProfile.id) || 'anon';
    return `questhq:ui-state:${uid}`;
  }

  _persistUiState() {
    try {
      localStorage.setItem(this._uiStateKey(), JSON.stringify({
        v: 1,
        view: this.uiState.view,
        layout: this.uiState.layout,
      }));
    } catch (e) { /* localStorage unavailable / quota — last-state is best-effort */ }
  }

  // Called once from app.js after all views are wired. Re-checks canView so a
  // view the user could open last session but not now (role change) falls back
  // to the default instead of opening a forbidden screen.
  restoreUiState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this._uiStateKey()) || 'null'); }
    catch (e) { saved = null; }
    if (!saved || saved.v !== 1) return;
    if (['table', 'timeline', 'kanban'].includes(saved.layout)) this.setLayout(saved.layout);
    if (typeof saved.view === 'string' && this.canView(saved.view)) this.setView(saved.view);
  }

  setSearchQuery(q) {
    this.uiState.searchQuery = q;
    App.EventBus.emit('search:changed', q);
  }

  setLayout(layout) {
    if (!['table', 'timeline', 'kanban'].includes(layout)) return;
    if (this.uiState.layout === layout) return;
    this.uiState.layout = layout;
    this._persistUiState();
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
    // Hide the task-table chrome (toolbar buttons + Up next / progress cards)
    // for any non-task surface: Time, Approvals, Hierarchy, Admin, AND the
    // Watching view (which is now a team-supervision dashboard, not a table).
    const hideChrome = isTimeView || v === 'watching';
    document.querySelectorAll('.work-toolbar, .page-head-widgets').forEach(el => {
      el.classList.toggle('hidden', hideChrome);
    });
  }

  /* ---------- task actions ---------- */
  toggleTaskDone(id) {
    if (!App.can('tasks.write')) return;
    const task = this.taskModel.find(id);
    const result = this.taskModel.toggleDone(id, this.getUserName(this.currentUser));
    if (!result || !task) return;
    if (result.becomingDone) {
      this._stopTimerIfOnTask(id);
      this._notifyTaskChange(task, 'marked this complete');
    } else {
      this._notifyTaskChange(task, 'reopened this task');
    }
  }

  /* Same as toggleTaskDone but fires a celebratory toast when the task moves
     from any state → done (not when it's being re-opened). Used by the
     in-row "Finish" button. */
  completeTask(id) {
    if (!App.can('tasks.write')) return;
    const task = this.taskModel.find(id);
    if (!task) return;
    const result = this.taskModel.toggleDone(id, this.getUserName(this.currentUser));
    if (result && result.becomingDone) {
      this._stopTimerIfOnTask(id);
      this._notifyTaskChange(task, 'marked this complete');
      this._celebrateCompletion(task);
    } else if (result) {
      this._notifyTaskChange(task, 'reopened this task');
    }
  }

  // When a task transitions to Done, stop the current user's timer if it's
  // pointed at that task — otherwise it keeps logging time to a completed
  // task. The user can hit Clock In again to resume general-shift tracking.
  _stopTimerIfOnTask(taskId) {
    const active = this.timeModel.activeFor(this.currentUser);
    if (!active || active.taskId !== taskId) return;
    this.stopTimer(this.currentUser);
    if (this.toastView) {
      this.toastView.show({ title: 'Timer stopped', sub: 'Task is done — clock back in if you’re still working.' });
    }
  }

  // Broadcast a status/priority/completion change to everyone connected to
  // the task (creator, assignee, watchers) except the user who made the
  // change. Covers both directions naturally: supervisor edits → worker
  // pinged; worker edits → supervisor/creator pinged. In-app only — these
  // happen often enough that email would be noise.
  _notifyTaskChange(task, summary) {
    if (!task) return;
    const me = this.currentUser;
    const ids = new Set();
    if (task.creator && task.creator !== me) ids.add(task.creator);
    if (task.assignee && task.assignee !== me) ids.add(task.assignee);
    (task.watchers || []).forEach(w => { if (w && w !== me) ids.add(w); });
    if (!ids.size) return;
    const whoEsc = App.utils.escapeHtml(this.getUserName(me));
    const titleEsc = App.utils.escapeHtml(task.title);
    const summaryEsc = App.utils.escapeHtml(summary);
    const inapp = Array.from(ids).map(memberId => ({
      memberId,
      taskId: task.id,
      meta: 'Task update · just now',
      html: `<strong>${whoEsc}</strong> ${summaryEsc} on <em>${titleEsc}</em>`,
    }));
    this._deliver(inapp, [], null);
  }

  _celebrateCompletion(task) {
    if (!this.toastView) return;
    const name = (App.PEOPLE[this.currentUser] && App.PEOPLE[this.currentUser].name) || 'you';
    const cheers = [
      `Congrats, ${name}!`,
      `Nice work, ${name}!`,
      `Boom — ${name} ships!`,
      `Crushed it, ${name}!`,
      `One down, ${name}!`,
    ];
    const title = cheers[Math.floor(Math.random() * cheers.length)];

    // Count "done today" by anyone — gives the toast a motivational counter.
    const today = App.utils.todayISO(0);
    const me = this.currentUser;
    const myDoneToday = this.taskModel.all().filter(t => t.assignee === me && t._completedAt === today).length;
    const tail = myDoneToday > 1 ? `${myDoneToday} finished today` : 'First win of the day';
    this.toastView.show({ title, sub: `${App.utils.escapeHtml(task.title)} · ${tail}`, variant: 'celebrate' });
  }

  cycleTaskPriority(id) {
    if (!App.can('tasks.write')) return;
    const task = this.taskModel.find(id);
    if (!task) return;
    const prev = task.priority;
    this.taskModel.cyclePriority(id, this.getUserName(this.currentUser));
    if (task.priority !== prev) {
      const label = (App.PRIORITIES[task.priority] && App.PRIORITIES[task.priority].label) || task.priority;
      this._notifyTaskChange(task, `set priority to ${label}`);
    }
  }

  /* Add a watcher to a task. Idempotent — if they're already watching,
     this is a no-op rather than a duplicate entry. */
  addWatcher(taskId, memberId) {
    if (!App.can('tasks.write')) return;
    if (!memberId) return;
    const task = this.taskModel.find(taskId);
    if (!task) return;
    const watchers = Array.isArray(task.watchers) ? task.watchers : [];
    if (watchers.includes(memberId)) return;
    this.taskModel.update(taskId, { watchers: [...watchers, memberId] });
    const person = App.PEOPLE[memberId];
    if (person) {
      this.taskModel.addActivity(taskId, {
        who: this.getUserName(this.currentUser),
        what: `added ${person.name} as a watcher`,
        when: 'just now',
      });
    }
  }

  removeWatcher(taskId, memberId) {
    if (!App.can('tasks.write')) return;
    if (!memberId) return;
    const task = this.taskModel.find(taskId);
    if (!task) return;
    const watchers = Array.isArray(task.watchers) ? task.watchers : [];
    if (!watchers.includes(memberId)) return;
    this.taskModel.update(taskId, { watchers: watchers.filter(w => w !== memberId) });
    const person = App.PEOPLE[memberId];
    if (person) {
      this.taskModel.addActivity(taskId, {
        who: this.getUserName(this.currentUser),
        what: `removed ${person.name} as a watcher`,
        when: 'just now',
      });
    }
  }

  /* JS-side mirror of migration 017's RLS — used to gate the destructive
     Delete-task affordance in the UI. Workers are explicitly excluded
     server-side, so showing them a button that would 401 is worse than
     not showing it. */
  canDeleteTasks() {
    return ['admin', 'construction_supervisor', 'developer', 'supervisor', 'sales'].includes(App.effectiveRole());
  }

  /* Per-task delete permission. Managers may delete any in-company task; a worker
     may delete ONLY a task they created (migration 044). Gates the detail view's
     Delete button and the deleteTask action so we never show a button that 403s. */
  canDeleteTask(task) {
    if (this.canDeleteTasks()) return true;
    return App.effectiveRole() === 'worker' && !!task && task.creator === this.currentUser;
  }

  /* Hard-delete a single task after a confirm prompt. Optimistic:
     removes from the in-memory model immediately so the list collapses
     instantly, then fires the network DELETE. If the server rejects
     (RLS blocked, network blip), surfaces a toast and the next page
     load will resurrect the task from the source of truth. */
  deleteTask(id) {
    const task = this.taskModel.find(id);
    if (!task) return;
    if (!this.canDeleteTask(task)) {
      const sub = App.effectiveRole() === 'worker'
        ? 'You can only delete tasks you created.'
        : 'Your role cannot delete tasks.';
      if (this.toastView) this.toastView.show({ title: 'No access', sub });
      return;
    }
    const snippet = task.title && task.title.length > 50 ? task.title.slice(0, 50) + '…' : (task.title || 'this task');

    // Undo-able delete: remove from the UI now but DEFER the irreversible DB
    // delete until the Undo window closes. A deep snapshot lets Undo restore the
    // task fully (watchers/subtasks/activity live on the row; time entries aren't
    // touched because we never actually deleted yet). No confirm dialog — the
    // Undo toast is the safety net.
    const snapshot = JSON.parse(JSON.stringify(task));
    this._stopTimerIfOnTask(id);
    if (this.uiState && this.uiState.selectedTaskId === id) this.closeDetail();
    this.taskModel.remove(id);

    const UNDO_MS = 6000;
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      if (this.dataStore && typeof this.dataStore.deleteTask === 'function') {
        this.dataStore.deleteTask(id).catch(err => {
          console.error('[task] delete failed', err);
          if (this.toastView) {
            this.toastView.show({ title: 'Delete failed', sub: (err && err.message) || 'The task may reappear on refresh.' });
          }
        });
      }
    }, UNDO_MS);

    if (this.toastView) {
      this.toastView.show({
        title: 'Task deleted',
        sub: snippet,
        duration: UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (undone) return;
            undone = true;
            clearTimeout(timer);
            this.taskModel.add(snapshot); // never hit the DB — the row is intact
            if (this.toastView) this.toastView.show({ title: 'Delete undone', sub: snippet });
          },
        },
      });
    }
  }

  /* Soft-clear every done task, after a confirm prompt. Rows stay in
     Supabase for a 30-day grace window (boot-time purge does the real
     delete), so a fat-finger is recoverable by SQL update. */
  clearDoneTasks() {
    if (!App.can('tasks.write')) return;
    const doneCount = this.taskModel.all().filter(t => t.status === 'done' && !t.clearedAt).length;
    if (!doneCount) return;
    const msg = `Clear ${doneCount} done task${doneCount > 1 ? 's' : ''}? They'll be hidden everywhere and permanently deleted in 30 days.`;
    if (!window.confirm(msg)) return;
    const cleared = this.taskModel.clearDoneTasks(this.getUserName(this.currentUser));
    if (cleared && this.toastView) {
      this.toastView.show({
        title: `Cleared ${cleared} task${cleared > 1 ? 's' : ''}`,
        sub: 'They’ll be permanently deleted in 30 days.',
      });
    }
  }

  updateTaskField(id, field, value) {
    if (!App.can('tasks.write')) return;
    const task = this.taskModel.find(id);
    if (!task) return;
    const prev = task[field];
    this.taskModel.setField(id, field, value, this.getUserName(this.currentUser));
    if (field === 'status' && value === 'done' && prev !== 'done') {
      this._stopTimerIfOnTask(id);
    }
    if ((field === 'status' || field === 'priority') && prev !== value) {
      const dict = field === 'status' ? App.STATUSES : App.PRIORITIES;
      const label = (dict && dict[value] && dict[value].label) || value;
      this._notifyTaskChange(task, `changed ${field} to ${label}`);
    }
  }

  /* Batch-save every editable detail field from the task detail pane's Edit
     mode (title, description, company, type, bidStatus, status, assignee, due,
     dueTime, priority, watchers, subtasks). The whole set is staged in the view
     and only reaches here on Save, so Cancel — which never calls this — leaves
     the task untouched; a refresh shows the saved values (taskModel.update marks
     the row dirty for the next sync). Returns true on success; on a validation
     problem it toasts and returns false so the view keeps the user's input. */
  updateTaskDetails(id, fields) {
    if (!App.can('tasks.write')) return false;
    const task = this.taskModel.find(id);
    if (!task) return false;

    let title, description, due, dueTime;
    try {
      title = App.validate.nonEmpty(fields.title, 'Title', { field: 'title', max: App.validate.LIMITS.title });
      description = String(fields.description == null ? '' : fields.description).trim().slice(0, App.validate.LIMITS.description);
      due = App.validate.isoDate(fields.due, { field: 'due', required: true });
      dueTime = fields.dueTime ? App.validate.isoTime(fields.dueTime, { field: 'dueTime' }) : null;
    } catch (err) {
      if (this.toastView) this.toastView.show({ title: 'Couldn’t save', sub: (err && err.message) || 'Check the fields and try again.' });
      return false;
    }

    // The remaining fields come from constrained <select>s / staged lists; fall
    // back to the task's current value when a field wasn't provided.
    const company = fields.company || task.company;
    const type = fields.type || task.type || 'admin';
    const priority = fields.priority || task.priority || 'medium';
    const status = fields.status || task.status || 'todo';
    const assignee = fields.assignee || task.assignee;
    const bidStatus = type === 'bid' ? (fields.bidStatus || task.bidStatus || 'queue') : null;
    const watchers = Array.isArray(fields.watchers) ? [...new Set(fields.watchers)] : (task.watchers || []);
    const subtasks = Array.isArray(fields.subtasks)
      ? fields.subtasks.map(s => ({ t: s.t, d: !!s.d }))
      : (task.subtasks || []);
    // User-set reminder ("YYYY-MM-DDTHH:MM" local, or null to clear). Anything
    // not matching the datetime-local shape is treated as cleared.
    const reminderAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fields.reminderAt || '')
      ? String(fields.reminderAt).slice(0, 16)
      : null;

    const prevStatus = task.status, prevPriority = task.priority, prevAssignee = task.assignee;

    this.taskModel.update(id, {
      title, description, company, type, due, dueTime, reminderAt, priority, status, assignee, watchers, subtasks,
      ...(type === 'bid' ? { bidStatus } : {}),
    });

    // Done has a side effect the inline path also applies: stop a running timer.
    if (status === 'done' && prevStatus !== 'done') this._stopTimerIfOnTask(id);

    // Notify watchers of the meaningful changes (mirrors updateTaskField/reassign).
    if (status !== prevStatus) {
      const label = (App.STATUSES[status] && App.STATUSES[status].label) || status;
      this._notifyTaskChange(task, `changed status to ${label}`);
    }
    if (priority !== prevPriority) {
      const label = (App.PRIORITIES[priority] && App.PRIORITIES[priority].label) || priority;
      this._notifyTaskChange(task, `changed priority to ${label}`);
    }
    if (assignee !== prevAssignee) this._notifyTaskChange(task, 'reassigned this task');

    this.taskModel.addActivity(id, {
      who: this.getUserName(this.currentUser),
      what: 'edited this task',
      when: 'just now',
    });
    if (this.toastView) this.toastView.show({ title: 'Task updated', sub: '' });
    return true;
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
      console.error('[notify] in-app delivery failed', err, 'cause:', err && err.cause);
      if (this.toastView) {
        const friendly = (err && err.message) || 'Recipients may not see this until reload.';
        const cause = err && err.cause && err.cause.message;
        this.toastView.show({
          title: 'Notification delivery failed',
          sub: cause ? `${friendly} — ${cause}` : friendly,
        });
      }
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
      ? `${App.utils.escapeHtml(task.due)} at ${App.utils.escapeHtml(App.utils.formatClockTz(task.dueTime))}`
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

  async createTask(payload) {
    if (!App.can('tasks.write')) {
      if (this.toastView) {
        this.toastView.show({ title: 'No access', sub: 'Your role cannot create tasks.' });
      }
      return;
    }
    const task = {
      id: App.utils.uid('t'),
      title: payload.title,
      description: payload.description,
      type: payload.type || 'admin',
      bidStatus: payload.type === 'bid' ? (payload.bidStatus || 'queue') : null,
      company: payload.company,
      due: payload.due,
      dueTime: payload.dueTime || null,
      priority: payload.priority,
      status: payload.status,
      creator: this.currentUser,
      assignee: payload.assignee,
      watchers: payload.watchers || [],
      subtasks: Array.isArray(payload.subtasks)
        ? payload.subtasks.map(s => ({ t: s.t, d: !!s.d }))
        : [],
      activity: [{
        who: this.getUserName(this.currentUser),
        what: payload.assignee === this.currentUser
          ? 'created this task'
          : `assigned this to ${App.PEOPLE[payload.assignee].name}`,
        at: new Date().toISOString(),
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

    // Persist the new task to Supabase BEFORE delivering its in-app notifications.
    // Each notification row carries task_id (a FK to tasks.id), and — crucially for
    // a worker assigning to a teammate — the ONLY policy that lets a worker insert a
    // notification for someone else is migration 040's creator_can_notify_member,
    // which checks that the referenced task already exists with them as creator. The
    // task's real save is debounced (~350ms), so delivering first hits a not-yet-
    // saved task: the FK trips, sendNotifications retries with task_id nulled, and
    // that strips the worker's only permission → RLS rejects the notification.
    // Saving first (awaitable saveNow, wired in app.js) closes the race. If the save
    // itself fails (e.g. RLS), skip delivery — it would only fail too, and doSave has
    // already surfaced the underlying error.
    const saved = this.saveNow ? await this.saveNow() : true;

    if (saved) {
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
    }

    // The task lives in the local model regardless of the save outcome, so always
    // surface it — a failed save stays dirty and retries on the next change/reconnect.
    if (this.uiState.view.startsWith('time:')) {
      this.setView('all');
    }
    this.uiState.selectedTaskId = task.id;
    App.EventBus.emit('selection:changed');
  }

  /* ---------- timer actions ---------- */
  startTimer(userId, taskId) {
    if (!App.can('clock.use')) return;
    // Snapshot the task label onto the timer so the team boards can still name
    // it if the task row isn't loadable for whoever's viewing (RLS scope).
    const task = this.taskModel.find(taskId);
    const { priorEntry } = this.timeModel.startTimer(userId, taskId, {
      taskTitle: task ? task.title : null,
      taskCompany: task ? task.company : null,
    });
    if (priorEntry) {
      this.taskModel.addActivity(priorEntry.taskId, {
        who: this.getUserName(userId),
        what: `clocked ${App.utils.formatHours(priorEntry.durationMs)} on this task`,
        when: 'just now',
      });
    }
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

  /* ---------- team-watching: ping a direct report ---------- */
  async pingTeamMember(memberId, info = {}) {
    if (!memberId || memberId === this.currentUser) return;
    const person = App.PEOPLE[memberId] || { full: memberId, name: memberId };
    const fromName = (App.PEOPLE[this.currentUser] && App.PEOPLE[this.currentUser].full) || 'Your supervisor';

    const reasons = [];
    if (info.overdue > 0) reasons.push(`${info.overdue} overdue task${info.overdue > 1 ? 's' : ''}`);
    if (info.stale) reasons.push('no recent updates');
    const reason = reasons.length ? reasons.join(' · ') : 'a quick status check';

    const meta = `From ${fromName}`;
    const html = `<strong>Status check requested.</strong><br>${fromName} is asking about ${reason}.`;

    if (!this.dataStore || typeof this.dataStore.sendNotifications !== 'function') {
      if (this.toastView) this.toastView.show({ title: 'Ping unavailable', sub: 'No data store wired up.' });
      return;
    }

    // Verify the recipient has a profile row whose member_id matches — the
    // notifications table FKs to team_members(id), and the worker's poll
    // queries by their profile.member_id. If the profile is missing or the
    // slug doesn't line up, the insert will succeed but the worker will
    // never see it.
    const recipientProfile = (App.PROFILES || []).find(p => p.member_id === memberId);
    if (!recipientProfile) {
      if (this.toastView) {
        this.toastView.show({
          title: `Can't ping ${person.name || person.full}`,
          sub: 'They haven’t signed up yet, or their account isn’t linked to this team slot.',
        });
      }
      return;
    }

    try {
      await this.dataStore.sendNotifications([{ memberId, meta, html }]);
      if (this.toastView) {
        this.toastView.show({
          title: 'Pinged ' + (person.name || person.full),
          sub: 'They’ll see it within 30s of opening the app.',
        });
      }
    } catch (err) {
      console.error('[ping] sendNotifications failed', err);
      if (this.toastView) {
        this.toastView.show({
          title: 'Ping failed',
          sub: (err && err.message) || 'The notification could not be saved.',
        });
      }
    }
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

  /* ---------- filters ---------- */
  toggleFilters() {
    this.uiState.filtersOpen = !this.uiState.filtersOpen;
    App.EventBus.emit('filters:toggled', this.uiState.filtersOpen);
  }

  toggleFilterValue(group, value) {
    const arr = this.uiState.filters[group];
    if (!Array.isArray(arr)) return;
    const i = arr.indexOf(value);
    if (i === -1) arr.push(value); else arr.splice(i, 1);
    App.EventBus.emit('filters:changed');
  }

  setFilterDueRange(range) {
    this.uiState.filters.dueRange = range || 'all';
    App.EventBus.emit('filters:changed');
  }

  clearFilters() {
    this.uiState.filters = { assignees: [], companies: [], statuses: [], priorities: [], types: [], dueRange: 'all' };
    App.EventBus.emit('filters:changed');
  }

  activeFilterCount() {
    const f = this.uiState.filters || {};
    return (f.assignees || []).length
      + (f.companies  || []).length
      + (f.statuses   || []).length
      + (f.priorities || []).length
      + (f.types      || []).length
      + ((f.dueRange && f.dueRange !== 'all') ? 1 : 0);
  }

  /* ---------- sort + group ---------- */
  setSortBy(key) {
    if (!App.SORT_OPTIONS[key]) return;
    if (this.uiState.sortBy === key) {
      this.uiState.sortDir = this.uiState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.uiState.sortBy = key;
      this.uiState.sortDir = 'asc';
    }
    App.EventBus.emit('sort:changed');
  }

  setGroupBy(key) {
    if (!App.GROUP_OPTIONS[key]) return;
    if (this.uiState.groupBy === key) return;
    this.uiState.groupBy = key;
    this.uiState.collapsedGroups = new Set();
    App.EventBus.emit('group:changed');
  }

  toggleGroupCollapsed(key) {
    const s = this.uiState.collapsedGroups;
    if (s.has(key)) s.delete(key); else s.add(key);
    App.EventBus.emit('group:collapsed-changed');
  }

  /* ---------- misc ---------- */
  handleEscape() {
    if (this.uiState.selectedTaskId) {
      this.closeDetail();
    }
  }
};
