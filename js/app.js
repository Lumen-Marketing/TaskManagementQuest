/* Bootstrap - wires the three layers together.
   1. Construct models, hydrate from Supabase
   2. Construct controller
   3. Construct views
   4. Persist to Supabase on any model change
   5. Start the 1-second clock tick */
document.addEventListener('DOMContentLoaded', async () => {
  if (App.authReady) await App.authReady;
  App.currentProfile = App.currentProfile || {};
  App.CURRENT_USER = App.currentProfile.member_id || App.CURRENT_USER;

  if (!App.can('app.use') && !App.can('clock.use') && !App.can('roles.manage')) {
    renderRoleGate();
    return;
  }

  const taskModel = new App.TaskModel();
  const timeModel = new App.TimeModel();
  const notifModel = new App.NotificationModel();

  const dataStore = App.previewMode
    ? {
        load: async () => null,
        save: async () => ({ conflicts: [] }),
        loadProfiles: async () => App.PROFILES || [],
        loadNotifications: async () => [],
        updateProfileAccess: async (id, updates) => {
          const p = (App.PROFILES || []).find(pr => pr.id === id);
          if (p) {
            p.role = updates.role;
            p.approved = !!updates.approved;
            if ('supervisorId' in updates) p.supervisor_id = updates.supervisorId || null;
            if ('companyId' in updates) p.company_id = updates.companyId || null;
          }
          return p || {};
        },
        sendNotifications: async () => {},
        sendEmail: async () => ({ ok: false, skipped: true }),
      }
    : new App.SupabaseDataStore({
        supabase: App.supabase,
        currentUser: App.CURRENT_USER,
        role: App.currentProfile.role || 'member',
      });

  if (App.previewMode) {
    taskModel.seedDefaults();
    if (typeof timeModel.seedDefaults === 'function') timeModel.seedDefaults();
    // Demo roles + reporting lines so role-gated views (worker, supervisor, hierarchy)
    // can be exercised in preview via ?preview=1&role=...&member=...
    const previewRoles = {
      abraham:  { role: 'admin',                   company_id: 'roofing' },
      alkeith:  { role: 'construction_supervisor', company_id: 'roofing' },
      jesus:    { role: 'supervisor',              company_id: 'roofing' },
      kristine: { role: 'worker', supervisor_id: 'jesus',   company_id: 'roofing' },
      andres:   { role: 'worker', supervisor_id: 'alkeith', company_id: 'drafting' },
      adrian:   { role: 'member', approved: false,          company_id: 'lumen' },
    };
    App.PROFILES = Object.values(App.PEOPLE).map(p => {
      const cfg = previewRoles[p.id] || { role: 'sales' };
      return {
        id: 'preview-' + p.id,
        email: p.email,
        full_name: p.full,
        approved: cfg.approved !== undefined ? cfg.approved : true,
        role: cfg.role,
        email_verified: true,
        member_id: p.id,
        supervisor_id: cfg.supervisor_id || null,
        company_id: cfg.company_id || null,
        created_at: new Date().toISOString(),
      };
    });
  } else {
    try {
      const saved = await dataStore.load();
      if (saved.people && Object.keys(saved.people).length) App.PEOPLE = saved.people;
      App.PROFILES = saved.profiles || [];
      taskModel.hydrate(saved.tasks);
      timeModel.hydrate(saved.timeEntries, saved.activeTimers);
      notifModel.hydrate(saved.notifications);
    } catch (err) {
      console.error('[app] Supabase load failed', err);
      renderFatalDataError(err);
      return;
    }
    // Best-effort: hard-delete cleared tasks past their 30-day grace.
    // Fire-and-forget so a slow delete doesn't block first paint; RLS
    // gates this to roles allowed by migration 017.
    if (dataStore.purgeExpiredClearedTasks) {
      dataStore.purgeExpiredClearedTasks().then(n => {
        if (n) console.info(`[app] purged ${n} expired cleared task(s)`);
      });
    }
  }

  const controller = new App.AppController({
    taskModel,
    timeModel,
    notifModel,
    currentUser: App.CURRENT_USER,
    dataStore,
  });

  // Expose models on App for console debugging (read-only contract — don't
  // mutate from console in production, but inspect freely).
  App.taskModel = taskModel;
  App.timeModel = timeModel;
  App.notifModel = notifModel;
  App.controller = controller;
  App.dataStore = dataStore;

  const toastView = new App.ToastView('toastContainer');
  const newTaskModal = new App.NewTaskModalView({ controller, currentUser: App.CURRENT_USER });
  controller.attachViews({ toastView, newTaskModal });

  // Last-resort handlers: any error that escaped its own try/catch ends up
  // here as a clean toast instead of an unhandled rejection in the console.
  // We never display raw error.message unless App.errors.userMessage decides
  // it's safe (AppError.expose === true), so DB internals stay hidden. The
  // same error is also forwarded to observability — Sentry sees the real
  // error object (with stack), the user sees a clean toast.
  const surfaceUnhandled = (err) => {
    try {
      console.error('[unhandled]', err);
      if (App.observability) App.observability.captureException(err, { source: 'global-handler' });
      toastView.show({
        title: 'Something went wrong',
        sub: (App.errors && App.errors.userMessage) ? App.errors.userMessage(err) : 'Please try again.',
      });
    } catch { /* swallow — never let the error handler throw */ }
  };
  window.addEventListener('error', (e) => surfaceUnhandled(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => surfaceUnhandled(e.reason));

  new App.TopbarView({ timeModel, notifModel, controller, currentUser: App.CURRENT_USER });
  new App.SidebarView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskListView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskDetailView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.FilterBarView({ controller });
  new App.ResizeHandleView({ controller });
  new App.ToolbarMenuView({ controller });
  new App.UiScaleView();
  new App.ProgressWidgetView({ taskModel, currentUser: App.CURRENT_USER });
  new App.UpNextWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });

  // Reminder engine — scans tasks every minute, synthesizes in-app
  // notifications when a due-date threshold is crossed (keyed by priority).
  const reminderEngine = new App.ReminderEngine({
    taskModel,
    notifModel,
    currentUser: App.CURRENT_USER,
  });
  reminderEngine.start();
  App.reminderEngine = reminderEngine;
  new App.TimeView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.ApprovalView({ controller, dataStore });
  new App.ClockDashboardView({ taskModel, timeModel, controller });
  new App.HierarchyView({ controller });

  applyRoleChrome(controller);

  // Expose the role as a body class so CSS can scope per-role tweaks
  // (e.g. hide the Assignee column for workers/members).
  const _role = (App.currentProfile && App.currentProfile.role) || 'member';
  document.body.classList.add('role-' + _role);

  // Preview-only: ?view= lets you deep-link an initial view for screenshots/testing.
  if (App.previewMode) {
    const pv = new URLSearchParams(window.location.search).get('view');
    if (pv) controller.setView(pv);
  }

  let persistTimer = null;
  // Delta save: only the tasks/time-entries that actually changed are written,
  // via upserts (never delete-and-reinsert). Conflicts (a newer server version)
  // are reconciled by taking the server's copy.
  const doSave = async () => {
    const dirtyTasks = taskModel.takeDirty();
    const unsavedEntries = timeModel.takeUnsavedEntries();
    try {
      const result = await dataStore.save({
        tasks: dirtyTasks,
        timeEntries: unsavedEntries,
        activeTimers: timeModel.activeTimers,
        notifications: notifModel.all(),
      });
      if (result && result.conflicts && result.conflicts.length) {
        result.conflicts.forEach(t => taskModel.applyServer(t));
        if (controller.toastView) {
          controller.toastView.show({
            title: 'Task updated elsewhere',
            sub: `Refreshed ${result.conflicts.length} task${result.conflicts.length > 1 ? 's' : ''} to the latest version.`,
          });
        }
      }
    } catch (err) {
      console.error('[app] Supabase save failed', err);
      // Re-flag the changes so the next save retries them instead of losing them.
      taskModel.markDirty(dirtyTasks.map(t => t.id));
      timeModel.markUnsavedEntries(unsavedEntries.map(e => e.id));
      if (controller.toastView) {
        controller.toastView.show({
          title: 'Supabase save failed',
          sub: (err && err.message) || 'Will retry on the next change.',
        });
      }
    }
  };
  const persist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(doSave, 350);
  };
  App.EventBus.on('tasks:changed', persist);
  App.EventBus.on('time:changed', persist);
  App.EventBus.on('notifs:changed', persist);

  // Close the current user's timer if it's been running past the max shift.
  const staleEntry = timeModel.autoCloseStaleForUser(App.CURRENT_USER, App.MAX_SHIFT_MS);
  if (staleEntry && controller.toastView) {
    controller.toastView.show({ title: 'Auto clocked-out', sub: 'Your timer ran past 12h and was closed automatically.' });
  }

  // Poll for notifications addressed to this user by other people (assignments,
  // watcher pings) since there's no realtime subscription.
  if (!App.previewMode && App.can('tasks.view')) {
    setInterval(async () => {
      try {
        const fresh = await dataStore.loadNotifications();
        notifModel.hydrate(fresh);
        App.EventBus.emit('notifs:refreshed');
      } catch (e) { /* transient poll error — ignore */ }
    }, 30000);
  }

  // Interactive onboarding tour — role-aware, auto-shown once per NEW account.
  // Existing users skip it (migration 014 backfills them as onboarded), and
  // anyone can replay it via the avatar menu (see TopbarView).
  App.tour = new App.TourView();
  // Per-user localStorage key — fallback for when migration 015 hasn't been
  // run yet so the DB column doesn't exist. Survives reloads on this device
  // even if the Supabase write fails.
  const tourLocalKey = () => `qhq.onboarded.${App.currentAuthUser && App.currentAuthUser.id || 'anon'}`;
  const markOnboarded = async () => {
    if (App.previewMode) return;
    try { window.localStorage.setItem(tourLocalKey(), '1'); } catch (e) {}
    try {
      await App.supabase.from('profiles').update({ onboarded: true }).eq('id', App.currentAuthUser.id);
      if (App.currentProfile) App.currentProfile.onboarded = true;
    } catch (e) { /* column may not exist until migration 015 runs — local flag still set */ }
  };
  const shouldAutoStartTour = async () => {
    if (App.previewMode) return true; // always available while previewing
    try { if (window.localStorage.getItem(tourLocalKey()) === '1') return false; } catch (e) {}
    // Treat anyone whose profile was created more than 10 minutes ago as
    // already-onboarded — they're a returning user, not a fresh signup. Auto-
    // persist the flag so this check doesn't have to run again next reload.
    const createdAt = App.currentProfile && App.currentProfile.created_at;
    if (createdAt) {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (ageMs > 10 * 60 * 1000) { markOnboarded(); return false; }
    }
    try {
      const { data } = await App.supabase.from('profiles').select('onboarded').eq('id', App.currentAuthUser.id).maybeSingle();
      return !(data && data.onboarded);
    } catch (e) { return false; } // no onboarded column yet → don't nag
  };
  App.startTour = () => App.tour.start({ onFinish: markOnboarded });

  const forceTour = new URLSearchParams(window.location.search).get('tour') === '1';
  window.setTimeout(async () => {
    if (forceTour || await shouldAutoStartTour()) App.startTour();
  }, 600);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') {
      if (document.getElementById('newTaskModal')) return;
      if (!App.can('tasks.write')) return;
      e.preventDefault();
      controller.openNewTaskModal();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      controller.toggleGlobalClock();
    } else if (e.key === 'Escape') {
      controller.handleEscape();
    }
  });

  setInterval(() => App.EventBus.emit('clock:tick'), 1000);

  window.addEventListener('beforeunload', () => {
    if (persistTimer) window.clearTimeout(persistTimer);
    doSave().catch(err => console.warn('[app] final Supabase save failed', err));
  });
});

function applyRoleChrome(controller) {
  const search = document.querySelector('.search');
  const notifWrap = document.getElementById('notifBtn') && document.getElementById('notifBtn').parentElement;
  const newTaskBtn = document.getElementById('newTaskBtn');
  const filterBtn = document.getElementById('filterBtn');
  const quickAdd = document.querySelector('.quick-add');
  const layoutSwitcher = document.getElementById('viewBtn');
  const isWorker = (App.currentProfile && App.currentProfile.role) === 'worker';

  if (search) search.classList.toggle('hidden', !App.can('tasks.view'));
  if (notifWrap) notifWrap.classList.toggle('hidden', !App.can('tasks.view'));
  if (newTaskBtn) newTaskBtn.classList.toggle('hidden', !App.can('tasks.write'));
  if (filterBtn) filterBtn.classList.toggle('hidden', !App.can('tasks.view'));
  if (quickAdd) quickAdd.classList.toggle('hidden', !App.can('tasks.write'));
  // Workers use a fixed Time | Task layout, so the table/timeline/kanban switcher is hidden.
  if (layoutSwitcher) layoutSwitcher.classList.toggle('hidden', isWorker || !App.can('tasks.view'));

  if (App.can('clock.use') && !App.can('tasks.view')) {
    controller.setView('time:mine');
  }
}

function renderRoleGate() {
  const profile = App.currentProfile || {};
  const roleLabel = (App.ROLES[profile.role || 'member'] || App.ROLES.member).label;
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0E0E10;color:#F5F1E6;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <div style="max-width:520px;background:#131315;border:1px solid #2A2A2E;border-radius:10px;padding:24px;box-shadow:0 24px 48px rgba(0,0,0,.5);">
        <div style="font-family:'Instrument Serif',serif;font-size:30px;margin-bottom:8px;">Access pending</div>
        <div style="color:#B8B2A4;line-height:1.5;">Your account is currently <strong>${App.utils.escapeHtml(roleLabel)}</strong>. An admin or construction supervisor needs to assign your role before you can use Quest HQ.</div>
        <button onclick="App.signOut()" style="margin-top:18px;padding:10px 14px;border:0;border-radius:6px;background:#E8A03A;color:#1A1208;font-weight:700;cursor:pointer;">Sign out</button>
      </div>
    </div>
  `;
}

function renderFatalDataError(err) {
  const message = App.utils.escapeHtml((err && err.message) || 'Unable to load Quest HQ data from Supabase.');
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#F6F1E8;color:#23180D;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <div style="max-width:520px;background:#FFF9EF;border:1px solid #E2D3BC;border-radius:8px;padding:22px;box-shadow:0 16px 40px rgba(46,31,17,.12);">
        <div style="font-weight:800;font-size:18px;margin-bottom:8px;">Supabase data unavailable</div>
        <div style="font-size:14px;line-height:1.5;color:#6E5B45;">${message}</div>
        <button onclick="window.location.reload()" style="margin-top:16px;padding:10px 14px;border:0;border-radius:6px;background:#8D3F1F;color:white;font-weight:700;cursor:pointer;">Retry</button>
      </div>
    </div>
  `;
}
