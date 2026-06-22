window.App = window.App || {};

// Section titles shown in the redesigned topbar, keyed by controller view.
const TITLES = {
  all: 'All tasks', mine: 'My tasks', hot: 'Urgent', today: 'Today',
  overdue: 'Overdue', watching: 'Watching',
  'time:mine': 'My time', 'time:resource': 'Team workload',
  'team:hierarchy': 'Team chart', approvals: 'Approvals', 'admin:clock': 'Clock dashboard',
  home: 'Home', reports: 'Reports',
};

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
    this.viewAsSwitcher = document.getElementById('viewAsSwitcher');
    this.avatar = document.getElementById('userAvatar');
    this.userMenu = null;

    this.tbTitle = document.getElementById('tbTitle');
    this.scopeSeg = document.getElementById('scopeSeg');

    this.bindEvents();
    this.subscribe();
    this.render();
  }

  bindEvents() {
    this.clockWidget.addEventListener('click', () => this.controller.toggleGlobalClock());

    if (this.avatar) {
      this.avatar.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleUserMenu();
      });
      document.addEventListener('click', (e) => {
        if (this.userMenu && !this.userMenu.contains(e.target) && e.target !== this.avatar) {
          this.closeUserMenu();
        }
      });
    }

    this.notifBtn.setAttribute('aria-haspopup', 'menu');
    this.notifBtn.setAttribute('aria-expanded', 'false');
    this.notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !this.notifPanel.classList.toggle('hidden');
      this.notifBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        const first = this.notifList.querySelector('.notif-item');
        if (first) first.focus();
      }
    });
    this.markAllReadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.controller.markAllNotifsRead();
    });
    document.addEventListener('click', (e) => {
      if (!this.notifPanel.contains(e.target) && !this.notifBtn.contains(e.target)) {
        this.notifPanel.classList.add('hidden');
        this.notifBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Esc closes whichever topbar popover is open and returns focus to its trigger.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.userMenu) { this.closeUserMenu(); if (this.avatar) this.avatar.focus(); }
      if (!this.notifPanel.classList.contains('hidden')) {
        this.notifPanel.classList.add('hidden');
        this.notifBtn.setAttribute('aria-expanded', 'false');
        this.notifBtn.focus();
      }
    });

    this.searchInput.addEventListener('input', (e) => {
      this.controller.setSearchQuery(e.target.value);
    });

    // Scope segment: "My work" / "Company" map to the existing Mine / All views.
    if (this.scopeSeg) {
      this.scopeSeg.querySelectorAll('button[data-scope]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.controller.setView(btn.dataset.scope);
        });
      });
    }
  }

  // The redesigned topbar shows the active section's title and a Mine/Company
  // scope segment. Both reflect the current view (no new routing concepts).
  renderTopbarTitleAndScope() {
    const view = this.controller.uiState.view;
    if (this.tbTitle) this.tbTitle.textContent = TITLES[view] || 'Quest HQ';
    if (this.scopeSeg) {
      this.scopeSeg.querySelectorAll('button[data-scope]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.scope === view);
      });
    }
  }

  subscribe() {
    App.EventBus.on('time:changed', () => this.renderClockWidget());
    App.EventBus.on('tasks:changed', () => this.renderClockWidget()); // task title may change
    App.EventBus.on('notifs:changed', () => this.renderNotifs());
    App.EventBus.on('notifs:refreshed', () => this.renderNotifs());
    App.EventBus.on('clock:tick', () => this.tickLive());
    App.EventBus.on('role:changed', () => this.renderViewAsSwitcher());
    App.EventBus.on('view:changed', () => this.renderTopbarTitleAndScope());
  }

  render() {
    this.renderClockWidget();
    this.renderNotifs();
    this.renderViewAsSwitcher();
    this.renderTopbarTitleAndScope();
  }

  // Developer-only: preview the app as another role. Shown only to real
  // developers (uses realRole so it never hides itself while previewing).
  renderViewAsSwitcher() {
    const mount = this.viewAsSwitcher;
    if (!mount) return;
    if (App.realRole() !== 'developer') {
      mount.classList.add('hidden');
      mount.innerHTML = '';
      return;
    }
    const current = App.viewAsRole || 'developer';
    const active = !!App.viewAsRole;
    mount.classList.remove('hidden');
    mount.classList.toggle('active', active);
    const opts = [
      ['developer', 'Developer (you)'],
      ['admin', 'Admin'],
      ['supervisor', 'Supervisor'],
      ['worker', 'Worker'],
    ];
    mount.innerHTML = `
      <i class="ti ti-eye"></i>
      <span class="viewas-label">View as</span>
      <select id="viewAsSelect" aria-label="Preview as role">
        ${opts.map(([val, label]) =>
          `<option value="${val}" ${val === current ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`;
    mount.querySelector('#viewAsSelect').addEventListener('change', (e) => {
      this.controller.setViewAs(e.target.value);
    });
  }


  renderClockWidget() {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active) {
      const task = this.controller.getTask(active.taskId);
      // Running state shows only the timer — the task title lives on the tooltip
      // (and in the Up-next card) so the pill keeps a fixed width and the topbar
      // never reflows when you clock in/out.
      this.clockWidget.classList.add('running');
      this.clockLabel.classList.add('hidden');
      this.clockTimer.classList.remove('hidden');
      this.clockTimer.textContent = App.utils.formatDuration(this._liveShiftMs(active));
      this.clockIcon.className = 'ti ti-player-stop-filled';
      this.clockWidget.title = task ? `Tracking: ${task.title} — tap to clock out` : 'Tap to clock out';
    } else {
      this.clockWidget.classList.remove('running');
      this.clockLabel.classList.remove('hidden');
      this.clockLabel.textContent = 'Clock in';
      this.clockTimer.classList.add('hidden');
      this.clockIcon.className = 'ti ti-player-play-filled';
      this.clockWidget.title = 'Clock in / out';
    }
  }

  // Total time on the *currently tracked task* so far today (logged sessions +
  // the live one), so the clock resumes its running total when you switch back
  // to a task — e.g. General shift continues from 2h instead of restarting at 0.
  _liveShiftMs(active) {
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    return this.timeModel.sessionTotalForUserTask(this.currentUser, active.taskId, day0.getTime());
  }

  tickLive() {
    const active = this.timeModel.activeFor(this.currentUser);
    if (active && !this.clockTimer.classList.contains('hidden')) {
      this.clockTimer.textContent = App.utils.formatDuration(this._liveShiftMs(active));
    }
  }

  renderNotifs() {
    const unread = this.notifModel.unreadCount();
    this.notifDot.classList.toggle('hidden', unread === 0);
    // Show the unread count inside the badge so it's actually noticeable.
    // Cap at 99+ to keep the pill from blowing out the bell icon.
    this.notifDot.textContent = unread === 0 ? '' : (unread > 99 ? '99+' : String(unread));

    const all = this.notifModel.all();
    if (all.length === 0) {
      this.notifList.innerHTML = `<div class="notif-empty">You're all caught up.</div>`;
      return;
    }
    this.notifList.innerHTML = all.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${App.utils.escapeHtml(n.id)}" data-task-id="${App.utils.escapeHtml(n.taskId || '')}">
        <div class="notif-meta">${App.utils.escapeHtml(App.utils.notifMeta(n.meta, n.createdAt))}</div>
        <div class="notif-text">${App.utils.sanitizeNotificationHtml(n.html)}</div>
      </div>
    `).join('');

    this.notifList.querySelectorAll('.notif-item').forEach(item => {
      App.utils.makeActivatable(item);
      item.addEventListener('click', () => {
        const notifId = item.dataset.notifId;
        const taskId = item.dataset.taskId;
        this.notifPanel.classList.add('hidden');
        this.notifBtn.setAttribute('aria-expanded', 'false');
        this.controller.openNotification(notifId, taskId);
      });
    });
  }

  toggleUserMenu() {
    if (this.userMenu) { this.closeUserMenu(); return; }
    const person = App.PEOPLE[this.currentUser] || {};
    const profile = App.currentProfile || {};
    const currentName = person.full || profile.full_name || person.name || '';
    const roleLabel = (App.ROLES[profile.role] || { label: profile.role || 'Member' }).label;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    const menu = document.createElement('div');
    menu.className = 'user-menu';
    menu.innerHTML = `
      <div class="user-menu-head">
        <div class="user-menu-name">${App.utils.escapeHtml(currentName)}</div>
        <div class="user-menu-meta">${App.utils.escapeHtml(profile.email || '')} · ${App.utils.escapeHtml(roleLabel)}</div>
      </div>
      <div class="user-menu-section">
        <div class="field-label" style="margin-bottom:6px;">Theme</div>
        <div class="theme-toggle" role="group" aria-label="Theme">
          <button class="theme-opt ${currentTheme === 'dark' ? 'active' : ''}" data-theme-set="dark" aria-pressed="${currentTheme === 'dark'}"><i class="ti ti-moon"></i>Dark</button>
          <button class="theme-opt ${currentTheme === 'light' ? 'active' : ''}" data-theme-set="light" aria-pressed="${currentTheme === 'light'}"><i class="ti ti-sun"></i>Light</button>
        </div>
      </div>
      <div class="user-menu-item" data-action="edit-profile"><i class="ti ti-user-edit"></i>Edit profile</div>
      <div class="user-menu-item" data-action="show-tour"><i class="ti ti-help"></i>Show tour again</div>
      <div class="user-menu-item" data-action="sign-out"><i class="ti ti-logout"></i>Sign out</div>
    `;
    document.body.appendChild(menu);

    // The avatar lives in the sidebar footer (bottom-left), so anchor the menu
    // above it and aligned to its left edge instead of dropping down-right.
    const rect = this.avatar.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.right = 'auto';

    this.userMenu = menu;

    menu.querySelector('[data-action="edit-profile"]').addEventListener('click', () => {
      this.closeUserMenu();
      if (this.controller && this.controller.openProfile) this.controller.openProfile();
    });
    menu.querySelector('[data-action="show-tour"]').addEventListener('click', () => {
      this.closeUserMenu();
      if (App.startTour) App.startTour();
    });
    menu.querySelector('[data-action="sign-out"]').addEventListener('click', () => {
      this.closeUserMenu();
      if (App.signOut) App.signOut();
    });
    menu.querySelectorAll('[data-theme-set]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.themeSet;
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('questhq:theme', next); } catch (e) {}
        menu.querySelectorAll('[data-theme-set]').forEach(b => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    });

    // Keyboard/AT: expose the menu + items and pull focus into it on open.
    menu.setAttribute('role', 'menu');
    menu.querySelectorAll('.user-menu-item').forEach(it => {
      it.setAttribute('role', 'menuitem');
      it.setAttribute('tabindex', '0');
      it.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); it.click(); }
      });
    });
    if (this.avatar) this.avatar.setAttribute('aria-expanded', 'true');
    const firstItem = menu.querySelector('.user-menu-item');
    if (firstItem) firstItem.focus();
  }

  closeUserMenu() {
    if (!this.userMenu) return;
    this.userMenu.remove();
    this.userMenu = null;
    if (this.avatar) this.avatar.setAttribute('aria-expanded', 'false');
  }
};
