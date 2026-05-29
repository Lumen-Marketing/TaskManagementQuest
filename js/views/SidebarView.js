window.App = window.App || {};

App.SidebarView = class SidebarView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.moreBtn = document.getElementById('moreViewsBtn');
    this.moreMenu = null;

    this.applyRoleVisibility();
    this.bindStaticItems();
    this.bindMoreMenu();
    this.subscribe();
    this.renderCounts();
  }

  bindStaticItems() {
    document.querySelectorAll('.side-item[data-view]').forEach(el => {
      if (!this.controller.canView(el.dataset.view)) {
        el.classList.add('hidden');
        return;
      }
      el.addEventListener('click', () => this.controller.setView(el.dataset.view));
    });
  }

  applyRoleVisibility() {
    const adminGroup = document.getElementById('adminSideGroup');
    if (adminGroup) adminGroup.classList.toggle('hidden', !App.can('roles.manage'));

    const teamGroup = document.getElementById('teamSideGroup');
    if (teamGroup) teamGroup.classList.toggle('hidden', !App.can('team.view'));

    const viewsGroup = document.querySelector('.grp-views');
    if (viewsGroup) viewsGroup.classList.toggle('hidden', !App.can('tasks.view'));

    // The "More views" menu holds company filters + time views; hide it only if
    // the user can't reach any of those.
    if (this.moreBtn) {
      const hasMore = App.can('tasks.view') || App.can('time.own') || App.can('clock.use') || App.can('time.team');
      this.moreBtn.classList.toggle('hidden', !hasMore);
    }
  }

  /* ---------- More views dropdown ---------- */
  bindMoreMenu() {
    if (!this.moreBtn) return;
    this.moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMoreMenu();
    });
    document.addEventListener('click', (e) => {
      if (this.moreMenu && !this.moreMenu.contains(e.target) && e.target !== this.moreBtn && !this.moreBtn.contains(e.target)) {
        this.closeMoreMenu();
      }
    });
  }

  toggleMoreMenu() {
    if (this.moreMenu) { this.closeMoreMenu(); return; }

    const sections = [];
    if (App.can('tasks.view')) {
      sections.push({
        label: 'Company',
        items: [
          { view: 'company:roofing',  label: 'Roofing',  dot: 'dot-roof',  count: this.companyCount('roofing') },
          { view: 'company:drafting', label: 'Drafting', dot: 'dot-draft', count: this.companyCount('drafting') },
          { view: 'company:lumen',    label: 'Lumen',    dot: 'dot-lumen', count: this.companyCount('lumen') },
        ],
      });
    }
    const timeItems = [];
    if (App.can('time.own') || App.can('clock.use')) {
      timeItems.push({ view: 'time:mine', label: 'My time', icon: 'ti-clock', count: App.utils.formatHours(this.timeModel.totalForUser(this.currentUser)) });
    }
    if (App.can('time.team')) {
      timeItems.push({ view: 'time:resource',  label: 'Team workload', icon: 'ti-users', count: this.timeModel.allActive().length });
      timeItems.push({ view: 'time:analytics', label: 'Reports',       icon: 'ti-chart-bar' });
    }
    if (timeItems.length) sections.push({ label: 'Time', items: timeItems });

    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.innerHTML = sections.map(section => `
      <div class="more-menu-section">
        <div class="side-label">${section.label}</div>
        ${section.items.map(item => `
          <div class="more-menu-item ${this.controller.uiState.view === item.view ? 'active' : ''}" data-view="${item.view}">
            ${item.dot ? `<span class="dot-co ${item.dot}"></span>` : `<i class="ti ${item.icon || 'ti-circle'}"></i>`}
            <span class="more-menu-label">${item.label}</span>
            ${item.count != null ? `<span class="side-count">${item.count}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('') || '<div class="more-menu-empty">No extra views available.</div>';

    document.body.appendChild(menu);
    const rect = this.moreBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';
    this.moreMenu = menu;
    this.moreBtn.classList.add('open');

    menu.querySelectorAll('[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        this.controller.setView(item.dataset.view);
        this.closeMoreMenu();
      });
    });
  }

  closeMoreMenu() {
    if (!this.moreMenu) return;
    this.moreMenu.remove();
    this.moreMenu = null;
    if (this.moreBtn) this.moreBtn.classList.remove('open');
  }

  companyCount(companyId) {
    return this.taskModel.all().filter(t => t.company === companyId && t.status !== 'done').length;
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.renderCounts());
    App.EventBus.on('time:changed', () => this.renderCounts());
    App.EventBus.on('view:changed', (view) => this.updateActive(view));
  }

  updateActive(view) {
    document.querySelectorAll('.side-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
    // Highlight the More button when an advanced (company/time) view is active.
    if (this.moreBtn) {
      this.moreBtn.classList.toggle('active', view.startsWith('company:') || view.startsWith('time:'));
    }
  }

  renderCounts() {
    const all = this.taskModel.all().filter(t => t.status !== 'done');
    const today = App.utils.todayISO(0);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set('cnt-all', App.can('tasks.view') ? all.length : 0);
    set('cnt-mine', all.filter(t => t.assignee === this.currentUser).length);
    set('cnt-hot', all.filter(t => t.urgency === 'critical' || t.urgency === 'urgent').length);
    set('cnt-today', all.filter(t => t.due === today).length);
    set('cnt-overdue', all.filter(t => t.due < today).length);
    set('cnt-watching', all.filter(t => (t.watchers || []).includes(this.currentUser)).length);
    set('cnt-clock-live', this.timeModel.allActive().length);
  }
};
