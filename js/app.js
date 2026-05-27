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
  const dataStore = new App.SupabaseDataStore({
    supabase: App.supabase,
    currentUser: App.CURRENT_USER,
    role: App.currentProfile.role || 'member',
  });

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

  const controller = new App.AppController({
    taskModel,
    timeModel,
    notifModel,
    currentUser: App.CURRENT_USER,
    dataStore,
  });

  const toastView = new App.ToastView('toastContainer');
  const newTaskModal = new App.NewTaskModalView({ controller, currentUser: App.CURRENT_USER });
  controller.attachViews({ toastView, newTaskModal });

  new App.TopbarView({ timeModel, notifModel, controller, currentUser: App.CURRENT_USER });
  new App.SidebarView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskListView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskDetailView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TimeView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.ApprovalView({ controller, dataStore });

  applyRoleChrome(controller);

  let persistTimer = null;
  const persist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(async () => {
      try {
        await dataStore.save({
          tasks: taskModel.all(),
          timeEntries: timeModel.entries,
          activeTimers: timeModel.activeTimers,
          notifications: notifModel.all(),
        });
      } catch (err) {
        console.error('[app] Supabase save failed', err);
        if (controller.toastView) {
          controller.toastView.show({
            title: 'Supabase save failed',
            sub: (err && err.message) || 'Refresh and try again.',
          });
        }
      }
    }, 350);
  };
  const persistNow = async () => {
    await dataStore.save({
      tasks: taskModel.all(),
      timeEntries: timeModel.entries,
      activeTimers: timeModel.activeTimers,
      notifications: notifModel.all(),
    });
  };
  App.EventBus.on('tasks:changed', persist);
  App.EventBus.on('time:changed', persist);
  App.EventBus.on('notifs:changed', persist);

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
    persistNow().catch(err => console.warn('[app] final Supabase save failed', err));
  });
});

function applyRoleChrome(controller) {
  const search = document.querySelector('.search');
  const notifWrap = document.getElementById('notifBtn') && document.getElementById('notifBtn').parentElement;
  const newTaskBtn = document.getElementById('newTaskBtn');
  const filterBtn = document.getElementById('filterBtn');
  const quickAdd = document.querySelector('.quick-add');

  if (search) search.classList.toggle('hidden', !App.can('tasks.view'));
  if (notifWrap) notifWrap.classList.toggle('hidden', !App.can('tasks.view'));
  if (newTaskBtn) newTaskBtn.classList.toggle('hidden', !App.can('tasks.write'));
  if (filterBtn) filterBtn.classList.toggle('hidden', !App.can('tasks.view'));
  if (quickAdd) quickAdd.classList.toggle('hidden', !App.can('tasks.write'));

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
