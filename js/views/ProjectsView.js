window.App = window.App || {};

/* Projects grid: warm, borderless folder cards (panze surface) grouped by
   company. Each folder carries its own color — a solid monogram tile, a
   completion bar, and live open/done counts from the loaded tasks. Card click
   scopes the task list to that folder (controller.openProject). */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.showTerminal = false;
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

  _folders() {
    const active = ['lead', 'active', 'hold'];
    const cur = this.controller.uiState.currentCompany;
    return Object.values(App.projects || {})
      .filter(p => !cur || cur === '*' || p.companyId === cur)
      .filter(p => this.showTerminal || active.includes(p.status));
  }

  // Company identity color as a theme-aware CSS var; folders may override with
  // their own stored color (anything other than the neutral default).
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
    const folders = this._folders();
    const openTotal = folders.reduce((n, p) => n + this._counts(p.id).open, 0);
    const doneTotal = folders.reduce((n, p) => n + this._counts(p.id).done, 0);

    // Group by company; render flat (no section headers) when only one company
    // is in view, so a single-company workspace doesn't get sparse one-card rows.
    const byCo = {};
    folders.forEach(p => { (byCo[p.companyId] = byCo[p.companyId] || []).push(p); });
    const coIds = Object.keys(byCo);
    let body;
    if (!folders.length) {
      body = `<div class="pv-blank">No folders yet — create one to group related tasks.</div>`;
    } else if (coIds.length <= 1) {
      body = `<div class="pv-grid">${folders.map(p => this._card(p)).join('')}</div>`;
    } else {
      body = coIds.map(cid => {
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

    this.wrap.innerHTML = `
      <div class="pv-head">
        <div>
          <div class="pv-eyebrow">Workspace</div>
          <h1 class="pv-title">Projects</h1>
        </div>
        <div class="pv-head-r">
          <label class="pv-toggle"><input type="checkbox" id="proj-show-terminal" ${this.showTerminal ? 'checked' : ''}/> Show completed</label>
          ${App.can('tasks.write') ? `<button class="pv-new" data-action="new-folder" type="button"><i class="ti ti-plus"></i> New folder</button>` : ''}
        </div>
      </div>
      <div class="pv-stats">
        <div class="pv-stat"><div class="pv-stat-num">${folders.length}</div><div class="pv-stat-lbl" style="--sc:var(--amber)">Folders</div></div>
        <div class="pv-stat"><div class="pv-stat-num">${openTotal}</div><div class="pv-stat-lbl" style="--sc:var(--u-high)">Open tasks</div></div>
        <div class="pv-stat"><div class="pv-stat-num">${doneTotal}</div><div class="pv-stat-lbl" style="--sc:var(--green)">Completed</div></div>
      </div>
      ${body}`;

    const toggle = this.wrap.querySelector('#proj-show-terminal');
    if (toggle) toggle.addEventListener('change', () => { this.showTerminal = toggle.checked; this.render(); });
    this.wrap.querySelectorAll('.pv-card').forEach(card =>
      card.addEventListener('click', () => this.controller.openProject(card.dataset.project)));
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());
  }
};
