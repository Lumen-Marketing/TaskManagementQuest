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
      // Calendar view state: 'month' | 'week', and the focused anchor date
      // (ISO; null → today at render time).
      calendarMode: 'month',
      calendarAnchor: null,
      calendarSelectedDay: null,
      filters: { assignees: [], companies: [], statuses: [], priorities: [], types: [], dueRange: 'all' },
      filtersOpen: false,
      sortBy: 'priority',
      sortDir: 'asc',
      groupBy: 'due',
      collapsedGroups: new Set(),
      // Bulk-select mode: when on, list rows toggle selection instead of
      // opening the detail pane, and BulkActionsView shows a bottom action bar.
      bulkMode: false,
      bulkSelected: new Set(),
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
      // Multi-company users default to "All companies" so they land on
      // everything they can access; single-company users default to that one.
      companies = mine.length > 1 ? ['*'].concat(mine) : mine;
      fallback = mine.length > 1 ? '*' : (mine[0] || null);
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
    // Focus is a shared cross-person list reached via the widget / Sort menu,
    // not tied to any view — so switching views exits Execution-order back to a
    // normal sort rather than showing the shared list under a view's header.
    const prevSort = this.uiState.sortBy;
    if (this.uiState.sortBy === 'focus') this.uiState.sortBy = 'priority';
    // Refresh the Sort button label / widget if we changed the sort under them
    // (syncButtonLabels listens to sort:changed, not view:changed).
    if (this.uiState.sortBy !== prevSort) App.EventBus.emit('sort:changed');
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
        calendarMode: this.uiState.calendarMode,
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
    // 'timeline' was replaced by 'calendar' — migrate any stored value.
    const savedLayout = saved.layout === 'timeline' ? 'calendar' : saved.layout;
    if (['table', 'calendar', 'kanban'].includes(savedLayout)) this.setLayout(savedLayout);
    if (saved.calendarMode === 'month' || saved.calendarMode === 'week') this.uiState.calendarMode = saved.calendarMode;
    // Don't restore transient person:/company: filters. Re-opening onto a narrow
    // filtered view that happens to be empty reads as "my tasks vanished" (a real
    // support issue). Only stable workspace views are remembered; narrow filters
    // reset to the default All list on reload.
    const isNarrowFilter = saved.view && (saved.view.startsWith('person:') || saved.view.startsWith('company:'));
    if (typeof saved.view === 'string' && !isNarrowFilter && this.canView(saved.view)) this.setView(saved.view);
  }

  setSearchQuery(q) {
    this.uiState.searchQuery = q;
    App.EventBus.emit('search:changed', q);
  }

  setLayout(layout) {
    if (!['table', 'calendar', 'kanban'].includes(layout)) return;
    if (this.uiState.layout === layout) return;
    this.uiState.layout = layout;
    this._persistUiState();
    App.EventBus.emit('layout:changed', layout);
  }

  /* ----- Calendar view controls ----- */
  setCalendarMode(mode) {
    if (mode !== 'month' && mode !== 'week') return;
    if (this.uiState.calendarMode === mode) return;
    this.uiState.calendarMode = mode;
    this.uiState.calendarSelectedDay = null;
    this._persistUiState();
    App.EventBus.emit('calendar:changed');
  }

  // Move the calendar by ±1 month (month mode) or ±1 week (week mode). delta is
  // -1 / +1. `unit` overrides the step when needed.
  shiftCalendar(delta) {
    const base = this.uiState.calendarAnchor
      ? new Date(this.uiState.calendarAnchor + 'T00:00:00')
      : new Date();
    if (this.uiState.calendarMode === 'week') {
      base.setDate(base.getDate() + delta * 7);
    } else {
      base.setMonth(base.getMonth() + delta);
    }
    this.uiState.calendarAnchor = App.utils.toISODate(base);
    this.uiState.calendarSelectedDay = null;
    App.EventBus.emit('calendar:changed');
  }

  resetCalendarToToday() {
    this.uiState.calendarAnchor = null;
    this.uiState.calendarSelectedDay = null;
    App.EventBus.emit('calendar:changed');
  }

  selectCalendarDay(iso) {
    this.uiState.calendarSelectedDay =
      this.uiState.calendarSelectedDay === iso ? null : iso;
    App.EventBus.emit('calendar:changed');
  }

  /* ----- The filtered task set the list/calendar/export all share ----- */
  getVisibleTasks() {
    const role = App.effectiveRole();
    const me = (App.currentProfile && App.currentProfile.member_id) || this.currentUser;
    const reportMemberIds = (role === 'supervisor' && App.realRole() !== 'developer')
      ? new Set((App.PROFILES || []).filter(p => p.supervisor_id === me).map(p => p.member_id))
      : null;
    return this.taskModel.getFiltered({
      view: this.uiState.view,
      searchQuery: this.uiState.searchQuery,
      currentUser: this.currentUser,
      activeFilters: this.uiState.filters,
      currentCompany: this.uiState.currentCompany,
      role,
      reportMemberIds,
    });
  }

  _personName(id) {
    const p = App.PEOPLE && App.PEOPLE[id];
    return (p && (p.full || p.name)) || id || '';
  }

  /* ----- CSV export (respects current view + filters) ----- */
  exportTasksCsv() {
    const tasks = this.getVisibleTasks();
    const rows = [['Title', 'Type', 'Label', 'Company', 'Assignee', 'Priority', 'Status', 'Due', 'Created by', 'Subtasks', 'Description']];
    tasks.forEach(t => {
      const label = (t.label && t.label !== 'none' && App.TASK_LABELS[t.label]) ? App.TASK_LABELS[t.label].label : '';
      const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
      const subDone = subs.filter(s => s.d).length;
      rows.push([
        t.title || '',
        (App.TASK_TYPES[t.type] || {}).label || t.type || '',
        label,
        (App.COMPANIES[t.company] || {}).label || t.company || '',
        this._personName(t.assignee),
        (App.PRIORITIES[t.priority] || {}).label || t.priority || '',
        (App.STATUSES[t.status] || {}).label || t.status || '',
        t.due || '',
        this._personName(t.creator),
        subs.length ? `${subDone}/${subs.length}` : '',
        t.description || '',
      ]);
    });
    App.utils.downloadFile(`quest-hq-tasks-${App.utils.todayISO(0)}.csv`, App.utils.toCsv(rows));
    if (this.toastView) this.toastView.show({ title: 'Exported', sub: `${tasks.length} task${tasks.length === 1 ? '' : 's'} → CSV` });
  }

  exportTimeCsv() {
    const tasks = this.getVisibleTasks();
    const byId = new Map(tasks.map(t => [t.id, t]));
    const ids = new Set(tasks.map(t => t.id));
    const entries = (this.timeModel.entries || [])
      .filter(e => ids.has(e.taskId))
      .slice()
      .sort((a, b) => (a.start || 0) - (b.start || 0));
    const rows = [['Date', 'Person', 'Task', 'Company', 'Hours', 'Note']];
    entries.forEach(e => {
      const t = byId.get(e.taskId) || {};
      rows.push([
        e.start ? App.utils.toISODate(new Date(e.start)) : '',
        this._personName(e.userId),
        t.title || e.taskTitle || e.taskId || '',
        (App.COMPANIES[t.company] || {}).label || '',
        ((e.durationMs || 0) / 3600000).toFixed(2),
        e.note || '',
      ]);
    });
    App.utils.downloadFile(`quest-hq-time-${App.utils.todayISO(0)}.csv`, App.utils.toCsv(rows));
    if (this.toastView) this.toastView.show({ title: 'Exported', sub: `${entries.length} time ${entries.length === 1 ? 'entry' : 'entries'} → CSV` });
  }

  selectTask(id) {
    this.uiState.selectedTaskId = (this.uiState.selectedTaskId === id) ? null : id;
    App.EventBus.emit('selection:changed');
  }

  // Keyboard j/k navigation: move the selection to the next/prev task in the
  // currently-visible (filtered + sorted) order, opening its detail. Wraps at
  // the ends. No-op when there are no visible tasks.
  selectAdjacentTask(delta) {
    const tasks = this.getVisibleTasks();
    if (!tasks.length) return;
    const ids = tasks.map(t => t.id);
    const cur = ids.indexOf(this.uiState.selectedTaskId);
    let next;
    if (cur === -1) next = delta > 0 ? 0 : ids.length - 1;
    else next = (cur + delta + ids.length) % ids.length;
    const id = ids[next];
    this.uiState.selectedTaskId = id;
    App.EventBus.emit('selection:changed');
    // Bring the row into view if it scrolled off.
    const safe = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
    const el = document.querySelector(`#listBody [data-id="${safe}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
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
      this._revertToGeneralShiftIfOnTask(id);
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
      this._revertToGeneralShiftIfOnTask(id);
      this._notifyTaskChange(task, 'marked this complete');
      this._celebrateCompletion(task);
    } else if (result) {
      this._notifyTaskChange(task, 'reopened this task');
    }
  }

  // Hard stop: close the current user's timer if it's pointed at this task.
  // Used when the task is going away entirely (delete) — there's nothing to
  // fall back to, so we clock out. stopTimer already toasts the logged time.
  _stopTimerIfOnTask(taskId) {
    const active = this.timeModel.activeFor(this.currentUser);
    if (!active || active.taskId !== taskId) return;
    this.stopTimer(this.currentUser);
  }

  // When a task the user is tracking transitions to Done, don't clock them all
  // the way out — they're still on shift, just not on that task. Drop them back
  // onto the General shift bucket so the clock keeps running.
  _revertToGeneralShiftIfOnTask(taskId) {
    const active = this.timeModel.activeFor(this.currentUser);
    if (!active || active.taskId !== taskId) return;
    this._revertToGeneralShift(this.currentUser, 'done');
  }

  // Switch the user's running timer over to the General shift bucket (logging
  // whatever was on the prior task). Falls back to a full clock-out only when
  // there's no general-shift task to land on, or they're already on it.
  _revertToGeneralShift(userId, reason) {
    if (!App.can('clock.use')) return;
    const clockId = App.DEFAULT_CLOCK_TASK_ID;
    const active = this.timeModel.activeFor(userId);
    if (!active) return;
    // Already on (or toggling off) the General shift bucket itself → clock out.
    if (active.taskId === clockId || !this.taskModel.find(clockId)) {
      this.stopTimer(userId);
      return;
    }
    this.startTimer(userId, clockId, {
      toast: {
        title: 'Back on General shift',
        sub: reason === 'done' ? 'Task done — you’re still clocked in.' : 'You’re still clocked in.',
      },
    });
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
      meta: 'Task update',
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

  /* ---------- bulk select ---------- */
  // Multi-select lets the user act on several tasks at once. Selection state
  // lives in uiState (a Set of ids); the list view paints checkboxes and the
  // BulkActionsView paints the bottom bar. 'bulk:changed' drives both.
  isBulkSelected(id) { return this.uiState.bulkSelected.has(id); }

  enterBulkMode(seedId) {
    if (!App.can('tasks.view')) return;
    this.uiState.bulkMode = true;
    this.uiState.bulkSelected.clear();
    if (seedId != null) this.uiState.bulkSelected.add(seedId);
    // Selecting tasks and reading the detail pane at once is confusing — close it.
    if (this.uiState.selectedTaskId) this.closeDetail();
    App.EventBus.emit('bulk:changed');
    App.EventBus.emit('tasks:changed'); // repaint rows with checkboxes
  }

  exitBulkMode() {
    this.uiState.bulkMode = false;
    this.uiState.bulkSelected.clear();
    App.EventBus.emit('bulk:changed');
    App.EventBus.emit('tasks:changed');
  }

  toggleBulkMode() {
    if (this.uiState.bulkMode) this.exitBulkMode();
    else this.enterBulkMode();
  }

  toggleBulkSelect(id) {
    const sel = this.uiState.bulkSelected;
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    App.EventBus.emit('bulk:changed');
    App.EventBus.emit('selection:changed'); // cheap row-highlight refresh
  }

  bulkSelectAllVisible() {
    const ids = this.getVisibleTasks().map(t => t.id);
    const sel = this.uiState.bulkSelected;
    // If everything's already selected, treat the button as "clear".
    if (ids.length && ids.every(id => sel.has(id))) sel.clear();
    else ids.forEach(id => sel.add(id));
    App.EventBus.emit('bulk:changed');
    App.EventBus.emit('tasks:changed');
  }

  _bulkIds() {
    // Only act on selected tasks still visible (and real).
    return [...this.uiState.bulkSelected].filter(id => this.taskModel.find(id));
  }

  bulkComplete() {
    if (!App.can('tasks.write')) return;
    const ids = this._bulkIds().filter(id => {
      const t = this.taskModel.find(id);
      return t && t.status !== 'done';
    });
    if (!ids.length) { this.exitBulkMode(); return; }
    ids.forEach(id => {
      this.taskModel.toggleDone(id, this.getUserName(this.currentUser));
      this._revertToGeneralShiftIfOnTask(id);
    });
    if (this.toastView) {
      this.toastView.show({
        title: `Completed ${ids.length} task${ids.length > 1 ? 's' : ''}`,
        sub: 'Marked done.',
        action: {
          label: 'Undo',
          onClick: () => ids.forEach(id => this.taskModel.toggleDone(id, this.getUserName(this.currentUser))),
        },
      });
    }
    this.exitBulkMode();
  }

  bulkDelete() {
    const deletable = this._bulkIds().filter(id => this.canDeleteTask(this.taskModel.find(id)));
    const blocked = this._bulkIds().length - deletable.length;
    if (!deletable.length) {
      if (this.toastView) this.toastView.show({ title: 'No access', sub: 'None of the selected tasks can be deleted by you.' });
      return;
    }
    // Snapshot for one shared Undo, then defer the irreversible DB delete past
    // the undo window — mirrors single-task deleteTask().
    const snapshots = deletable.map(id => JSON.parse(JSON.stringify(this.taskModel.find(id))));
    deletable.forEach(id => { this._stopTimerIfOnTask(id); this.taskModel.remove(id); });

    const UNDO_MS = 6000;
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      if (this.dataStore && typeof this.dataStore.deleteTask === 'function') {
        deletable.forEach(id => this.dataStore.deleteTask(id).catch(err => console.error('[task] bulk delete failed', err)));
      }
    }, UNDO_MS);

    if (this.toastView) {
      this.toastView.show({
        title: `Deleted ${deletable.length} task${deletable.length > 1 ? 's' : ''}`,
        sub: blocked ? `${blocked} skipped (no access).` : 'Removed.',
        duration: UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (undone) return;
            undone = true;
            clearTimeout(timer);
            snapshots.forEach(s => this.taskModel.add(s));
          },
        },
      });
    }
    this.exitBulkMode();
  }

  /* ---------- Focus list (execution order) ---------- */
  // Focus is a shared, cross-person execution order, so anyone who can edit
  // tasks can add/reorder it.
  canSetFocusFor(task) {
    return !!task && App.can('tasks.write');
  }

  addToFocus(ids) {
    if (!App.can('tasks.write')) return;
    const list = (Array.isArray(ids) ? ids : [ids]);
    const added = list.filter(id => {
      const t = this.taskModel.find(id);
      if (!t || !this.canSetFocusFor(t) || t.focusSeq != null) return false;
      this.taskModel.addToFocus(id);
      return true;
    });
    if (this.toastView && added.length) {
      this.toastView.show({ title: `Added ${added.length} to Focus`, sub: 'Open Focus to set the order.' });
    }
    if (this.uiState.bulkMode) this.exitBulkMode();
  }

  bulkAddToFocus() {
    if (!App.can('tasks.write')) return;
    this.addToFocus(this._bulkIds());
  }

  removeFromFocus(id) {
    const t = this.taskModel.find(id);
    if (!t || !this.canSetFocusFor(t)) return;
    this.taskModel.removeFromFocus(id);
  }

  setFocusOrder(id, newSeq) {
    const t = this.taskModel.find(id);
    if (!t || !this.canSetFocusFor(t)) return;
    this.taskModel.setFocusOrder(id, newSeq);
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
      this._revertToGeneralShiftIfOnTask(id);
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
    const label = fields.label || task.label || 'roof';
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
      title, description, company, type, label, due, dueTime, reminderAt, priority, status, assignee, watchers, subtasks,
      ...(type === 'bid' ? { bidStatus } : {}),
    });

    // Done has a side effect the inline path also applies: drop a running timer
    // on this task back to General shift rather than clocking fully out.
    if (status === 'done' && prevStatus !== 'done') this._revertToGeneralShiftIfOnTask(id);

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
    // Focus is a shared cross-person order, so a reassigned task keeps its place.
    if (newAssignee !== this.currentUser) {
      const task = this.taskModel.find(id);
      const creatorName = this.getUserName(this.currentUser);
      const person = App.PEOPLE[newAssignee] || { name: newAssignee, email: '' };
      const titleEsc = App.utils.escapeHtml(task.title);
      this._deliver(
        [{
          memberId: newAssignee,
          taskId: id,
          meta: 'Reassigned',
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
      // Email is best-effort: a rejected promise here must not bubble to the
      // global unhandledrejection handler. `skipped` = email isn't configured
      // (expected, silent); a real failure tells the user the in-app notice
      // still went through so they know the assignee was reached.
      try {
        const res = await this.dataStore.sendEmail({ to: unique, subject: emailContent.subject, html: emailContent.html });
        if (res && res.ok === false && !res.skipped) {
          console.warn('[notify] email delivery failed:', res.error);
          if (this.toastView) {
            this.toastView.show({
              title: 'Email not sent',
              sub: 'The in-app notification was delivered, but the email failed.',
            });
          }
        }
      } catch (err) {
        console.warn('[notify] email delivery threw', err);
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

  openNewTaskModal(prefill) {
    if (!App.can('tasks.write')) {
      this.toastView.show({ title: 'No access', sub: 'Your role cannot create tasks.' });
      return;
    }
    this.newTaskModal.open(prefill);
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
      label: payload.label || 'roof',
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
    const creatorEmail = App.PEOPLE[this.currentUser] ? App.PEOPLE[this.currentUser].email : '';
    const titleEsc = App.utils.escapeHtml(task.title);

    const inapp = [];
    const emails = [];

    if (delegated && payload.notify.inapp) {
      inapp.push({
        memberId: payload.assignee,
        taskId: task.id,
        meta: 'Task assigned',
        html: `<strong>${App.utils.escapeHtml(creatorName)}</strong> assigned <em>${titleEsc}</em> to you`,
      });
    }
    // Email delivery is automatic: the assignee, the creator, and every watcher
    // are emailed whenever they have an address on file — independent of the
    // notify checkboxes, which now only gate the in-app notifications. _deliver
    // de-dupes, so anyone filling more than one role still gets a single email.
    if (delegated && assigneeEmail) emails.push(assigneeEmail);
    if (creatorEmail) emails.push(creatorEmail);

    (payload.watchers || []).forEach(w => {
      if (payload.notify.watchers) {
        inapp.push({
          memberId: w,
          taskId: task.id,
          meta: 'Watching',
          html: `You're now watching <em>${titleEsc}</em> (assigned to ${App.utils.escapeHtml(assigneeName)})`,
        });
      }
      if (App.PEOPLE[w] && App.PEOPLE[w].email) emails.push(App.PEOPLE[w].email);
    });

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
          sub: assigneeEmail ? `Notifying ${assigneeEmail}` : 'In-app notification sent',
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
  startTimer(userId, taskId, opts = {}) {
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
    this.toastView.show(opts.toast || {
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
      // Pausing the task you're tracking drops you back to General shift
      // (still on the clock) so you can do other things first, rather than
      // clocking you out entirely. Use the topbar Clock widget to clock out.
      this._revertToGeneralShift(this.currentUser, 'pause');
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
    if (this.uiState.bulkMode) {
      this.exitBulkMode();
    } else if (this.uiState.selectedTaskId) {
      this.closeDetail();
    }
  }
};
