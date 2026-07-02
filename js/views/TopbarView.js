window.App = window.App || {};

// Section titles shown in the redesigned topbar, keyed by controller view.
const TITLES = {
  all: 'All tasks', mine: 'My tasks', hot: 'Urgent', today: 'Today',
  overdue: 'Overdue', watching: 'Watching',
  'time:mine': 'My time', 'time:resource': 'Team workload',
  'team:hierarchy': 'Team chart', approvals: 'Approvals', 'admin:clock': 'Clock dashboard',
  'admin:task-setup': 'Task setup',
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
    this.primaryNav = document.getElementById('primaryNav');
    this.tbViews = document.getElementById('tbViews');
    this.companySwitcher = document.getElementById('companySwitcher');
    this.userChip = document.getElementById('userChip');
    this.teamMenu = null;

    this.bindEvents();
    this.bindTopbarViews();
    this.subscribe();
    this.render();
    this.paintAccountChip();
    App.EventBus.on('profile:changed', () => this.paintAccountChip());
  }

  /* The deck account chip (.uc-name / .uc-role) ships as static
     "Abraham M. / Owner · Admin" demo placeholders in app.html that nothing
     updated — so every signed-in user showed up as Abraham. Bind it to the
     real profile. (The avatar is already painted from profile.avatar_url.) */
  paintAccountChip() {
    const profile = App.currentProfile || {};
    const person = App.PEOPLE[this.currentUser] || {};
    const name = profile.full_name || person.full || person.name || 'Member';
    const roleLabel = (App.ROLES[profile.role] || { label: profile.role || 'Member' }).label;
    const nameEl = document.querySelector('.userchip .uc-name');
    const roleEl = document.querySelector('.userchip .uc-role');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = roleLabel;
  }

  bindEvents() {
    this.clockWidget.addEventListener('click', () => this.controller.toggleGlobalClock());

    // The whole account chip (avatar + name) opens the menu, not just the avatar.
    const chipTrigger = this.userChip || this.avatar;
    if (chipTrigger) {
      chipTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleUserMenu();
      });
      document.addEventListener('click', (e) => {
        if (this.userMenu && !this.userMenu.contains(e.target) && !chipTrigger.contains(e.target)) {
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
      if (this.teamMenu) this._closeTeamMenu();
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

    // Scope segment: "My work" / "Company" narrow the CURRENT task view in
    // place (Urgent stays Urgent, just mine) instead of navigating to the
    // old Mine / All views.
    if (this.scopeSeg) {
      this.scopeSeg.querySelectorAll('button[data-scope]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.controller.setScope(btn.dataset.scope);
        });
      });
    }
  }

  // The redesigned topbar shows the active section's title and a Mine/Company
  // scope segment. Both reflect the current view (no new routing concepts).
  renderTopbarTitleAndScope() {
    if (this.tbTitle) this.tbTitle.textContent = TITLES[this.controller.uiState.view] || 'Quest HQ';
    if (!this.scopeSeg) return;
    // The scope toggle now lives in the task page-head, which is only rendered on
    // task-list views — so it appears exactly when there are tasks to scope and
    // never has to be hidden mid-session. Here we just reflect the active scope
    // (its own uiState field — it no longer tracks the view).
    const scope = this.controller.uiState.scope || 'all';
    this.scopeSeg.querySelectorAll('button[data-scope]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.scope === scope);
    });
  }

  /* ---------- Primary section nav (top bar) ---------- */

  // Role-gated section list. Leaf items navigate; "Team" is a dropdown of the
  // supervisory/admin views. Mirrors the gates the sidebar used before.
  _navModel() {
    const canView = (v) => this.controller.canView(v);
    const teamItems = [];
    if (App.can('time.team'))   teamItems.push({ view: 'time:resource', label: 'Team workload', icon: 'ti-users' });
    if (App.can('team.view'))   teamItems.push({ view: 'team:hierarchy', label: 'Team chart',    icon: 'ti-sitemap' });
    if (App.can('roles.manage'))teamItems.push({ view: 'approvals',      label: 'Approvals',      icon: 'ti-user-check' });
    if (App.can('clock.admin')) teamItems.push({ view: 'admin:clock',    label: 'Clock dashboard',icon: 'ti-clock-play' });

    const items = [];
    if (canView('home')) items.push({ key: 'home', label: 'Home', view: 'home' });
    if (App.can('tasks.view')) {
      // "Tasks" is a dropdown: the full list plus the quick-filters, each with
      // its live count (counts are published by SidebarView.renderCounts).
      const vc = App.viewCounts || {};
      const taskItems = [
        { view: 'all',      label: 'All tasks', icon: 'ti-list-check' },
        { view: 'hot',      label: 'Urgent',    icon: 'ti-bolt',           count: vc.hot },
        { view: 'today',    label: 'Today',     icon: 'ti-flame',          count: vc.today },
        { view: 'overdue',  label: 'Overdue',   icon: 'ti-alert-triangle', count: vc.overdue },
        { view: 'watching', label: 'Watching',  icon: 'ti-eye',            count: vc.watching },
      ].filter(it => canView(it.view));
      items.push({ key: 'tasks', label: 'Tasks', dropdown: taskItems, matches: ['all', 'mine', 'hot', 'today', 'overdue', 'watching'] });
    }
    if (canView('projects')) items.push({ key: 'projects', label: 'Projects', view: 'projects' });
    if (teamItems.length) items.push({ key: 'team', label: 'Team', dropdown: teamItems, matches: teamItems.map(t => t.view) });
    if (App.can('reports.view')) items.push({ key: 'reports', label: 'Reports', view: 'reports' });
    return items;
  }

  renderPrimaryNav() {
    const mount = this.primaryNav;
    if (!mount) return;
    const items = this._navModel();
    const view = this.controller.uiState.view;
    const isActive = (it) => it.view === view || (it.matches && it.matches.includes(view));
    mount.innerHTML = items.map(it => {
      const active = isActive(it) ? ' active' : '';
      const caret = it.dropdown ? '<i class="ti ti-chevron-down pnav-caret" aria-hidden="true"></i>' : '';
      return `<button type="button" class="pnav-item${active}" data-nav="${App.utils.escapeHtml(it.key)}"${it.view ? ` data-view="${App.utils.escapeHtml(it.view)}"` : ''}>${App.utils.escapeHtml(it.label)}${caret}</button>`;
    }).join('');
    mount.querySelectorAll('.pnav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Re-read the model at click time so dropdown counts are current.
        const item = this._navModel().find(i => i.key === btn.dataset.nav);
        if (!item) return;
        if (item.dropdown) { e.stopPropagation(); this._toggleTeamMenu(btn, item.dropdown); }
        else this.controller.setView(item.view);
      });
    });
  }

  _toggleTeamMenu(anchor, subItems) {
    if (this.teamMenu) { this._closeTeamMenu(); return; }
    const menu = document.createElement('div');
    menu.className = 'pnav-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = subItems.map(it => {
      const count = (it.count != null && it.count > 0)
        ? `<span class="pnav-menu-count">${App.utils.escapeHtml(String(it.count))}</span>` : '';
      return `<button type="button" class="pnav-menu-item" role="menuitem" data-view="${App.utils.escapeHtml(it.view)}"><i class="ti ${it.icon}"></i><span class="pnav-menu-label">${App.utils.escapeHtml(it.label)}</span>${count}</button>`;
    }).join('');
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';
    this.teamMenu = menu;
    anchor.classList.add('open');
    menu.querySelectorAll('.pnav-menu-item').forEach(mi => {
      mi.addEventListener('click', () => { this._closeTeamMenu(); this.controller.setView(mi.dataset.view); });
    });
    this._teamMenuOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) this._closeTeamMenu(); };
    setTimeout(() => document.addEventListener('click', this._teamMenuOutside), 0);
    this._teamMenuAnchor = anchor;
  }

  _closeTeamMenu() {
    if (!this.teamMenu) return;
    this.teamMenu.remove();
    this.teamMenu = null;
    if (this._teamMenuAnchor) this._teamMenuAnchor.classList.remove('open');
    document.removeEventListener('click', this._teamMenuOutside);
  }

  /* ---------- Top-bar quick-view icons (filters + My time + Wallboard) ---------- */

  bindTopbarViews() {
    if (!this.tbViews) return;
    this.tbViews.querySelectorAll('.tb-icon[data-view]').forEach(btn => {
      btn.addEventListener('click', () => this.controller.setView(btn.dataset.view));
    });
  }

  // Gate each icon by permission and reflect the active view. Rebuilt on
  // view/role change (icons are static markup, only classes change).
  renderTopbarViews() {
    if (!this.tbViews) return;
    const view = this.controller.uiState.view;
    this.tbViews.querySelectorAll('.tb-icon[data-view]').forEach(btn => {
      btn.classList.toggle('hidden', !this.controller.canView(btn.dataset.view));
      btn.classList.toggle('active', btn.dataset.view === view);
    });
  }

  /* ---------- Workspace / company switcher ---------- */

  renderCompanySwitcher() {
    const mount = this.companySwitcher;
    if (!mount) return;
    const companies = (this.controller.uiState.companies || []);
    if (companies.length <= 1) { mount.classList.add('hidden'); mount.innerHTML = ''; return; }
    const cur = this.controller.uiState.currentCompany;
    mount.classList.remove('hidden');
    mount.innerHTML = `
      <i class="ti ti-building" aria-hidden="true"></i>
      <select id="companySelect" aria-label="Workspace">
        ${companies.map(id => {
          const label = id === '*' ? 'All companies' : (App.COMPANIES[id] || { label: id }).label;
          return `<option value="${App.utils.escapeHtml(id)}" ${id === cur ? 'selected' : ''}>${App.utils.escapeHtml(label)}</option>`;
        }).join('')}
      </select>`;
    mount.querySelector('#companySelect').addEventListener('change', (e) => this.controller.setCompany(e.target.value));
  }

  subscribe() {
    App.EventBus.on('time:changed', () => this.renderClockWidget());
    App.EventBus.on('tasks:changed', () => this.renderClockWidget()); // task title may change
    App.EventBus.on('notifs:changed', () => this.renderNotifs());
    App.EventBus.on('notifs:refreshed', () => this.renderNotifs());
    App.EventBus.on('clock:tick', () => this.tickLive());
    App.EventBus.on('role:changed', () => { this.renderPrimaryNav(); this.renderTopbarViews(); this.renderCompanySwitcher(); });
    App.EventBus.on('view:changed', () => { this._closeTeamMenu(); this.renderTopbarTitleAndScope(); this.renderPrimaryNav(); this.renderTopbarViews(); });
    App.EventBus.on('scope:changed', () => this.renderTopbarTitleAndScope());
    App.EventBus.on('company:changed', () => this.renderCompanySwitcher());
  }

  render() {
    this.renderClockWidget();
    this.renderNotifs();
    this.renderPrimaryNav();
    this.renderTopbarViews();
    this.renderCompanySwitcher();
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

    // Developer-only "View as" role preview, relocated here from the top bar.
    const isDev = App.realRole() === 'developer';
    const viewAsHtml = isDev ? `
      <div class="user-menu-section">
        <div class="field-label" style="margin-bottom:6px;">View as</div>
        <select id="menuViewAs" class="user-menu-select" aria-label="Preview as role">
          ${[['developer', 'Developer (you)'], ['admin', 'Admin'], ['supervisor', 'Supervisor'], ['worker', 'Worker']]
            .map(([v, l]) => `<option value="${v}" ${(App.viewAsRole || 'developer') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>` : '';

    // Workspace / company switcher, relocated here from the top bar. Only shown
    // when the member belongs to more than one workspace.
    const companies = this.controller.uiState.companies || [];
    const curCompany = this.controller.uiState.currentCompany;
    const workspaceHtml = companies.length > 1 ? `
      <div class="user-menu-section">
        <div class="field-label" style="margin-bottom:6px;">Workspace</div>
        <select id="menuCompany" class="user-menu-select" aria-label="Workspace">
          ${companies.map(id => {
            const label = id === '*' ? 'All companies' : (App.COMPANIES[id] || { label: id }).label;
            return `<option value="${App.utils.escapeHtml(id)}" ${id === curCompany ? 'selected' : ''}>${App.utils.escapeHtml(label)}</option>`;
          }).join('')}
        </select>
      </div>` : '';

    // "My time" moved off the top bar into the account menu (gated by view perm).
    const myTimeHtml = this.controller.canView('time:mine')
      ? `<div class="user-menu-item" data-action="my-time"><i class="ti ti-clock"></i>My time</div>` : '';

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
      ${workspaceHtml}
      ${viewAsHtml}
      ${myTimeHtml}
      <div class="user-menu-item" data-action="scale"><i class="ti ti-zoom-scan"></i>Display size</div>
      <div class="user-menu-item" data-action="edit-profile"><i class="ti ti-user-edit"></i>Edit profile</div>
      <div class="user-menu-item" data-action="show-tour"><i class="ti ti-help"></i>Show tour again</div>
      <div class="user-menu-item" data-action="sign-out"><i class="ti ti-logout"></i>Sign out</div>
    `;
    document.body.appendChild(menu);

    // The account chip lives in the top bar (top-right), so drop the menu down
    // from it, right-aligned to the chip so it never runs off-screen.
    const anchor = this.userChip || this.avatar;
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    menu.style.bottom = 'auto';

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
    // Display size: open the scale popover anchored to the account chip (the
    // menu item is gone after close, so anchor to the persistent chip).
    menu.querySelector('[data-action="scale"]').addEventListener('click', () => {
      const anchorEl = this.userChip || this.avatar;
      this.closeUserMenu();
      if (App.uiScale) App.uiScale.openAt(anchorEl);
    });
    // Workspace / company switch.
    const companySel = menu.querySelector('#menuCompany');
    if (companySel) {
      companySel.addEventListener('click', (e) => e.stopPropagation());
      companySel.addEventListener('change', (e) => {
        this.closeUserMenu();
        this.controller.setCompany(e.target.value);
      });
    }
    // "My time" navigates to the personal time view.
    const myTimeItem = menu.querySelector('[data-action="my-time"]');
    if (myTimeItem) myTimeItem.addEventListener('click', () => {
      this.closeUserMenu();
      this.controller.setView('time:mine');
    });
    // Developer "View as" role preview.
    const viewAsSel = menu.querySelector('#menuViewAs');
    if (viewAsSel) {
      viewAsSel.addEventListener('click', (e) => e.stopPropagation());
      viewAsSel.addEventListener('change', (e) => {
        this.closeUserMenu();
        this.controller.setViewAs(e.target.value);
      });
    }
    menu.querySelectorAll('[data-theme-set]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.themeSet;
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('questhq:theme', next); } catch (e) {}
        // Sync the PWA / mobile chrome band to the chosen theme.
        try {
          const m = document.querySelector('meta[name="theme-color"]');
          if (m) m.setAttribute('content', next === 'dark' ? '#08090A' : '#FBFAF8');
        } catch (e) {}
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
