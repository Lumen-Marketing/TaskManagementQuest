window.App = window.App || {};

App.NotificationModel = class NotificationModel {
  constructor() {
    this.notifications = [];
  }

  hydrate(arr) {
    this.notifications = Array.isArray(arr) ? arr : [];
  }

  all() { return this.notifications; }
  unreadCount() { return this.notifications.filter(n => !n.read).length; }
  find(id) { return this.notifications.find(n => n.id === id); }

  add({ taskId, meta, html }) {
    this.notifications.unshift({
      id: App.utils.uid('n'),
      taskId, meta, html,
      read: false,
      createdAt: new Date().toISOString(),
    });
    this.notifications = this.notifications.slice(0, 50);
    App.EventBus.emit('notifs:changed');
  }

  markRead(id) {
    const n = this.find(id);
    if (n) {
      n.read = true;
      App.EventBus.emit('notifs:changed');
    }
  }

  markAllRead() {
    this.notifications.forEach(n => n.read = true);
    App.EventBus.emit('notifs:changed');
  }
};
