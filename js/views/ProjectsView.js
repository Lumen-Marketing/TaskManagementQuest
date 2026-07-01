window.App = window.App || {};

/* Projects view: a warm, borderless TABLE of folders (panze surface). A boxed
   summary (stat segments + completion ring) and a toolbar (sort / show-completed)
   sit above. Each folder is a row with a progress bar; its chevron expands the
   row to reveal all of that folder's tasks. Clicking a folder row scopes the
   task list to it (controller.openProject); clicking a task opens it. */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.showTerminal = false;
    this.sort = 'recent';
    this.expanded = new Set();
    App.EventBus.on('view:changed', (v) => { if (v === 'projects') this.render(); });
    App.EventBus.on('projects:changed', () => { if (this._visible()) this.render(); });
    App.EventBus.on('tasks:changed', () => { if (this._visible()) this.render(); });
    App.EventBus.on('company:changed', () => { if (this._visible()) this.render(); });
  }

  _visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _counts(id) {
    const all = this.taskModel.all().filter(t => t.project === id);
    return { open: all.filter(t => t.status !== 'done').length, done: all.filter(t => t.status === 'done').length };
  }

  _folderTasks(id) {
    const rank = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
    return this.taskModel.all().filter(t => t.project === id)
      .sort((a, b) =>
        ((a.status === 'done') - (b.status === 'done')) ||
        ((rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)) ||
        String(a.due || '').localeCompare(String(b.due || '')));
  }

  _baseFolders() {
    const active = ['lead', 'active', 'hold'];
    const cur = this.controller.uiState.currentCompany;
    return Object.values(App.projects || {})
      .filter(p => !cur || cur === '*' || p.companyId === cur)
      .filter(p => this.showTerminal || active.includes(p.status));
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
  _monogram(name) { return (String(name || '').trim()[0] || '?').toUpperCase(); }
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
    const done = t.status === 'done';
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
    const co = App.COMPANIES[p.companyId] || { label: p.companyId || '' };
    const open = this.expanded.has(p.id);
    const due = p.dueDate ? this._fmtDue(p.dueDate) : '';
    const progTxt = total
      ? `<b>${c.open}</b> open · ${c.done} done`
      : 'No tasks yet';
    let drawer = '';
    if (open) {
      const tasks = this._folderTasks(p.id);
      drawer = `<div class="pv-tasks">${tasks.length
        ? tasks.map(t => this._taskRow(t)).join('')
        : '<div class="pv-noTasks">No tasks in this folder yet.</div>'}</div>`;
    }
    return `
      <div class="pv-rowwrap${open ? ' open' : ''}" style="--pc:${esc(color)}">
        <div class="pv-row" data-project="${esc(p.id)}" role="button" tabindex="0">
          <button class="pv-chev" data-toggle="${esc(p.id)}" aria-label="Toggle tasks" aria-expanded="${open}" type="button"><i class="ti ti-chevron-right"></i></button>
          <span class="pv-mono">${esc(this._monogram(p.name))}</span>
          <span class="pv-id"><span class="pv-name">${esc(p.name)}</span><span class="pv-client">${esc(p.client || p.address || 'No client')}</span></span>
          <span class="pv-prog"><span class="pv-track"><span class="pv-fill" style="width:${pct}%"></span></span><span class="pv-progtxt">${progTxt}</span></span>
          <span class="pv-cocol">${esc(co.label)}</span>
          <span class="pv-duecol">${due ? 'Due ' + esc(due) : ''}</span>
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
          ${App.can('tasks.write') ? `<button class="pv-new" data-action="new-folder" type="button"><i class="ti ti-plus"></i> New folder</button>` : ''}
        </div>
      </div>

      <div class="pv-summary">
        <div class="pv-seg"><div class="pv-seg-num">${base.length}</div><div class="pv-seg-lbl" style="--sc:var(--amber)">Folders</div></div>
        <div class="pv-seg"><div class="pv-seg-num">${openTotal}</div><div class="pv-seg-lbl" style="--sc:var(--u-high)">Open tasks</div></div>
        <div class="pv-seg"><div class="pv-seg-num">${doneTotal}</div><div class="pv-seg-lbl" style="--sc:var(--green)">Completed</div></div>
        <div class="pv-seg"><div class="pv-seg-num">${companies}</div><div class="pv-seg-lbl" style="--sc:var(--blue)">Companies</div></div>
        <div class="pv-ring-wrap">
          <div class="pv-ring" style="--p:${pct}%"><b>${overall ? pct + '%' : '—'}</b></div>
          <div class="pv-ring-lbl">${overall ? 'complete across all folders' : 'no tasks filed yet'}</div>
        </div>
      </div>

      <div class="pv-tools">
        <div class="pv-tools-r">
          <select class="pv-sort" id="proj-sort" aria-label="Sort folders">
            <option value="recent"${this.sort === 'recent' ? ' selected' : ''}>Recently added</option>
            <option value="name"${this.sort === 'name' ? ' selected' : ''}>Name (A–Z)</option>
            <option value="active"${this.sort === 'active' ? ' selected' : ''}>Most active</option>
          </select>
          <label class="pv-toggle"><input type="checkbox" id="proj-show-terminal" ${this.showTerminal ? 'checked' : ''}/> Show completed</label>
        </div>
      </div>

      <div class="pv-body"></div>`;

    const sort = this.wrap.querySelector('#proj-sort');
    if (sort) sort.addEventListener('change', () => { this.sort = sort.value; this._renderBody(); });
    const toggle = this.wrap.querySelector('#proj-show-terminal');
    if (toggle) toggle.addEventListener('change', () => { this.showTerminal = toggle.checked; this.render(); });
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());

    this._renderBody();
  }

  _toggle(id) {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this._renderBody();
  }

  _renderBody() {
    const host = this.wrap && this.wrap.querySelector('.pv-body');
    if (!host) return;
    const folders = this._visibleFolders();
    if (!folders.length) {
      host.innerHTML = `<div class="pv-blank">No folders yet — create one to group related tasks.</div>`;
      return;
    }
    host.innerHTML = `<div class="pv-table">${folders.map(p => this._row(p)).join('')}</div>`;

    host.querySelectorAll('.pv-chev').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(btn.dataset.toggle); }));
    host.querySelectorAll('.pv-row').forEach(row =>
      row.addEventListener('click', () => this.controller.openProject(row.dataset.project)));
    host.querySelectorAll('.pv-trow[data-task]').forEach(row =>
      row.addEventListener('click', (e) => { e.stopPropagation(); this.controller.selectTask(row.dataset.task); }));
  }
};
