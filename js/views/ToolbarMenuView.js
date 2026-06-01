window.App = window.App || {};

/* ToolbarMenuView — anchored dropdown shared by the Sort + Group-by buttons
   in the command deck. Renders a labeled list of options; the active one
   gets a check; for Sort, the active row also shows a direction arrow. */
App.ToolbarMenuView = class ToolbarMenuView {
  constructor({ controller }) {
    this.controller = controller;
    this.menu = null;
    this.menuFor = null;

    const sortBtn  = document.getElementById('sortBtn');
    const groupBtn = document.getElementById('groupBtn');
    const viewBtn  = document.getElementById('viewBtn');
    if (sortBtn)  sortBtn.addEventListener('click',  (e) => { e.stopPropagation(); this.toggle('sort',  sortBtn); });
    if (groupBtn) groupBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle('group', groupBtn); });
    if (viewBtn)  viewBtn.addEventListener('click',  (e) => { e.stopPropagation(); this.toggle('view',  viewBtn); });
    document.addEventListener('click', (e) => {
      if (!this.menu) return;
      if (this.menu.contains(e.target)) return;
      this.close();
    });
    App.EventBus.on('sort:changed',   () => { if (this.menuFor === 'sort')  this.render(); });
    App.EventBus.on('group:changed',  () => { if (this.menuFor === 'group') this.render(); });
    App.EventBus.on('layout:changed', () => { if (this.menuFor === 'view')  this.render(); });
    this.syncButtonLabels();
    App.EventBus.on('sort:changed',   () => this.syncButtonLabels());
    App.EventBus.on('group:changed',  () => this.syncButtonLabels());
    App.EventBus.on('layout:changed', () => this.syncButtonLabels());
  }

  toggle(kind, anchor) {
    if (this.menu && this.menuFor === kind) { this.close(); return; }
    this.close();
    this.menuFor = kind;
    this.anchor = anchor;
    this.menu = document.createElement('div');
    this.menu.className = 'toolbar-menu';
    document.body.appendChild(this.menu);
    this.render();
    this.position();
    anchor.classList.add('active');
  }

  close() {
    if (this.anchor) this.anchor.classList.remove('active');
    if (this.menu) this.menu.remove();
    this.menu = null;
    this.menuFor = null;
    this.anchor = null;
  }

  position() {
    if (!this.menu || !this.anchor) return;
    const r = this.anchor.getBoundingClientRect();
    this.menu.style.position = 'fixed';
    this.menu.style.top  = (r.bottom + 6) + 'px';
    this.menu.style.left = r.left + 'px';
  }

  render() {
    if (!this.menu) return;
    const ui = this.controller.uiState;
    if (this.menuFor === 'sort') {
      this.menu.innerHTML = `
        <div class="toolbar-menu-title">Sort by</div>
        ${Object.entries(App.SORT_OPTIONS).map(([k, v]) => `
          <div class="toolbar-menu-item ${ui.sortBy === k ? 'active' : ''}" data-sort="${k}">
            <i class="ti ${ui.sortBy === k ? 'ti-check' : ''}"></i>
            <span>${v.label}</span>
            ${ui.sortBy === k ? `<i class="ti ${ui.sortDir === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down'}"></i>` : ''}
          </div>
        `).join('')}
        <div class="toolbar-menu-hint">Click the active option to flip direction.</div>
      `;
      this.menu.querySelectorAll('[data-sort]').forEach(el => {
        el.addEventListener('click', () => { this.controller.setSortBy(el.dataset.sort); });
      });
    } else if (this.menuFor === 'group') {
      this.menu.innerHTML = `
        <div class="toolbar-menu-title">Group by</div>
        ${Object.entries(App.GROUP_OPTIONS).map(([k, v]) => `
          <div class="toolbar-menu-item ${ui.groupBy === k ? 'active' : ''}" data-group="${k}">
            <i class="ti ${ui.groupBy === k ? 'ti-check' : ''}"></i>
            <span>${v.label}</span>
          </div>
        `).join('')}
      `;
      this.menu.querySelectorAll('[data-group]').forEach(el => {
        el.addEventListener('click', () => { this.controller.setGroupBy(el.dataset.group); this.close(); });
      });
    } else if (this.menuFor === 'view') {
      const layouts = [
        { key: 'table',    label: 'Table',    icon: 'ti-table' },
        { key: 'timeline', label: 'Timeline', icon: 'ti-timeline' },
        { key: 'kanban',   label: 'Kanban',   icon: 'ti-layout-kanban' },
      ];
      this.menu.innerHTML = `
        <div class="toolbar-menu-title">View as</div>
        ${layouts.map(l => `
          <div class="toolbar-menu-item ${ui.layout === l.key ? 'active' : ''}" data-layout="${l.key}">
            <i class="ti ${ui.layout === l.key ? 'ti-check' : l.icon}"></i>
            <span>${l.label}</span>
          </div>
        `).join('')}
      `;
      this.menu.querySelectorAll('[data-layout]').forEach(el => {
        el.addEventListener('click', () => { this.controller.setLayout(el.dataset.layout); this.close(); });
      });
    }
  }

  /* Keep the deck buttons informative — show the active option inline. */
  syncButtonLabels() {
    const ui = this.controller.uiState;
    const sortBtn = document.getElementById('sortBtn');
    const groupBtn = document.getElementById('groupBtn');
    const viewBtn = document.getElementById('viewBtn');
    if (sortBtn) {
      const lbl = (App.SORT_OPTIONS[ui.sortBy] || App.SORT_OPTIONS.priority).label;
      const arrow = ui.sortDir === 'asc' ? '↑' : '↓';
      sortBtn.innerHTML = `<i class="ti ti-arrows-sort"></i>Sort: ${lbl} ${arrow}`;
    }
    if (groupBtn) {
      const lbl = (App.GROUP_OPTIONS[ui.groupBy] || App.GROUP_OPTIONS.due).label;
      groupBtn.innerHTML = `<i class="ti ti-layout-rows"></i>Group: ${lbl}`;
    }
    if (viewBtn) {
      const layoutIcons = { table: 'ti-table', timeline: 'ti-timeline', kanban: 'ti-layout-kanban' };
      const layoutLabels = { table: 'Table', timeline: 'Timeline', kanban: 'Kanban' };
      const layout = ui.layout || 'table';
      viewBtn.innerHTML = `<i class="ti ${layoutIcons[layout]}"></i>View: ${layoutLabels[layout]}`;
    }
  }
};
