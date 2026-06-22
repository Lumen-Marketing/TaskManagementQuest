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
    const viewsBtn = document.getElementById('viewsBtn');
    const exportBtn = document.getElementById('exportBtn');
    if (sortBtn)  sortBtn.addEventListener('click',  (e) => { e.stopPropagation(); this.toggle('sort',  sortBtn); });
    if (groupBtn) groupBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle('group', groupBtn); });
    if (viewBtn)  viewBtn.addEventListener('click',  (e) => { e.stopPropagation(); this.toggle('view',  viewBtn); });
    if (viewsBtn) viewsBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle('views', viewsBtn); });
    if (exportBtn) exportBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle('export', exportBtn); });
    [sortBtn, groupBtn, viewBtn, viewsBtn, exportBtn].forEach(btn => {
      if (btn) { btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('click', (e) => {
      if (!this.menu) return;
      if (this.menu.contains(e.target)) return;
      this.close();
    });
    App.EventBus.on('sort:changed',   () => { if (this.menuFor === 'sort')  this.render(); });
    App.EventBus.on('group:changed',  () => { if (this.menuFor === 'group') this.render(); });
    App.EventBus.on('layout:changed', () => { if (this.menuFor === 'view')  this.render(); });
    App.EventBus.on('savedviews:changed', () => { if (this.menuFor === 'views') this.render(); });
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
    anchor.setAttribute('aria-expanded', 'true');
    this._onKey = this._onKey.bind(this);
    this.menu.addEventListener('keydown', this._onKey);
    this._focusItem(0, true);
  }

  close() {
    if (this.anchor) {
      this.anchor.classList.remove('active');
      this.anchor.setAttribute('aria-expanded', 'false');
    }
    if (this.menu) this.menu.remove();
    this.menu = null;
    this.menuFor = null;
    this.anchor = null;
  }

  _items() { return this.menu ? [...this.menu.querySelectorAll('.toolbar-menu-item')] : []; }

  _focusItem(idx, preferActive) {
    const items = this._items();
    if (!items.length) return;
    const target = preferActive
      ? (items.find(i => i.classList.contains('active')) || items[0])
      : (items[idx] || items[0]);
    target.focus();
  }

  _onKey(e) {
    const items = this._items();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown')      { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Home')      { e.preventDefault(); items[0] && items[0].focus(); }
    else if (e.key === 'End')       { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement && document.activeElement.click(); }
    else if (e.key === 'Escape')    { e.preventDefault(); const a = this.anchor; this.close(); a && a.focus(); }
    else if (e.key === 'Tab')       { this.close(); }
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
        { key: 'calendar', label: 'Calendar', icon: 'ti-calendar' },
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
    } else if (this.menuFor === 'views') {
      const esc = App.utils.escapeHtml;
      const views = this.controller.getSavedViews();
      const list = views.length ? views.map(v => `
        <div class="toolbar-menu-item sv-row" data-apply="${esc(v.id)}">
          <i class="ti ti-bookmark"></i>
          <span>${esc(v.name)}</span>
          <button class="sv-del" data-del="${esc(v.id)}" title="Delete view" aria-label="Delete view ${esc(v.name)}"><i class="ti ti-x"></i></button>
        </div>`).join('')
        : `<div class="toolbar-menu-hint">No saved views yet.</div>`;
      this.menu.innerHTML = `
        <div class="toolbar-menu-title">Saved views</div>
        ${list}
        <div class="toolbar-menu-item sv-save" data-save="1">
          <i class="ti ti-plus"></i><span>Save current view…</span>
        </div>
      `;
      this.menu.querySelectorAll('[data-apply]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-del]')) return; // delete handled separately
          this.controller.applySavedView(el.dataset.apply);
          this.close();
        });
      });
      this.menu.querySelectorAll('[data-del]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.controller.deleteSavedView(el.dataset.del);
        });
      });
      const saveEl = this.menu.querySelector('[data-save]');
      if (saveEl) saveEl.addEventListener('click', () => {
        const name = window.prompt('Name this view:');
        if (name && name.trim()) this.controller.saveCurrentView(name);
        this.close();
      });
    } else if (this.menuFor === 'export') {
      const items = [
        { key: 'tasks', label: 'Tasks → CSV',       icon: 'ti-list-check' },
        { key: 'time',  label: 'Time report → CSV', icon: 'ti-clock' },
      ];
      this.menu.innerHTML = `
        <div class="toolbar-menu-title">Export (current filters)</div>
        ${items.map(i => `
          <div class="toolbar-menu-item" data-export="${i.key}">
            <i class="ti ${i.icon}"></i>
            <span>${i.label}</span>
          </div>
        `).join('')}
      `;
      this.menu.querySelectorAll('[data-export]').forEach(el => {
        el.addEventListener('click', () => {
          if (el.dataset.export === 'tasks') this.controller.exportTasksCsv();
          else this.controller.exportTimeCsv();
          this.close();
        });
      });
    }

    // ARIA roles for the menu + items (re-applied on every render).
    this.menu.setAttribute('role', 'menu');
    this.menu.querySelectorAll('.toolbar-menu-item').forEach(el => {
      el.setAttribute('role', 'menuitemradio');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-checked', el.classList.contains('active') ? 'true' : 'false');
    });
    // If a re-render (e.g. flipping sort direction by keyboard) dropped focus to
    // <body>, pull it back to the active item so keyboard nav continues.
    if (document.activeElement === document.body) this._focusItem(0, true);
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
      const layoutIcons = { table: 'ti-table', calendar: 'ti-calendar', kanban: 'ti-layout-kanban' };
      const layoutLabels = { table: 'Table', calendar: 'Calendar', kanban: 'Kanban' };
      const layout = ui.layout || 'table';
      viewBtn.innerHTML = `<i class="ti ${layoutIcons[layout]}"></i>View: ${layoutLabels[layout]}`;
    }
  }
};
