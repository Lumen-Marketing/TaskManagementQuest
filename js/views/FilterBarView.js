window.App = window.App || {};

/* FilterBarView — renders the chip-style filter panel under the page head.
   Toggled by the Filter button in the command deck (controller.toggleFilters).
   Each chip flips a value in controller.uiState.filters; the list view
   re-renders on 'filters:changed'. */
App.FilterBarView = class FilterBarView {
  constructor({ controller }) {
    this.controller = controller;
    this.bar = document.getElementById('filterBar');
    this.btn = document.getElementById('filterBtn');
    if (!this.bar || !this.btn) return;

    this.subscribe();
    this.applyOpenState();
    this.render();
  }

  subscribe() {
    App.EventBus.on('filters:toggled', () => { this.applyOpenState(); this.render(); });
    App.EventBus.on('filters:changed', () => this.render());
    App.EventBus.on('tasks:changed',   () => this.renderBadge());
  }

  applyOpenState() {
    const open = !!this.controller.uiState.filtersOpen;
    this.bar.classList.toggle('hidden', !open);
    this.btn.classList.toggle('active', open);
  }

  render() {
    if (this.bar.classList.contains('hidden')) {
      this.renderBadge();
      return;
    }
    const f = this.controller.uiState.filters;

    const peopleChips = App.utils.activePeople().map(p => this.chip({
      group: 'assignees', value: p.id, label: p.name,
      swatch: p.color, active: f.assignees.includes(p.id),
    })).join('');

    // Source from accessible companies so the access-gated 'overall' shows
    // only for granted users; fall back to the non-overall constants.
    const companyList = (this.controller.uiState.companies || [])
      .filter(id => id !== '*' && App.directory.company(id))
      .map(id => App.directory.company(id));
    const companyChips = (companyList.length
      ? companyList
      : Object.values(App.COMPANIES).filter(c => !c.all)
    ).map(c => this.chip({
      group: 'companies', value: c.id, label: c.label,
      active: f.companies.includes(c.id),
    })).join('');

    const statusChips = Object.entries(App.STATUSES).map(([k, v]) => this.chip({
      group: 'statuses', value: k, label: v.label,
      active: f.statuses.includes(k),
    })).join('');

    const priorityChips = Object.entries(App.PRIORITIES).map(([k, v]) => this.chip({
      group: 'priorities', value: k, label: v.label,
      swatchVar: `--u-${k}`,
      active: f.priorities.includes(k),
    })).join('');

    const typeChips = Object.entries(App.TASK_TYPES).map(([k, v]) => this.chip({
      group: 'types', value: k, label: v.label,
      active: f.types.includes(k),
    })).join('');

    const projectChips = Object.values(App.projects || {})
      .filter(p => ['lead', 'active', 'hold'].includes(p.status))
      .map(p => this.chip({
        group: 'projects', value: p.id, label: p.name,
        swatch: p.color, active: (f.projects || []).includes(p.id),
      })).join('');

    const dueOptions = [
      { value: 'all',      label: 'Any' },
      { value: 'overdue',  label: 'Overdue' },
      { value: 'today',    label: 'Today' },
      { value: 'tomorrow', label: 'Tomorrow' },
      { value: 'week',     label: 'This week' },
      { value: 'month',    label: 'This month' },
    ];
    const dueChips = dueOptions.map(o =>
      `<button type="button" class="filter-chip ${f.dueRange === o.value ? 'active' : ''}" data-due="${o.value}" aria-pressed="${f.dueRange === o.value}">${o.label}</button>`
    ).join('');

    const count = this.controller.activeFilterCount();
    const matched = this.controller.taskModel.getFiltered({
      view: this.controller.uiState.view,
      searchQuery: this.controller.uiState.searchQuery,
      currentUser: this.controller.currentUser,
      activeFilters: f,
    }).length;

    // Self-only roles see just their own tasks, so the Assignee and Company
    // filter rows are noise for them — hide both.
    const role = (App.currentProfile && App.currentProfile.role) || 'member';
    const isSelfOnlyRole = ['worker', 'member', 'sales', 'developer'].includes(role);

    this.bar.innerHTML = `
      <div class="filter-row">
        ${isSelfOnlyRole ? '' : `
        <div class="filter-group">
          <span class="filter-label">Assignee</span>
          <div class="filter-chips">${peopleChips}</div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Company</span>
          <div class="filter-chips">${companyChips}</div>
        </div>`}
        <div class="filter-group">
          <span class="filter-label">Status</span>
          <div class="filter-chips">${statusChips}</div>
        </div>
      </div>
      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">Priority</span>
          <div class="filter-chips">${priorityChips}</div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Type</span>
          <div class="filter-chips">${typeChips}</div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Project</span>
          <div class="filter-chips">${projectChips || '<span class="filter-empty" style="font-size:11px;color:var(--ink-3);">No projects</span>'}</div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Due</span>
          <div class="filter-chips">${dueChips}</div>
        </div>
      </div>
      <div class="filter-foot">
        <span class="filter-summary">${count ? `${count} active filter${count > 1 ? 's' : ''} · ${matched} task${matched === 1 ? '' : 's'} match` : 'No filters — showing everything in the current view'}</span>
        <button class="filter-clear" data-action="clear"><i class="ti ti-eraser"></i>Clear all</button>
      </div>
    `;

    this.bindChips();
    this.renderBadge();
  }

  chip({ group, value, label, swatch, swatchVar, active }) {
    const dot = swatch
      ? `<span class="swatch" style="background:${App.utils.safeColor(swatch)};"></span>`
      : swatchVar
        ? `<span class="swatch" style="background:var(${swatchVar});"></span>`
        : '';
    return `<button type="button" class="filter-chip ${active ? 'active' : ''}" data-group="${App.utils.escapeHtml(group)}" data-value="${App.utils.escapeHtml(value)}" aria-pressed="${!!active}">${dot}${App.utils.escapeHtml(label)}</button>`;
  }

  bindChips() {
    this.bar.querySelectorAll('[data-group]').forEach(el => {
      el.addEventListener('click', () => this.controller.toggleFilterValue(el.dataset.group, el.dataset.value));
    });
    this.bar.querySelectorAll('[data-due]').forEach(el => {
      el.addEventListener('click', () => this.controller.setFilterDueRange(el.dataset.due));
    });
    const clear = this.bar.querySelector('[data-action="clear"]');
    if (clear) clear.addEventListener('click', () => this.controller.clearFilters());
  }

  renderBadge() {
    const count = this.controller.activeFilterCount();
    let badge = this.btn.querySelector('.filter-badge');
    if (count === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'filter-badge';
      this.btn.appendChild(badge);
    }
    badge.textContent = String(count);
  }
};
