window.App = window.App || {};

App.SidebarView = class SidebarView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.deck = document.querySelector('.deck');
    this.extraMount = document.getElementById('sideExtraGroups');
    // The dedicated minimize button was removed; the brand logo is the toggle.
    this.brandLogo = document.querySelector('.side-brand .logo');

    this.SECTION_KEY  = 'questhq:sidebar-collapsed-sections';
    this.MINIMIZE_KEY = 'questhq:sidebar-minimized';
    this.collapsed   = this._loadCollapsed();

    this.applyRoleVisibility();
    this.bindStaticItems();
    this.bindAskQuest();
    this.bindMinimize();
    this.applyStoredMinimize();
    this.subscribe();
    this.renderExtraGroups();
    this.renderCounts();
  }

  bindStaticItems() {
    // Attach click handlers once to every static item; visibility is applied
    // separately so it can be re-evaluated when a developer switches view-as.
    document.querySelectorAll('.side-item[data-view]').forEach(el => {
      this._makeActivatable(el, () => this.controller.setView(el.dataset.view));
    });
    this.applyStaticVisibility();
  }

  /* The sidebar items are <div>s (not <button>s) for layout reasons, so they
     aren't keyboard-reachable by default. Promote each to a focusable button
     for screen-reader / keyboard users: Tab to reach it, Enter/Space to fire
     the same action a click would. */
  _makeActivatable(el, handler) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handler();
      }
    });
  }

  // The sidebar "Ask Quest" bar is a styled entry point to the existing search —
  // clicking it focuses the topbar search input (no new AI surface).
  bindAskQuest() {
    const ask = document.getElementById('askQuestBtn');
    if (!ask) return;
    ask.addEventListener('click', () => {
      const search = document.getElementById('searchInput');
      if (search) { search.focus(); search.select(); }
    });
  }

  applyStaticVisibility() {
    // Watching now shows "Tasks you're watching" (relevant to every role), with
    // the direct-reports dashboard only added when you actually have reports —
    // so it's visible for workers/sales too, gated purely by canView.
    document.querySelectorAll('.side-item[data-view]').forEach(el => {
      const view = el.dataset.view;
      el.classList.toggle('hidden', !this.controller.canView(view));
    });
  }

  applyRoleVisibility() {
    const viewsGroup = document.querySelector('.grp-views');
    if (viewsGroup) viewsGroup.classList.toggle('hidden', !App.can('tasks.view'));
  }

  // Re-gate the whole sidebar after a developer switches the previewed role.
  refreshForRole() {
    this.applyRoleVisibility();
    this.applyStaticVisibility();
    this.renderExtraGroups();
    this.renderCounts();
  }

  /* ---------- Minimize / expand ---------- */

  bindMinimize() {
    // Minimize/expand is triggered by clicking the brand logo (the separate
    // toggle button was removed). Desktop only — on mobile the sidebar is a
    // slide-in drawer, so the logo opens/closes that instead (handled below).
    if (this.brandLogo) {
      this.brandLogo.style.cursor = 'pointer';
      this._makeActivatable(this.brandLogo, () => {
        if (this._isMobile()) this._toggleMobileDrawer();
        else this.toggleMinimize();
      });
    }
    // The brand now lives in the sidebar (with its own minimize button), so the
    // topbar-left holds the title + scope segment. Tapping it only opens the
    // mobile drawer; on desktop it does nothing (clicking the title/segment must
    // not collapse the sidebar).
    const topLeft = document.querySelector('.topbar-left');
    if (topLeft) {
      topLeft.addEventListener('click', (e) => {
        if (!this._isMobile()) return;
        // Don't hijack taps on the interactive segment buttons.
        if (e.target.closest('.seg')) return;
        this._toggleMobileDrawer();
      });
      this._injectMobileMenuHint(topLeft);
    }
    this._setupMobileDrawer();
  }

  applyStoredMinimize() {
    // On phones the sidebar renders as a slide-in drawer (open or closed);
    // the desktop "icon-strip" minimize state has no meaning there.
    if (this._isMobile()) { this._setMinimized(false); return; }
    const stored = localStorage.getItem(this.MINIMIZE_KEY) === '1';
    this._setMinimized(stored);
  }

  _isMobile() {
    return window.matchMedia('(max-width: 720px)').matches;
  }

  _setupMobileDrawer() {
    if (!document.querySelector('.sidebar-backdrop')) {
      const bd = document.createElement('div');
      bd.className = 'sidebar-backdrop';
      bd.addEventListener('click', () => this._closeMobileDrawer());
      document.body.appendChild(bd);
    }
    // Tapping any nav item should dismiss the drawer on mobile.
    document.addEventListener('click', (e) => {
      if (!this._isMobile()) return;
      if (!document.body.classList.contains('sidebar-open')) return;
      if (e.target.closest('.side-item')) this._closeMobileDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
        this._closeMobileDrawer();
      }
    });
    // Crossing the mobile breakpoint: reset minimize state and close drawer.
    const mq = window.matchMedia('(max-width: 720px)');
    mq.addEventListener('change', (e) => {
      this._closeMobileDrawer();
      if (e.matches) {
        this._setMinimized(false);
      } else {
        this._setMinimized(localStorage.getItem(this.MINIMIZE_KEY) === '1');
      }
    });
  }

  _toggleMobileDrawer() {
    if (document.body.classList.contains('sidebar-open')) this._closeMobileDrawer();
    else this._openMobileDrawer();
  }

  _openMobileDrawer()  { document.body.classList.add('sidebar-open'); }
  _closeMobileDrawer() { document.body.classList.remove('sidebar-open'); }

  _injectMobileMenuHint(topLeft) {
    if (topLeft.querySelector('.mobile-menu-hint')) return;
    const hint = document.createElement('i');
    hint.className = 'ti ti-menu-2 mobile-menu-hint';
    hint.setAttribute('aria-hidden', 'true');
    topLeft.appendChild(hint);
  }

  toggleMinimize() {
    const next = !this.deck.classList.contains('minimized');
    this._setMinimized(next);
    try { localStorage.setItem(this.MINIMIZE_KEY, next ? '1' : '0'); } catch (e) {}
  }

  _setMinimized(min) {
    if (!this.deck) return;
    this.deck.classList.toggle('minimized', min);
    document.body.classList.toggle('sidebar-minimized', min);
    if (this.brandLogo) {
      const label = min ? 'Expand sidebar' : 'Collapse sidebar';
      this.brandLogo.title = label;
      this.brandLogo.setAttribute('aria-label', label);
    }
  }

  /* ---------- Extra sections (Company / Time / Org / Admin) ----------
     Rendered inline as collapsible groups directly in the sidebar — no
     dropdown. Each section's collapsed state persists per-user. */

  renderExtraGroups() {
    if (!this.extraMount) return;
    const sections = this._buildSections();
    this.extraMount.innerHTML = sections.map(sec => this._renderSection(sec)).join('');

    this.extraMount.querySelectorAll('.side-group-head').forEach(head => {
      const key = head.dataset.section;
      head.addEventListener('click', () => this._toggleSection(key));
    });
    this.extraMount.querySelectorAll('.side-item[data-view]').forEach(el => {
      this._makeActivatable(el, () => this.controller.setView(el.dataset.view));
    });
    this.extraMount.querySelectorAll('.side-item[data-company]').forEach(el => {
      this._makeActivatable(el, () => this.controller.setCompany(el.dataset.company));
    });
  }

  _buildSections() {
    const sections = [];

    // "Team" groups personal time + the supervisory/admin tools under one header
    // to match the redesigned sidebar (Personal / Team / Workspaces). Each item
    // keeps its own permission gate, so the section collapses to whatever the
    // role can actually see (workers get just "My time").
    const teamItems = [];
    if (App.can('time.own') || App.can('clock.use')) {
      teamItems.push({ view: 'time:mine', label: 'My time', icon: 'ti-clock', count: App.utils.formatHours(this.timeModel.totalForUser(this.currentUser)) });
    }
    if (App.can('time.team')) {
      teamItems.push({ view: 'time:resource', label: 'Team workload', icon: 'ti-users', count: this.timeModel.allActive().length });
    }
    if (App.can('team.view')) {
      teamItems.push({ view: 'team:hierarchy', label: 'Team chart', icon: 'ti-sitemap' });
    }
    if (App.can('reports.view')) teamItems.push({ view: 'reports', label: 'Reports', icon: 'ti-chart-bar' });
    if (App.can('roles.manage')) teamItems.push({ view: 'approvals',   label: 'Approvals',       icon: 'ti-user-check' });
    if (App.can('clock.admin'))  teamItems.push({ view: 'admin:clock', label: 'Clock dashboard', icon: 'ti-clock-play', count: this.timeModel.allActive().length });
    if (App.can('task-setup.manage')) teamItems.push({ view: 'admin:task-setup', label: 'Task setup', icon: 'ti-adjustments' });
    if (teamItems.length) sections.push({ key: 'team', label: 'Team', items: teamItems });

    // Company context lives in the sidebar: a single-select list of the
    // companies this user can access (plus "All companies" for developers).
    // Picking one re-scopes the whole app via controller.setCompany. Shown
    // only when there's more than one choice.
    // "All companies" (*) is offered to any multi-company user (the controller
    // only puts '*' in the list for them), so it shows for every role now.
    const companies = (this.controller.uiState.companies || []);
    if (companies.length > 1) {
      const cur = this.controller.uiState.currentCompany;
      const dotMap = { roofing: 'dot-roof', drafting: 'dot-draft', lumen: 'dot-lumen' };
      sections.push({
        key: 'company', label: 'Workspaces',
        items: companies.map(id => ({
          company: id,
          label: id === '*' ? 'All companies' : (App.COMPANIES[id] || { label: id }).label,
          dot: id === '*' ? null : dotMap[id],
          icon: id === '*' ? 'ti-building' : null,
          active: id === cur,
        })),
      });
    }

    return sections;
  }

  _renderSection(sec) {
    const collapsed = this.collapsed.has(sec.key);
    const itemsHtml = sec.items.map(it => {
      // Company items drive the company context (data-company + setCompany);
      // everything else navigates to a view (data-view + setView).
      const isCompany = it.company != null;
      const attr = isCompany
        ? `data-company="${App.utils.escapeHtml(it.company)}"`
        : `data-view="${App.utils.escapeHtml(it.view)}"`;
      const activeCls = (isCompany && it.active) ? ' active' : '';
      return `
      <div class="side-item${activeCls}" ${attr} title="${App.utils.escapeHtml(it.label)}">
        ${it.dot ? `<span class="dot-co ${it.dot}"></span>` : `<i class="ti ${it.icon || 'ti-circle'}"></i>`}
        <span class="side-item-label">${App.utils.escapeHtml(it.label)}</span>
        ${it.count != null ? `<span class="side-count">${App.utils.escapeHtml(String(it.count))}</span>` : ''}
      </div>`;
    }).join('');

    return `
      <div class="side-group side-group-collapsible ${collapsed ? 'collapsed' : ''}" data-section="${sec.key}">
        <button class="side-group-head" data-section="${sec.key}">
          <span class="side-label">${App.utils.escapeHtml(sec.label)}</span>
          <i class="ti ti-chevron-down side-group-chevron"></i>
        </button>
        <div class="side-group-body">${itemsHtml}</div>
      </div>
    `;
  }

  _toggleSection(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this._saveCollapsed();
    const group = this.extraMount.querySelector(`.side-group[data-section="${key}"]`);
    if (group) group.classList.toggle('collapsed', this.collapsed.has(key));
  }

  _loadCollapsed() {
    try {
      const raw = localStorage.getItem(this.SECTION_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { return new Set(); }
  }

  _saveCollapsed() {
    try { localStorage.setItem(this.SECTION_KEY, JSON.stringify([...this.collapsed])); } catch (e) {}
  }

  /* ---------- counts ---------- */

  // The set of tasks this user can actually see right now (active company +
  // role row-scope), so sidebar badges match the task list. Mirrors the
  // scoping in TaskModel.getFiltered / migration 028.
  _scopedActiveTasks() {
    const role = App.effectiveRole();
    const cur = this.controller.uiState.currentCompany;
    const me = (App.currentProfile && App.currentProfile.member_id) || this.currentUser;
    const clockId = App.DEFAULT_CLOCK_TASK_ID;
    let base = this.taskModel.all().filter(t => !App.taxonomy.isDone(t) && !t.clearedAt);
    if (cur && cur !== '*') {
      base = base.filter(t => t.company === cur || t.id === clockId);
    }
    if (role === 'worker') {
      base = base.filter(t => t.assignee === this.currentUser || t.creator === this.currentUser || t.id === clockId);
    } else if (role === 'supervisor' && App.realRole() !== 'developer') {
      // Real supervisor: narrow to their direct reports. A developer previewing
      // as supervisor sees the whole selected company's team (no narrowing).
      const reports = new Set((App.PROFILES || [])
        .filter(p => p.supervisor_id === me).map(p => p.member_id));
      base = base.filter(t =>
        t.assignee === this.currentUser || t.creator === this.currentUser ||
        reports.has(t.assignee) || t.id === clockId);
    }
    return base;
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => { this.renderCounts(); this.renderExtraGroups(); });
    App.EventBus.on('time:changed',  () => { this.renderCounts(); this.renderExtraGroups(); });
    App.EventBus.on('view:changed',  (view) => this.updateActive(view));
    App.EventBus.on('company:changed', () => { this.renderCounts(); this.renderExtraGroups(); });
    App.EventBus.on('role:changed', () => this.refreshForRole());
  }

  updateActive(view) {
    // Only navigation (data-view) items track the active view; company items
    // (data-company) manage their own active state on company:changed.
    document.querySelectorAll('.side-item[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
  }

  renderCounts() {
    const all = this._scopedActiveTasks();
    const today = App.utils.todayISO(0);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set('cnt-all', App.can('tasks.view') ? all.length : 0);
    set('cnt-mine', all.filter(t => t.assignee === this.currentUser).length);
    set('cnt-hot', all.filter(t => t.priority === 'critical' || t.priority === 'urgent').length);
    set('cnt-today', all.filter(t => t.due === today).length);
    set('cnt-overdue', all.filter(t => t.due < today).length);
    set('cnt-watching', all.filter(t => (t.watchers || []).includes(this.currentUser)).length);
    set('cnt-clock-live', this.timeModel.allActive().length);
  }
};
