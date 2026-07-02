window.App = window.App || {};

/* Projects view: each company is its own warm panel (a "box"), clearly
   separated by the page wash and a company-tinted header — never borders.
   Inside a box, folders are compact task-list-style rows grouped by due date,
   with a completion progress bar. A click-to-complete circle on each row marks
   the folder done, dropping it into that company's collapsed "Completed" group.
   A folder row's chevron expands it to reveal all of its tasks; clicking the
   row scopes the task list to it (controller.openProject). */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.sort = 'recent';
    this.expanded = new Set();   // folder ids with their task drawer open
    this.collapsed = new Set();  // due-group keys the user has collapsed
    this._seenDone = new Set();  // done-group keys already auto-collapsed once
    App.EventBus.on('view:changed', (v) => { if (v === 'projects') this.render(); });
    App.EventBus.on('projects:changed', () => { if (this._visible()) this.render(); });
    App.EventBus.on('tasks:changed', () => { if (this._visible()) this.render(); });
    App.EventBus.on('company:changed', () => { if (this._visible()) this.render(); });
  }

  _visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  // A folder is "active" while its lifecycle status is open; anything else
  // (done / archived / lost …) reads as closed and files under Completed.
  _isActive(p) { return ['lead', 'active', 'hold'].includes(p.status); }

  _counts(id) {
    const all = this.taskModel.all().filter(t => t.project === id);
    return { open: all.filter(t => !App.taxonomy.isDone(t)).length, done: all.filter(t => App.taxonomy.isDone(t)).length };
  }

  _folderTasks(id) {
    const rank = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
    return this.taskModel.all().filter(t => t.project === id)
      .sort((a, b) =>
        ((App.taxonomy.isDone(a)) - (App.taxonomy.isDone(b))) ||
        ((rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)) ||
        String(a.due || '').localeCompare(String(b.due || '')));
  }

  // Every folder in the sidebar-company scope (active + completed). Completed
  // folders live in a collapsed group rather than behind a toggle.
  _baseFolders() {
    const cur = this.controller.uiState.currentCompany;
    return Object.values(App.projects || {})
      .filter(p => !cur || cur === '*' || p.companyId === cur);
  }

  _sortFolders(list) {
    const arr = list.slice();
    if (this.sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.sort === 'active') arr.sort((a, b) => this._counts(b.id).open - this._counts(a.id).open);
    return arr; // 'recent' keeps created_at insertion order
  }

  _visibleFolders() { return this._sortFolders(this._baseFolders()); }

  _companyColor(companyId) {
    return ({ roofing: 'var(--u-high)', drafting: 'var(--blue)', lumen: 'var(--amber)' })[companyId] || 'var(--amber)';
  }
  _folderColor(p) {
    return (p.color && p.color.toLowerCase() !== '#8f867b') ? p.color : this._companyColor(p.companyId);
  }
  _prioColor(prio) {
    return ({ critical: 'var(--u-critical)', urgent: 'var(--u-urgent)', high: 'var(--u-high)', medium: 'var(--u-medium)', low: 'var(--u-low)' })[prio] || 'var(--u-medium)';
  }
  _fmtDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  _taskRow(t) {
    const esc = App.utils.escapeHtml;
    const st = App.STATUSES[t.status] || { label: t.status || '' };
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned' };
    const due = App.utils.formatDue ? (App.utils.formatDue(t.due) || {}) : {};
    const dueText = (due && due.text) ? due.text : '';
    const done = App.taxonomy.isDone(t);
    return `
      <div class="pv-trow${done ? ' done' : ''}" data-task="${esc(t.id)}" role="button" tabindex="0">
        <span class="pv-tprio" style="background:${this._prioColor(t.priority)}"></span>
        <span class="pv-ttitle">${esc(t.title)}</span>
        <span class="pv-tstatus">${esc(st.label)}</span>
        <span class="pv-tassignee">${esc(person.name)}</span>
        <span class="pv-tdue">${esc(dueText)}</span>
      </div>`;
  }

  _row(p) {
    const esc = App.utils.escapeHtml;
    const c = this._counts(p.id);
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const color = this._folderColor(p);
    const open = this.expanded.has(p.id);
    const done = !this._isActive(p);
    const due = p.dueDate ? this._fmtDue(p.dueDate) : '';
    const overdue = !done && this._dueBucket(p) === 'overdue';
    const prog = total
      ? `<span class="pv-track"><span class="pv-fill" style="width:${pct}%"></span></span><span class="pv-progtxt"><b>${c.open}</b> open · ${c.done} done</span>`
      : `<span class="pv-progtxt pv-progtxt-empty">No tasks yet</span>`;
    const check = App.can('tasks.write')
      ? `<button class="pv-check${done ? ' done' : ''}" data-done="${esc(p.id)}" type="button" aria-label="${done ? 'Reopen folder' : 'Mark folder complete'}" title="${done ? 'Reopen folder' : 'Mark complete'}"><i class="ti ti-check"></i></button>`
      : '';
    let drawer = '';
    if (open) {
      const tasks = this._folderTasks(p.id);
      drawer = `<div class="pv-tasks">${tasks.length
        ? tasks.map(t => this._taskRow(t)).join('')
        : '<div class="pv-noTasks">No tasks in this folder yet.</div>'}</div>`;
    }
    return `
      <div class="pv-rowwrap${open ? ' open' : ''}${done ? ' isdone' : ''}" style="--pc:${esc(color)}">
        <div class="pv-row" data-project="${esc(p.id)}" role="button" tabindex="0">
          <button class="pv-chev" data-toggle="${esc(p.id)}" aria-label="Toggle tasks" aria-expanded="${open}" type="button"><i class="ti ti-chevron-right"></i></button>
          ${check}
          <span class="pv-id"><span class="pv-name">${esc(p.name)}</span>${(p.client || p.address) ? `<span class="pv-client">${esc(p.client || p.address)}</span>` : ''}</span>
          <span class="pv-prog">${prog}</span>
          <span class="pv-duecol${overdue ? ' overdue' : ''}">${due ? 'Due ' + esc(due) : ''}</span>
        </div>
        ${drawer}
      </div>`;
  }

  render() {
    if (!this.wrap) this.wrap = document.getElementById('projectsWrap');
    if (!this.wrap) return;
    const base = this._baseFolders();
    const openTotal = base.reduce((n, p) => n + this._counts(p.id).open, 0);
    const doneTotal = base.reduce((n, p) => n + this._counts(p.id).done, 0);
    const overall = openTotal + doneTotal;
    const pct = overall ? Math.round((doneTotal / overall) * 100) : 0;
    const companies = new Set(base.map(p => p.companyId)).size;

    this.wrap.innerHTML = `
      <div class="pv-head">
        <div>
          <div class="pv-eyebrow">Workspace</div>
          <h1 class="pv-title">Projects</h1>
        </div>
        <div class="pv-head-r">
          <select class="pv-sort" id="proj-sort" aria-label="Sort folders">
            <option value="recent"${this.sort === 'recent' ? ' selected' : ''}>Recently added</option>
            <option value="name"${this.sort === 'name' ? ' selected' : ''}>Name (A–Z)</option>
            <option value="active"${this.sort === 'active' ? ' selected' : ''}>Most active</option>
          </select>
          ${App.can('tasks.write') ? `<button class="pv-new" data-action="new-folder" type="button"><i class="ti ti-plus"></i> New folder</button>` : ''}
        </div>
      </div>

      <div class="pv-kpis">
        <div class="pv-kpi" style="--kc:var(--amber)">
          <span class="pv-kpi-ic"><i class="ti ti-folders"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${base.length}</div><div class="pv-kpi-lbl">Folders</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--u-high)">
          <span class="pv-kpi-ic"><i class="ti ti-list-check"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${openTotal}</div><div class="pv-kpi-lbl">Open tasks</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--green)">
          <span class="pv-kpi-ic"><i class="ti ti-circle-check"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${doneTotal}</div><div class="pv-kpi-lbl">Completed</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--blue)">
          <span class="pv-kpi-ic"><i class="ti ti-building"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${companies}</div><div class="pv-kpi-lbl">Companies</div></div>
        </div>
        <div class="pv-kpi pv-kpi-ring">
          <div class="pv-ring" style="--p:${pct}%"><b>${overall ? pct + '%' : '—'}</b></div>
          <div class="pv-kpi-body"><div class="pv-kpi-cmplbl">Complete</div><div class="pv-kpi-lbl">${overall ? 'across all folders' : 'no tasks filed yet'}</div></div>
        </div>
      </div>

      <div class="pv-body"></div>`;

    const sort = this.wrap.querySelector('#proj-sort');
    if (sort) sort.addEventListener('change', () => { this.sort = sort.value; this._renderBody(); });
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());

    this._renderBody();
  }

  _toggle(id) {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this._renderBody();
  }

  _toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key);
    this._renderBody();
  }

  // Due-date bucket for a folder, mirroring TaskModel.groupByDue.
  _dueBucket(p) {
    if (!p.dueDate) return 'none';
    const t0 = App.utils.todayISO(0), t1 = App.utils.todayISO(1), t7 = App.utils.todayISO(7);
    const d = p.dueDate;
    if (d < t0) return 'overdue';
    if (d === t0) return 'today';
    if (d === t1) return 'tomorrow';
    if (d <= t7) return 'week';
    return 'later';
  }

  _renderBody() {
    const host = this.wrap && this.wrap.querySelector('.pv-body');
    if (!host) return;
    const esc = App.utils.escapeHtml;
    const folders = this._visibleFolders();
    if (!folders.length) {
      host.innerHTML = `<div class="pv-blank">No folders yet — create one to group related tasks.</div>`;
      return;
    }
    const BUCKETS = [
      { key: 'overdue',  label: 'Overdue',     color: 'var(--rust)' },
      { key: 'today',    label: 'Today',       color: 'var(--u-high)' },
      { key: 'tomorrow', label: 'Tomorrow',    color: 'var(--u-high)' },
      { key: 'week',     label: 'This week',   color: 'var(--blue)' },
      { key: 'later',    label: 'Upcoming',    color: 'var(--green)' },
      { key: 'none',     label: 'No due date', color: 'var(--pv-ink-4)' },
      { key: 'done',     label: 'Completed',   color: 'var(--pv-ink-4)' },
    ];

    // One box per company (appearance order); inside, folders split into
    // due-date groups — active folders by due bucket, closed folders under
    // Completed (auto-collapsed the first time it appears).
    const byCo = {};
    folders.forEach(p => { (byCo[p.companyId] = byCo[p.companyId] || []).push(p); });

    let html = '';
    Object.keys(byCo).forEach(cid => {
      const co = App.COMPANIES[cid] || { label: cid };
      const list = byCo[cid];
      const byBucket = {};
      list.forEach(p => {
        const b = this._isActive(p) ? this._dueBucket(p) : 'done';
        (byBucket[b] = byBucket[b] || []).push(p);
      });
      let inner = '';
      BUCKETS.forEach(b => {
        const rows = byBucket[b.key];
        if (!rows || !rows.length) return;
        const gkey = cid + '::' + b.key;
        if (b.key === 'done' && !this._seenDone.has(gkey)) { this._seenDone.add(gkey); this.collapsed.add(gkey); }
        const collapsed = this.collapsed.has(gkey);
        inner += `<div class="pv-duegroup${collapsed ? ' collapsed' : ''}">
          <div class="pv-duehdr" data-group="${esc(gkey)}" role="button" tabindex="0">
            <span class="pv-duechev"><i class="ti ti-chevron-down"></i></span>
            <span class="pv-duedot" style="background:${b.color}"></span>
            <span class="pv-duename">${b.label}</span>
            <span class="pv-duecnt">${rows.length}</span>
          </div>
          ${collapsed ? '' : rows.map(p => this._row(p)).join('')}
        </div>`;
      });
      html += `<section class="pv-cobox" style="--co:${this._companyColor(cid)}">
        <div class="pv-cohead">
          <span class="pv-codot"></span>
          <span class="pv-coname">${esc(co.label)}</span>
          <span class="pv-cocnt">${list.length}</span>
        </div>
        ${inner}
      </section>`;
    });
    host.innerHTML = html;

    host.querySelectorAll('.pv-duehdr').forEach(h =>
      h.addEventListener('click', () => this._toggleGroup(h.dataset.group)));
    host.querySelectorAll('.pv-check').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.done;
        const p = (App.projects || {})[id];
        const reopen = p && !this._isActive(p);
        this.controller.setProjectStatus(id, reopen ? 'active' : 'done');
      }));
    host.querySelectorAll('.pv-chev').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(btn.dataset.toggle); }));
    host.querySelectorAll('.pv-row').forEach(row =>
      row.addEventListener('click', () => this.controller.openProject(row.dataset.project)));
    host.querySelectorAll('.pv-trow[data-task]').forEach(row =>
      row.addEventListener('click', (e) => { e.stopPropagation(); this.controller.selectTask(row.dataset.task); }));
  }
};
