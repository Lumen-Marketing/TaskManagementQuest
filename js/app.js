/* Bootstrap — wires the three layers together.
   1. Construct models, hydrate from Store
   2. Construct controller
   3. Construct views (they subscribe to events themselves)
   4. Persist on any model change
   5. Start the 1-second clock tick */
document.addEventListener('DOMContentLoaded', () => {
  const store = new App.Store(App.STORAGE_KEY);

  const taskModel = new App.TaskModel();
  const timeModel = new App.TimeModel();
  const notifModel = new App.NotificationModel();

  const saved = store.load();
  if (saved) {
    taskModel.hydrate(saved.tasks && saved.tasks.length ? saved.tasks : null);
    if (!saved.tasks || !saved.tasks.length) taskModel.seedDefaults();
    timeModel.hydrate(saved.timeEntries, saved.activeTimers);
    if (!saved.timeEntries || !saved.timeEntries.length) timeModel.seedDefaults();
    notifModel.hydrate(saved.notifications);
  } else {
    taskModel.seedDefaults();
    timeModel.seedDefaults();
  }

  const controller = new App.AppController({
    taskModel, timeModel, notifModel,
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

  // Persist on any model change
  const persist = () => {
    store.save({
      tasks: taskModel.all(),
      timeEntries: timeModel.entries,
      activeTimers: timeModel.activeTimers,
      notifications: notifModel.all(),
    });
  };
  App.EventBus.on('tasks:changed', persist);
  App.EventBus.on('time:changed', persist);
  App.EventBus.on('notifs:changed', persist);

  // Global hotkeys
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

  // Live clock tick — broadcast every second; views update their own live elements
  setInterval(() => App.EventBus.emit('clock:tick'), 1000);
});
