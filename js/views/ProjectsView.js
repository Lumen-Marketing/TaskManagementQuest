window.App = window.App || {};

/* Projects grid: warm, borderless folder cards (panze surface) grouped by
   company. A boxed summary component (stat segments split by dividers + an
   overall completion ring) and a toolbar (search / sort / show-completed) sit
   above the grid. Each folder carries its own color — a solid monogram tile, a
   completion bar, and live open/done counts. Card click scopes the task list
   to that folder (controller.openProject). */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.showTerminal = false;
    this.sort = 'recent';
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

  // Folders in scope (sidebar company + show-completed), before search/sort.
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

  _visibleFolders() {
    return this._sortFolders(this._baseFolders());
  }

  _companyColor(companyId) {
    return ({ roofing: 'var(--u-high)', drafting: 'var(--blue)', lumen: 'var(--amber)' })[companyId] || 'var(--amber)';
  }
  _folderColor(p) {
    return (p.color && p.color.toLowerCase() !== '#8f867b') ? p.color : this._companyColor(p.companyId);
  }
  _monogram(name) { return (String(name || '').trim()[0] || '?').toUpperCase(); }
  _fmtDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? '' : 'Due ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  _card(p) {
    const esc = App.utils.escapeHtml;
    const c = this._counts(p.id);
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const color = this._folderColor(p);
    const co = App.COMPANIES[p.companyId] || { label: p.companyId || '' };
    const sub = p.client || p.address || 'No client';
    const foot = total
      ? `<span class="pv-counts"><b>${c.open}</b> open&nbsp;&nbsp;·&nbsp;&nbsp;${c.done} done</span>`
      : `<span class="pv-empty">No tasks yet</span>`;
    const right = total
      ? `<span class="pv-pct">${pct}%</span>`
      : (p.dueDate ? `<span class="pv-due">${esc(this._fmtDue(p.dueDate))}</span>` : '');
    return `
      <button class="pv-card" data-project="${esc(p.id)}" style="--pc:${esc(color)}" type="button">
        <span class="pv-card-top">
          <span class="pv-mono">${esc(this._monogram(p.name))}</span>
          <span class="pv-id"><span class="pv-name">${esc(p.name)}</span><span class="pv-client">${esc(sub)}</span></span>
          <span class="pv-cochip">${esc(co.label)}</span>
        </span>
        <span class="pv-foot">
          <span class="pv-track"><span class="pv-fill" style="width:${pct}%"></span></span>
          <span class="pv-meta">${foot}${right}</span>
        </span>
      </button>`;
  }

  render() {
    if (!this.wrap) this.wrap = document.getElementById('projectsWrap');
    if (!this.wrap) return;
    const esc = App.utils.escapeHtml;
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

  // Grid only — re-run on search/sort so the search field keeps focus.
  _renderBody() {
    const host = this.wrap && this.wrap.querySelector('.pv-body');
    if (!host) return;
    const esc = App.utils.escapeHtml;
    const folders = this._visibleFolders();
    if (!folders.length) {
      host.innerHTML = `<div class="pv-blank">No folders yet — create one to group related tasks.</div>`;
      return;
    }
    // Group by company, unless only one company is in view.
    const byCo = {};
    folders.forEach(p => { (byCo[p.companyId] = byCo[p.companyId] || []).push(p); });
    const coIds = Object.keys(byCo);
    if (coIds.length <= 1) {
      host.innerHTML = `<div class="pv-grid">${folders.map(p => this._card(p)).join('')}</div>`;
    } else {
      host.innerHTML = coIds.map(cid => {
        const co = App.COMPANIES[cid] || { label: cid };
        const n = byCo[cid].length;
        return `
          <section class="pv-section">
            <div class="pv-sec-head" style="--sc:${this._companyColor(cid)}">
              <span class="pv-sec-dot"></span>
              <span class="pv-sec-label">${esc(co.label)}</span>
              <span class="pv-sec-count">${n} folder${n > 1 ? 's' : ''}</span>
            </div>
            <div class="pv-grid">${byCo[cid].map(p => this._card(p)).join('')}</div>
          </section>`;
      }).join('');
    }
    host.querySelectorAll('.pv-card').forEach(card =>
      card.addEventListener('click', () => this.controller.openProject(card.dataset.project)));
  }
};
