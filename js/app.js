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
        // Comments live in-memory in preview/offline mode (no Supabase table).
        loadComments: async (taskId) => (App._previewComments && App._previewComments[taskId]) || [],
        addComment: async (taskId, { body, mentions }) => {
          App._previewComments = App._previewComments || {};
          const list = App._previewComments[taskId] || (App._previewComments[taskId] = []);
          const c = {
            id: App.utils.uid('c'), taskId, authorId: App.CURRENT_USER,
            body: String(body || ''), mentions: Array.isArray(mentions) ? mentions : [],
            createdAt: new Date().toISOString(),
          };
          list.push(c);
          return c;
        },
        updateProfileAccess: async (id, updates) => {
          const p = (App.PROFILES || []).find(pr => pr.id === id);
          if (p) {
            p.role = updates.role;
            p.approved = !!updates.approved;
            if ('supervisorId' in updates) p.supervisor_id = updates.supervisorId || null;
            if ('companyIds' in updates) p.company_ids = Array.isArray(updates.companyIds) ? updates.companyIds : [];
          }
          return p || {};
        },
        sendNotifications: async () => {},
        sendEmail: async () => ({ ok: false, skipped: true }),
        deleteProfile: async (id) => {
          App.PROFILES = (App.PROFILES || []).filter(pr => pr.id !== id);
          return { emailFreed: true };
        },
        createUser: async () => {
          throw new Error('Adding people is not available in preview/offline mode.');
        },
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
      abraham:  { role: 'admin',                   company_ids: ['roofing', 'drafting', 'lumen'] },
      alkeith:  { role: 'construction_supervisor', company_ids: ['roofing'] },
      jesus:    { role: 'supervisor',              company_ids: ['roofing'] },
      kristine: { role: 'worker', supervisor_id: 'jesus',   company_ids: ['roofing'] },
      andres:   { role: 'worker', supervisor_id: 'alkeith', company_ids: ['drafting'] },
      adrian:   { role: 'member', approved: false,          company_ids: ['lumen'] },
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
        company_ids: Array.isArray(cfg.company_ids) ? cfg.company_ids : (cfg.company_id ? [cfg.company_id] : []),
        created_at: new Date().toISOString(),
      };
    });
    // Mirror the previewed member's company_ids onto the active profile so the
    // company switcher / scoping works in preview (the auth-guard stub omits it).
    const mineCfg = previewRoles[App.currentProfile.member_id];
    if (mineCfg && !App.currentProfile.company_ids) {
      App.currentProfile.company_ids = Array.isArray(mineCfg.company_ids) ? mineCfg.company_ids : [];
    }
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

  // A user's display name + photo live on their PROFILE, but the task list
  // and pickers read from the team_members roster (App.PEOPLE). Non-managers
  // can't write team_members (RLS), so the roster can lag behind the profile.
  // Overlay profile name/avatar onto App.PEOPLE so the chosen display name and
  // photo show everywhere, regardless of whether team_members was synced.
  overlayProfilesOntoPeople();

  const controller = new App.AppController({
    taskModel,
    timeModel,
    notifModel,
    currentUser: App.CURRENT_USER,
    dataStore,
  });

  // Resolve the user's accessible companies + active company before any view
  // renders, so the first paint is already company-scoped.
  controller.initCompanyContext();

  // Expose models on App for console debugging (read-only contract — don't
  // mutate from console in production, but inspect freely).
  App.taskModel = taskModel;
  App.timeModel = timeModel;
  App.notifModel = notifModel;
  App.controller = controller;
  App.dataStore = dataStore;

  const toastView = new App.ToastView('toastContainer');
  const newTaskModal = new App.NewTaskModalView({ controller, currentUser: App.CURRENT_USER });
  const profileView = new App.ProfileView({ controller });
  controller.attachViews({ toastView, newTaskModal, profileView });

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
  new App.BulkActionsView({ controller });
  new App.ResizeHandleView({ controller });
  new App.ToolbarMenuView({ controller });
  new App.UiScaleView();
  new App.ProgressWidgetView({ taskModel, currentUser: App.CURRENT_USER });
  new App.UpNextWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.FocusWidgetView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });

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
  new App.HomeView({ controller });
  new App.ReportsView({ controller });
  new App.WallboardView({ controller });
  new App.ApprovalView({ controller, dataStore });
  new App.ClockDashboardView({ taskModel, timeModel, controller });
  new App.HierarchyView({ controller });

  applyRoleChrome(controller);

  // Data is loaded and the views have rendered — drop the boot skeleton if it
  // wasn't already replaced (e.g. clock-only users whose task list never renders).
  const bootSkeleton = document.getElementById('listSkeleton');
  if (bootSkeleton) bootSkeleton.remove();

  // Expose the role as a body class so CSS can scope per-role tweaks
  // (e.g. hide the Assignee column for workers/members). Uses the effective
  // role so a developer previewing another role gets that role's chrome.
  document.body.classList.add('role-' + App.effectiveRole());

  // Preview-only: ?view= lets you deep-link an initial view for screenshots/testing.
  // Otherwise, restore the view/layout the user left off on last session.
  if (App.previewMode) {
    const pv = new URLSearchParams(window.location.search).get('view');
    if (pv) controller.setView(pv);
  } else {
    controller.restoreUiState();
  }

  let persistTimer = null;
  // Delta save: only the tasks/time-entries that actually changed are written,
  // via upserts (never delete-and-reinsert). Conflicts (a newer server version)
  // are reconciled by taking the server's copy.
  const doSave = async () => {
    // Coalesce any pending debounce: whether we got here from the timer or from a
    // direct controller.saveNow() call, drop the outstanding timeout so the same
    // dirty set can't be saved twice. Returns whether the write succeeded so
    // callers (createTask) can decide what to do next.
    window.clearTimeout(persistTimer);
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
      return true;
    } catch (err) {
      console.error('[app] Supabase save failed', err, 'cause:', err && err.cause);
      // Re-flag the changes so the next save retries them instead of losing them.
      taskModel.markDirty(dirtyTasks.map(t => t.id));
      timeModel.markUnsavedEntries(unsavedEntries.map(e => e.id));
      if (controller.toastView) {
        // Reassure first (the changes are re-flagged above and WILL retry), then
        // include the underlying Supabase message so the cause (RLS, constraint,
        // network) isn't hidden behind friendly text.
        if (!navigator.onLine) {
          controller.toastView.show({
            title: "You're offline",
            sub: 'Your changes are kept and will sync automatically when you reconnect.',
          });
        } else {
          const friendly = (err && err.message) || 'Save failed';
          const cause = err && err.cause && err.cause.message;
          controller.toastView.show({
            title: "Couldn't save — your changes are kept",
            sub: `Retrying shortly. ${cause ? `${friendly} — ${cause}` : friendly}`,
          });
        }
      }
      return false;
    }
  };
  const persist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(doSave, 350);
  };
  App.EventBus.on('tasks:changed', persist);
  App.EventBus.on('time:changed', persist);
  App.EventBus.on('notifs:changed', persist);

  // Let the controller force an immediate, awaitable save. createTask uses this to
  // persist a new task BEFORE it notifies the assignee — a worker's permission to
  // insert that notification (migration 040) requires the task row to already exist.
  controller.saveNow = doSave;

  // Network resilience: show an offline banner while disconnected and flush any
  // queued changes the moment we're back online. Dirty tasks/entries are
  // re-flagged by doSave's catch above when a save fails mid-outage, so this
  // reconnect flush picks them up rather than losing them.
  new App.ConnectionView({ toastView, onReconnect: doSave });

  // Close the current user's timer if it's been running past the max shift.
  // Runs on boot AND on a recurring interval so a timer that crosses 12h while
  // the app is left open auto-closes on its own, not only on the next reload.
  const checkStaleTimer = () => {
    const staleEntry = timeModel.autoCloseStaleForUser(App.CURRENT_USER, App.MAX_SHIFT_MS);
    if (staleEntry && controller.toastView) {
      controller.toastView.show({ title: 'Auto clocked-out', sub: 'Your timer ran past 12h and was closed automatically.' });
    }
  };
  checkStaleTimer();
  // The 12h cap doesn't need second-level precision; a per-minute check is plenty.
  setInterval(checkStaleTimer, 60 * 1000);

  // Poll for notifications addressed to this user by other people (assignments,
  // watcher pings) since there's no realtime subscription. Newly arrived
  // notifications also pop a toast so the user sees them without having to
  // open the bell — IDs seen on boot are excluded so the first poll after
  // page load doesn't dump a wall of toasts for older unread items.
  if (!App.previewMode && App.can('tasks.view')) {
    const seenNotifIds = new Set(notifModel.all().map(n => n.id));
    // Surface a *persistent* sync outage once (not every 30s tick) so the user
    // knows their list may be stale; announce recovery once it clears. A single
    // transient blip stays silent.
    let pollFailStreak = 0;
    let pollWarned = false;
    setInterval(async () => {
      let ok = true;
      // Tasks have no realtime subscription, so re-pull them here too: a task
      // created/edited by someone else won't appear until the next poll
      // otherwise. Merged non-destructively so unsaved local edits survive.
      try {
        if (dataStore.loadTasks) {
          const freshTasks = await dataStore.loadTasks(taskModel.dirtyIds());
          taskModel.mergeServer(freshTasks);
        }
      } catch (e) { ok = false; console.warn('[app] task poll failed', e); }
      try {
        const fresh = await dataStore.loadNotifications();
        const arrivals = fresh.filter(n => !seenNotifIds.has(n.id) && !n.read);
        notifModel.hydrate(fresh);
        fresh.forEach(n => seenNotifIds.add(n.id));
        App.EventBus.emit('notifs:refreshed');
        arrivals.slice(0, 3).forEach(n => {
          toastView.show({
            title: n.meta || 'New notification',
            sub: App.utils.stripHtml ? App.utils.stripHtml(n.html) : (n.html || '').replace(/<[^>]+>/g, ''),
          });
        });
        if (arrivals.length > 3) {
          toastView.show({
            title: `+${arrivals.length - 3} more notifications`,
            sub: 'Open the bell icon to see them all.',
          });
        }
      } catch (e) { ok = false; console.warn('[app] notification poll failed', e); }

      if (ok) {
        if (pollWarned) toastView.show({ title: 'Back in sync', sub: 'Reconnected to the server.' });
        pollFailStreak = 0;
        pollWarned = false;
      } else if (++pollFailStreak >= 3 && !pollWarned) {
        pollWarned = true;
        toastView.show({ title: 'Sync paused', sub: "Can't reach the server. Your work is safe; still retrying every 30s." });
      }
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
    // '?' opens the shortcuts cheat-sheet from anywhere (even out of a field is
    // handled below); Escape always closes any open overlay/menu/detail.
    if (e.key === 'Escape') {
      if (App.closeShortcutsHelp && App.closeShortcutsHelp()) { e.preventDefault(); return; }
      controller.handleEscape();
      return;
    }
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                   e.target.tagName === 'SELECT' || e.target.isContentEditable;
    // '/' focuses search — the one shortcut we want even while not typing.
    if (e.key === '/' && !typing) {
      const search = document.getElementById('searchInput');
      if (search) { e.preventDefault(); search.focus(); search.select(); }
      return;
    }
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '?') {
      e.preventDefault();
      if (App.toggleShortcutsHelp) App.toggleShortcutsHelp();
    } else if (e.key === 'n' || e.key === 'N') {
      if (document.getElementById('newTaskModal')) return;
      if (!App.can('tasks.write')) return;
      e.preventDefault();
      controller.openNewTaskModal();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      controller.toggleGlobalClock();
    } else if (e.key === 'j') {
      e.preventDefault();
      controller.selectAdjacentTask(1);
    } else if (e.key === 'k') {
      e.preventDefault();
      controller.selectAdjacentTask(-1);
    } else if (e.key === 'c' || e.key === 'C') {
      if (controller.uiState.selectedTaskId && App.can('tasks.write')) {
        e.preventDefault();
        controller.completeTask(controller.uiState.selectedTaskId);
      }
    } else if (e.key === 'x' || e.key === 'X') {
      // Toggle the focused task into/out of a bulk selection.
      const id = controller.uiState.selectedTaskId;
      if (id == null) return;
      e.preventDefault();
      if (!controller.uiState.bulkMode) controller.enterBulkMode(id);
      else controller.toggleBulkSelect(id);
    }
  });

  // ---- Floating quick-add button (mobile) ----
  const fab = document.getElementById('fab');
  if (fab) {
    fab.addEventListener('click', () => controller.openNewTaskModal());
    App.syncFab = () => fab.classList.toggle('hidden', !App.can('tasks.write'));
    App.syncFab();
  }

  // ---- Keyboard shortcuts help overlay (desktop) ----
  App.toggleShortcutsHelp = () => {
    if (document.getElementById('shortcutsOverlay')) { App.closeShortcutsHelp(); return; }
    const rows = [
      ['New task', 'N'], ['Focus search', '/'], ['Next task', 'J'], ['Previous task', 'K'],
      ['Complete selected', 'C'], ['Select (bulk)', 'X'], ['Clock in / out', 'T'],
      ['Close / cancel', 'Esc'], ['This help', '?'],
    ];
    const overlay = document.createElement('div');
    overlay.id = 'shortcutsOverlay';
    overlay.className = 'shortcuts-overlay';
    overlay.innerHTML = `
      <div class="shortcuts-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2><i class="ti ti-keyboard"></i> Keyboard shortcuts</h2>
        ${rows.map(([label, key]) => `<div class="shortcuts-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}
      </div>`;
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) App.closeShortcutsHelp(); });
    document.body.appendChild(overlay);
  };
  App.closeShortcutsHelp = () => {
    const o = document.getElementById('shortcutsOverlay');
    if (o) { o.remove(); return true; }
    return false;
  };

  setInterval(() => App.EventBus.emit('clock:tick'), 1000);

  window.addEventListener('beforeunload', () => {
    if (persistTimer) window.clearTimeout(persistTimer);
    doSave().catch(err => console.warn('[app] final Supabase save failed', err));
  });
});

// Merge profile display-name + avatar into the in-memory people roster.
function overlayProfilesOntoPeople() {
  const apply = (prof) => {
    if (!prof || !prof.member_id) return;
    if (!App.PEOPLE) App.PEOPLE = {};
    const person = App.PEOPLE[prof.member_id];
    if (!person) {
      // No team_members row backs this profile (member_id drift — its slug was
      // pruned or never created). Synthesize the roster entry from the profile
      // so the chosen display name resolves everywhere App.PEOPLE is read
      // (assignee chips, getUserName), not just the profile-sourced boards.
      App.PEOPLE[prof.member_id] = App.utils.personFromProfile(prof);
      return;
    }
    if (prof.full_name) {
      person.full = prof.full_name;
      person.name = prof.full_name.split(/\s+/)[0] || prof.full_name;
    }
    if (prof.avatar_url) person.avatar_url = prof.avatar_url;
  };
  (App.PROFILES || []).forEach(apply);
  apply(App.currentProfile); // own profile, even when the full list isn't loaded
}
App.overlayProfilesOntoPeople = overlayProfilesOntoPeople;

App.applyRoleChrome = applyRoleChrome;
function applyRoleChrome(controller) {
  const search = document.querySelector('.search');
  const notifWrap = document.getElementById('notifBtn') && document.getElementById('notifBtn').parentElement;
  const newTaskBtn = document.getElementById('newTaskBtn');
  const filterBtn = document.getElementById('filterBtn');
  const quickAdd = document.querySelector('.quick-add');
  const layoutSwitcher = document.getElementById('viewBtn');
  const isWorker = App.effectiveRole() === 'worker';

  if (search) search.classList.toggle('hidden', !App.can('tasks.view'));
  if (notifWrap) notifWrap.classList.toggle('hidden', !App.can('tasks.view'));
  if (newTaskBtn) newTaskBtn.classList.toggle('hidden', !App.can('tasks.write'));
  if (filterBtn) filterBtn.classList.toggle('hidden', !App.can('tasks.view'));
  if (quickAdd) quickAdd.classList.toggle('hidden', !App.can('tasks.write'));
  if (App.syncFab) App.syncFab();
  // Workers use a fixed Time | Task layout, so the table/timeline/kanban switcher is hidden.
  if (layoutSwitcher) layoutSwitcher.classList.toggle('hidden', isWorker || !App.can('tasks.view'));

  if (App.can('clock.use') && !App.can('tasks.view')) {
    controller.setView('time:mine');
  }
}

function renderRoleGate() {
  const profile = App.currentProfile || {};
  const roleLabel = (App.ROLES[profile.role] || { label: 'Member' }).label;
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0E0E10;color:#F5F1E6;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <div style="max-width:520px;background:#131315;border:1px solid #2A2A2E;border-radius:10px;padding:24px;box-shadow:0 24px 48px rgba(0,0,0,.5);">
        <div style="font-family:'Instrument Serif',serif;font-size:30px;margin-bottom:8px;">Access pending</div>
        <div style="color:#B8B2A4;line-height:1.5;">Your account is currently <strong>${App.utils.escapeHtml(roleLabel)}</strong>. An admin or construction supervisor needs to assign your role before you can use Quest HQ.</div>
        <button id="roleGateSignOut" style="margin-top:18px;padding:10px 14px;border:0;border-radius:6px;background:#E8A03A;color:#1A1208;font-weight:700;cursor:pointer;">Sign out</button>
      </div>
    </div>
  `;
  const signOutBtn = document.getElementById('roleGateSignOut');
  if (signOutBtn) signOutBtn.addEventListener('click', () => App.signOut());
}

function renderFatalDataError(err) {
  const message = App.utils.escapeHtml((err && err.message) || 'Unable to load Quest HQ data from Supabase.');
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#F6F1E8;color:#23180D;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <div style="max-width:520px;background:#FFF9EF;border:1px solid #E2D3BC;border-radius:8px;padding:22px;box-shadow:0 16px 40px rgba(46,31,17,.12);">
        <div style="font-weight:800;font-size:18px;margin-bottom:8px;">Supabase data unavailable</div>
        <div style="font-size:14px;line-height:1.5;color:#6E5B45;">${message}</div>
        <button id="fatalRetry" style="margin-top:16px;padding:10px 14px;border:0;border-radius:6px;background:#8D3F1F;color:white;font-weight:700;cursor:pointer;">Retry</button>
      </div>
    </div>
  `;
  const retryBtn = document.getElementById('fatalRetry');
  if (retryBtn) retryBtn.addEventListener('click', () => window.location.reload());
}
