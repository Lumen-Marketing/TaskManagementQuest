/* Table layout adapter (CONTEXT.md: Layout) — the default list presentation,
   skinned to the boss's prototype via #taskViewWrap.qt-skin + css/tasks.css.
   Registered into App.TaskListLayouts; TaskListView dispatches
   render(view, tasks) — `view` is the TaskList module, whose shared helpers
   (renderRow/_renderEmpty/_emptyConfig/_openStatusMenu/_openQuickSheet, body,
   wrap, controller, models) adapters may use. Layout-specific wiring — the
   qt chip row, the qt column header, and the column-filter dropdown machinery
   (shared by the static .list-header buttons, which only the Table layout
   shows) — lives here, not in the module. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  function qtGroupIcon(key) {
    return ({
      overdue: 'ti-alert-triangle', today: 'ti-flame', tomorrow: 'ti-arrow-narrow-right',
      thisWeek: 'ti-calendar', later: 'ti-clock', done: 'ti-circle-check',
    })[key] || 'ti-layout-rows';
  }

  // Company filter chips (prototype's top row). Single-select: "All" clears the
  // companies filter; a company narrows to just it. Drives the same filter state
  // as everything else via the controller (table-local, no global scope change).
  function qtChipRow(view) {
    const row = document.createElement('div');
    row.className = 'qt-chiprow';
    const active = (view.controller.uiState.filters && view.controller.uiState.filters.companies) || [];
    const accessible = (view.controller.uiState.companies || []).filter(id => App.directory.company(id));
    // Fallback (accessible empty) must not leak the access-gated 'overall'.
    const ids = accessible.length ? accessible : Object.keys(App.COMPANIES).filter(id => id !== 'overall');
    const chips = [{ id: 'all', label: 'All' }].concat(ids.map(id => ({ id, label: App.directory.company(id).label })));
    row.innerHTML = chips.map(c => {
      const on = c.id === 'all' ? active.length === 0 : (active.length === 1 && active[0] === c.id);
      return `<button type="button" class="qt-chip ${on ? 'on' : ''}" data-company="${App.utils.escapeHtml(c.id)}">${c.id === 'all' ? '' : '<span class="sq"></span>'}${App.utils.escapeHtml(c.label)}</button>`;
    }).join('');
    row.querySelectorAll('[data-company]').forEach(btn =>
      btn.addEventListener('click', () => view.controller.setCompanyScopeFilter(btn.dataset.company)));
    return row;
  }

  // The rendered column header. Each label is a filter button wired to the same
  // dropdown machinery as the static header (openColumnFilter → columnFilterModel).
  function qtColsHeader(view) {
    const cols = document.createElement('div');
    cols.className = 'qt-cols';
    const f = view.controller.uiState.filters || {};
    const btn = (label, col, extraClass = '') => {
      const on = col === 'due' ? (f.dueRange && f.dueRange !== 'all') : ((f[col] || []).length > 0);
      const n = col === 'due' ? 1 : (f[col] || []).length;
      return `<button type="button" class="qt-colbtn ${on ? 'filtered' : ''} ${extraClass}" data-filter-col="${col}" aria-haspopup="listbox" aria-expanded="false">${label}${on ? ` (${n})` : ''} <i class="ti ti-chevron-down"></i></button>`;
    };
    cols.innerHTML = `
      <span class="qt-colcell"></span>
      <span class="qt-colcell"></span>
      <span class="qt-colcell" style="font-weight:600">TASK</span>
      ${btn('STATUS', 'statuses')}
      ${btn('PRIORITY', 'priorities')}
      ${btn('LABEL', 'labels', 'qt-col-label')}
      ${btn('ASSIGNEE', 'assignees', 'qt-col-assignee')}
      ${btn('DUE', 'due')}`;
    cols.querySelectorAll('.qt-colbtn').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); openColumnFilter(view, b); }));
    return cols;
  }

  function qtRow(view, t) {
    const esc = App.utils.escapeHtml;
    const t0 = App.utils.todayISO(0);
    const person = App.directory.person(t.assignee) || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#8a857e' };
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const statusKey = t.status || 'todo';
    const stLabel = App.taxonomy.statusLabel(t.company, t.type, t.status);
    const lblKey = t.label || 'none';
    const lblLabel = App.taxonomy.labelLabel(t.company, lblKey);
    const lblColor = (App.taxonomy.color && App.taxonomy.color('label', t.company, lblKey, t.type)) || '#8a857e';
    const isDone = App.taxonomy.isDone(t);
    const isStuck = statusKey === 'hold' && !isDone;
    const selected = view.controller.uiState.selectedTaskId === t.id;
    const bulkSel = view.controller.isBulkSelected(t.id);
    const canWrite = App.can('tasks.write');
    const canClock = App.can('clock.use');
    const myActive = view.timeModel.activeFor(view.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subCount = subs.length;
    const subDone = subs.filter(s => s.d).length;

    let dueText = '—', dueCls = '';
    if (t.due) {
      dueText = App.utils.formatDue(t.due).text;
      dueCls = isDone ? 'done' : (t.due < t0 ? 'late' : (t.due === t0 ? 'today' : ''));
    } else if (isDone) { dueText = 'Done'; dueCls = 'done'; }

    const initials = App.utils.initials(person.full || person.name || t.assignee || '?');
    const avColor = App.utils.safeColor(person.color);
    const firstName = String(person.name || person.full || 'Unassigned').split(' ')[0];

    const row = document.createElement('div');
    row.className = 'qt-row' + (selected ? ' selected' : '') + (bulkSel ? ' bulk-selected' : '') + (isStuck ? ' qt-stuckrow' : '') + (isDone ? ' qt-done' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <span class="qt-ck"><input type="checkbox" ${isDone ? 'checked' : ''} data-action="toggle-done" ${canWrite ? '' : 'disabled'} aria-label="Complete task"></span>
      <span class="qt-pdot ${priority.cls}" title="${esc(priority.label)}"></span>
      <div class="qt-tcell">
        <span class="qt-ttitle">${esc(t.title)}${subCount ? `<span class="qt-steps">${subDone}/${subCount}</span>` : ''}</span>
        ${isStuck ? `<div><span class="qt-stuckbadge"><i class="ti ti-alert-hexagon"></i>STUCK · ${esc(stLabel)}</span></div>` : ''}
      </div>
      <div class="qt-cell-status">${canWrite
        ? `<button class="qt-cellbtn status-${statusKey}" data-action="open-status" data-current="${statusKey}" title="Change status" aria-haspopup="listbox" aria-expanded="false"><span class="dot"></span><span class="nm">${esc(stLabel)}</span><span class="chv"><i class="ti ti-chevron-down"></i></span></button>`
        : `<span class="qt-cellbtn status-${statusKey}"><span class="dot"></span><span class="nm">${esc(stLabel)}</span></span>`}</div>
      <div class="qt-cell-priority">${canWrite
        ? `<span class="qt-pcell"><button class="qt-pbadge ${priority.cls}" data-action="open-priority" data-current="${t.priority || 'medium'}" title="Change priority" aria-haspopup="listbox" aria-expanded="false">${esc(priority.label.toUpperCase())}</button><span class="chv"><i class="ti ti-chevron-down"></i></span></span>`
        : `<span class="qt-pbadge ${priority.cls}">${esc(priority.label.toUpperCase())}</span>`}</div>
      <div class="qt-cell-label">${lblKey !== 'none'
        ? `<span class="qt-cellbtn"><span class="dot" style="background:${lblColor}"></span><span class="nm">${esc(lblLabel)}</span></span>`
        : `<span class="qt-cellbtn" style="color:#a8a39b"><span class="nm">—</span></span>`}</div>
      <div class="qt-cell-assignee"><span class="qt-cellbtn"><span class="qt-avatar" style="background:${avColor}">${esc(initials)}</span><span class="nm">${esc(firstName)}</span></span></div>
      <div class="qt-due ${dueCls}">${esc(dueText)}${t.dueTime ? `<span class="qt-duetime">${esc(App.utils.formatClockTz(t.dueTime))}</span>` : ''}</div>
      <div class="qt-actions">
        ${canClock ? `<button class="timer-btn ${myTimerOnThis ? 'active' : ''}" data-action="toggle-timer" title="${myTimerOnThis ? 'Pause — back to General shift' : 'Start timer'}"><i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play'}"></i></button>` : ''}
        ${canWrite ? `<button class="finish-btn ${isDone ? 'is-done' : ''}" data-action="finish-task" title="${isDone ? 'Mark as not done' : 'Finish this task'}"><i class="ti ${isDone ? 'ti-check' : 'ti-circle-check'}"></i></button>` : ''}
        ${canWrite ? `<button class="quick-actions-btn" data-action="open-quick" aria-label="Quick actions"><i class="ti ti-dots-vertical"></i></button>` : ''}
      </div>`;

    // Row clicks (actions + select) are handled by the module's delegated
    // _onRowClick — rows carry data-id + data-action, nothing to bind here.
    return row;
  }

  /* Prepend the project-detail folder header when the list is scoped to one
     folder (filters.projectId). Self-wires its own buttons. */
  function prependProjectHeader(view) {
    const pid = view.controller.uiState.filters && view.controller.uiState.filters.projectId;
    if (!pid) return;
    const proj = App.directory.project(pid);
    if (!proj) return;
    const esc = App.utils.escapeHtml;
    const head = document.createElement('div');
    head.className = 'proj-detail-head';
    head.style.setProperty('--pc', proj.color);
    head.innerHTML = `
      <button class="btn btn-sm" data-action="clear-project" type="button"><i class="ti ti-arrow-left"></i> Projects</button>
      <span class="pdh-folder"><i class="ti ti-folder"></i>${esc(proj.name)}</span>
      ${proj.client ? `<span class="pdh-client">${esc(proj.client)}</span>` : ''}
      ${App.can('tasks.write') ? `<button class="btn btn-primary btn-sm" data-action="new-task-in-project" type="button"><i class="ti ti-plus"></i> New task</button>` : ''}`;
    head.querySelector('[data-action="clear-project"]').addEventListener('click', () => view.controller.clearProjectScope());
    const nt = head.querySelector('[data-action="new-task-in-project"]');
    if (nt) nt.addEventListener('click', () => view.controller.openNewTaskPage({ project: pid, company: proj.companyId }));
    view.body.insertAdjacentElement('afterbegin', head);
  }

  /* ---- Column-header filter dropdowns -------------------------------------
     The Table header's Assignee / Priority / Status / Due labels are buttons
     that open a dropdown to filter by that column. They drive the SAME filter
     state as the toolbar Filter panel (uiState.filters via toggleFilterValue /
     setFilterDueRange), so the two stay in sync and the list re-renders on the
     existing 'filters:changed' event. The open handle lives on the view
     instance (view._cfHandle) so unmount can tear it down. */
  function columnFilterModel(view, col) {
    const f = view.controller.uiState.filters || {};
    if (col === 'assignees') {
      const people = (App.utils.activePeople ? App.utils.activePeople() : Object.values(App.PEOPLE || {}));
      return { multi: true, group: 'assignees', title: 'Filter assignee',
        options: people.map(p => ({ value: p.id, label: p.name || p.full || p.id, selected: (f.assignees || []).includes(p.id) })) };
    }
    if (col === 'priorities') {
      return { multi: true, group: 'priorities', title: 'Filter priority',
        options: Object.entries(App.PRIORITIES).map(([k, v]) => ({ value: k, label: v.label, selected: (f.priorities || []).includes(k) })) };
    }
    if (col === 'types') {
      return { multi: true, group: 'types', title: 'Filter type',
        options: Object.entries(App.TASK_TYPES).map(([k, v]) => ({ value: k, label: v.label, selected: (f.types || []).includes(k) })) };
    }
    if (col === 'statuses') {
      return { multi: true, group: 'statuses', title: 'Filter status',
        options: Object.entries(App.STATUSES).map(([k, v]) => ({ value: k, label: v.label, selected: (f.statuses || []).includes(k) })) };
    }
    if (col === 'companies') {
      // Gate on accessible companies so the access-gated 'overall' shows only
      // for granted users; fall back to the non-overall constants.
      const access = (view.controller.uiState.companies || []).filter(id => id !== '*' && App.directory.company(id));
      const entries = access.length
        ? access.map(id => [id, (App.directory.company(id) || { label: id }).label])
        : Object.values(App.COMPANIES).filter(c => !c.all).map(c => [c.id, c.label]);
      return { multi: true, group: 'companies', title: 'Filter company',
        options: entries.map(([k, label]) => ({ value: k, label, selected: (f.companies || []).includes(k) })) };
    }
    if (col === 'labels') {
      return { multi: true, group: 'labels', title: 'Filter label',
        options: Object.entries(App.TASK_LABELS || {}).map(([k, v]) => ({ value: k, label: v.label, selected: (f.labels || []).includes(k) })) };
    }
    // Due is a single-select range (mirrors FilterBarView's options).
    const ranges = [
      { value: 'all', label: 'Any' }, { value: 'overdue', label: 'Overdue' },
      { value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' },
      { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' },
    ];
    return { multi: false, group: 'due', title: 'Filter due',
      options: ranges.map(r => ({ value: r.value, label: r.label, selected: (f.dueRange || 'all') === r.value })) };
  }

  /* App.Menu owns the choreography (positioning, click-away, Esc, aria); this
     site owns the option list. Multi-select keeps the menu open —
     filters:changed re-renders the content in place (see mount below). */
  function openColumnFilter(view, btn) {
    // Re-clicking the open column's button toggles it shut.
    if (view._cfHandle && view._cfMenuCol === btn.dataset.filterCol) {
      view._cfHandle.close('api');
      return;
    }
    view._cfMenuCol = btn.dataset.filterCol;
    view._cfHandle = App.Menu.open({
      anchor: btn,
      className: 'col-filter-menu',
      repositionOnScroll: false,
      onClose: () => { view._cfHandle = null; view._cfMenuCol = null; },
      build: (el) => { el.setAttribute('role', 'listbox'); },
    });
    renderColumnFilterMenu(view);
    view._cfHandle.reposition(); // content just landed — re-fit to its real size
  }

  function renderColumnFilterMenu(view) {
    if (!view._cfHandle || !view._cfMenuCol) return;
    const menuEl = view._cfHandle.el;
    const model = columnFilterModel(view, view._cfMenuCol);
    const esc = App.utils.escapeHtml;
    menuEl.innerHTML =
      model.options.map(o => `
        <div class="cf-item ${o.selected ? 'selected' : ''}" data-value="${esc(String(o.value))}" role="option" aria-selected="${o.selected}">
          <span class="cf-check"><i class="ti ti-check"></i></span>
          <span class="cf-label">${esc(o.label)}</span>
        </div>`).join('') +
      `<div class="cf-clear" data-action="cf-clear">Clear filter</div>`;

    menuEl.querySelectorAll('.cf-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.dataset.value;
        if (model.multi) {
          view.controller.toggleFilterValue(model.group, value);
          // multi-select: keep the menu open; filters:changed re-renders it.
        } else {
          view.controller.setFilterDueRange(value);
          view._cfHandle.close('api');
        }
      });
    });
    const clear = menuEl.querySelector('[data-action="cf-clear"]');
    if (clear) clear.addEventListener('click', (e) => {
      e.stopPropagation();
      clearColumnFilter(view, model);
      if (!model.multi && view._cfHandle) view._cfHandle.close('api');
    });
  }

  function clearColumnFilter(view, model) {
    if (model.group === 'due') { view.controller.setFilterDueRange('all'); return; }
    const arr = (view.controller.uiState.filters[model.group] || []).slice();
    arr.forEach(v => view.controller.toggleFilterValue(model.group, v));
  }

  // Highlight a static-header button whenever its filter group is active.
  function syncColumnFilterState(view) {
    const f = view.controller.uiState.filters || {};
    const header = document.querySelector('#taskViewWrap .list-header');
    if (!header) return;
    header.querySelectorAll('.col-filter').forEach(btn => {
      const col = btn.dataset.filterCol;
      const active = col === 'due'
        ? (f.dueRange && f.dueRange !== 'all')
        : ((f[col] || []).length > 0);
      btn.classList.toggle('active', !!active);
    });
  }

  layouts.table = {
    // Once-per-session wiring for the STATIC .list-header filter buttons
    // (app.html) — they exist only while the Table layout is shown, but the
    // elements persist in the DOM, so guard against re-binding on re-mount.
    mount(view) {
      if (view._cfHeaderBound) return;
      view._cfHeaderBound = true;
      const header = document.querySelector('#taskViewWrap .list-header');
      if (header) {
        header.querySelectorAll('.col-filter').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openColumnFilter(view, btn); // toggles shut when already open on this column
          });
        });
      }
      App.EventBus.on('filters:changed', () => { syncColumnFilterState(view); renderColumnFilterMenu(view); });
      syncColumnFilterState(view);
    },

    unmount(view) {
      if (view._cfHandle) view._cfHandle.close('api');
    },

    render(view, tasks) {
      view.wrap.classList.add('qt-skin');
      view.body.className = 'qt-body';
      view.body.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'qt-wrap';
      wrap.appendChild(qtChipRow(view));
      wrap.appendChild(qtColsHeader(view));

      if (tasks.length === 0) {
        const cfg = view._emptyConfig();
        const showCta = cfg.cta && App.can('tasks.write');
        const e = document.createElement('div');
        e.className = 'empty';
        e.innerHTML = `
          <i class="ti ${cfg.icon}"></i>
          <div class="empty-title">${App.utils.escapeHtml(cfg.title)}</div>
          <div class="empty-sub">${App.utils.escapeHtml(cfg.sub)}</div>
          ${showCta ? `<div class="empty-actions"><button class="btn btn-primary empty-cta" type="button" data-action="empty-new-task"><i class="ti ti-plus"></i>New task</button></div>` : ''}`;
        const cta = e.querySelector('[data-action="empty-new-task"]');
        if (cta) cta.addEventListener('click', () => view.controller.openNewTaskPage());
        wrap.appendChild(e);
        view.body.appendChild(wrap);
        prependProjectHeader(view);
        return;
      }

      const { groupBy, sortBy, sortDir, collapsedGroups } = view.controller.uiState;
      const groups = view.taskModel.groupTasks(tasks, { groupBy, sortBy, sortDir });

      groups.forEach(g => {
        const collapsed = collapsedGroups.has(g.key);
        const section = document.createElement('div');
        section.className = 'qt-group' + (collapsed ? ' collapsed' : '');

        const headCls = g.key === 'overdue' ? 'overdue' : g.key === 'today' ? 'today' : 'plain';
        const head = document.createElement('div');
        head.className = 'qt-ghead ' + headCls;
        head.dataset.groupKey = g.key;
        head.innerHTML = `
          <span class="qt-chev"><i class="ti ti-chevron-down"></i></span>
          <span class="qt-gicon"><i class="ti ${qtGroupIcon(g.key)}"></i></span>
          <span class="qt-gname">${App.utils.escapeHtml(g.label)}</span>
          <span class="qt-gcount">${g.items.length}</span>`;
        head.addEventListener('click', () => view.controller.toggleGroupCollapsed(g.key));
        section.appendChild(head);

        if (!collapsed) {
          const body = document.createElement('div');
          body.className = 'qt-gbody';
          g.items.forEach(t => body.appendChild(qtRow(view, t)));
          section.appendChild(body);
        }

        wrap.appendChild(section);
      });

      view.body.appendChild(wrap);
      prependProjectHeader(view);
    },
  };
})();
