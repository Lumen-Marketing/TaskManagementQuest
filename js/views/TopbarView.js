window.App = window.App || {};

App.TopbarView = class TopbarView {
  constructor({ timeModel, notifModel, controller, currentUser }) {
    this.timeModel = timeModel;
    this.notifModel = notifModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.clockWidget = document.getElementById('clockWidget');
    this.clockLabel = document.getElementById('clockLabel');
    this.clockTimer = document.getElementById('clockTimer');
    this.clockIcon = this.clockWidget.querySelector('i');

    this.notifBtn = document.getElementById('notifBtn');
    this.notifPanel = document.getElementById('notifPanel');
    this.notifDot = document.getElementById('notifDot');
    this.notifList = document.getElementById('notifList');
    this.markAllReadBtn = document.getElementById('markAllRead');

    this.searchInput = document.getElementById('searchInput');

    this.bindEvents();
    this.subscribe();
    this.render();
  }

  bindEvents() {
    this.clockWidget.addEventListener('click', () => this.controller.toggleGlobalClock());

    this.notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.notifPanel.classList.toggle('hidden');
    });
    this.markAllReadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.controller.markAllNotifsRead();
    });
    document.addEventListener('click', (e) => {
      if (!this.notifPanel.contains(e.target) && !this.notifBtn.contains(e.target)) {
        this.notifPanel.classList.add('hidden');
      }
    });

    this.searchInput.addEventListener('input', (e) => {
      this.controller.setSearchQuery(e.target.value);
    });
  }

  subscribe() {
    App.EventBus.on('time:changed', () => this.renderClockWidget());
    App.EventBus.on('tasks:changed', () => this.renderClockWidget()); // task title may change
    App.EventBus.on('notifs:changed', () => this.renderNotifs());
    App.EventBus.on('clock:tick', () => this.tickLive());
  }

  render() {
    this.renderClockWidget();
    this.renderNotifs();
  }

  renderClockWidget() {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active) {
      const task = this.controller.getTask(active.taskId);
      this.clockWidget.classList.add('running');
      this.clockLabel.textContent = task ? (task.title.slice(0, 18) + (task.title.length > 18 ? '…' : '')) : 'Tracking';
      this.clockTimer.classList.remove('hidden');
      this.clockTimer.textContent = App.utils.formatDuration(Date.now() - active.startedAt);
      this.clockIcon.className = 'ti ti-player-stop-filled';
    } else {
      this.clockWidget.classList.remove('running');
      this.clockLabel.textContent = 'Clock in';
      this.clockTimer.classList.add('hidden');
      this.clockIcon.className = 'ti ti-player-play-filled';
    }
  }

  tickLive() {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active && !this.clockTimer.classList.contains('hidden')) {
      this.clockTimer.textContent = App.utils.formatDuration(Date.now() - active.startedAt);
    }
  }

  renderNotifs() {
    const unread = this.notifModel.unreadCount();
    this.notifDot.classList.toggle('hidden', unread === 0);

    const all = this.notifModel.all();
    if (all.length === 0) {
      this.notifList.innerHTML = `<div class="notif-empty">You're all caught up.</div>`;
      return;
    }
    this.notifList.innerHTML = all.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}" data-task-id="${n.taskId || ''}">
        <div class="notif-meta">${App.utils.escapeHtml(n.meta)}</div>
        <div class="notif-text">${n.html}</div>
      </div>
    `).join('');

    this.notifList.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const notifId = item.dataset.notifId;
        const taskId = item.dataset.taskId;
        this.notifPanel.classList.add('hidden');
        this.controller.openNotification(notifId, taskId);
      });
    });
  }
};
