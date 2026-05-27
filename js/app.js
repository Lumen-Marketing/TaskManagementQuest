/* Bootstrap - wires the three layers together.
   1. Construct models, hydrate from Supabase
   2. Construct controller
   3. Construct views
   4. Persist to Supabase on any model change
   5. Start the 1-second clock tick */
document.addEventListener('DOMContentLoaded', async () => {
  const taskModel = new App.TaskModel();
  const timeModel = new App.TimeModel();
  const notifModel = new App.NotificationModel();
  const dataStore = new App.SupabaseDataStore({
    supabase: App.supabase,
    currentUser: App.CURRENT_USER,
  });

  try {
    const saved = await dataStore.load();
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
  });

  const toastView = new App.ToastView('toastContainer');
  const newTaskModal = new App.NewTaskModalView({ controller, currentUser: App.CURRENT_USER });
  controller.attachViews({ toastView, newTaskModal });

  new App.TopbarView({ timeModel, notifModel, controller, currentUser: App.CURRENT_USER });
  new App.SidebarView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskListView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TaskDetailView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });
  new App.TimeView({ taskModel, timeModel, controller, currentUser: App.CURRENT_USER });

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
