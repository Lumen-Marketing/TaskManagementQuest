window.App = window.App || {};

/* Projects grid: folder cards for the user's company-visible folders, with
   live open/done counts computed from the loaded tasks. Card click scopes the
   task list to that folder (controller.openProject). */
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

  render() {
    if (!this.wrap) this.wrap = document.getElementById('projectsWrap');
    if (!this.wrap) return;
    const esc = App.utils.escapeHtml;
    const cards = this._folders().map(p => {
      const c = this._counts(p.id);
      return `
        <button class="proj-card" data-project="${esc(p.id)}" style="--pc:${esc(p.color)}">
          <div class="pc-head"><span class="pc-folder"><i class="ti ti-folder"></i></span><span class="pc-name">${esc(p.name)}</span></div>
          <div class="pc-sub">${p.client ? esc(p.client) : 'No client'}</div>
          <div class="pc-meta">${c.open} open · ${c.done} done</div>
        </button>`;
    }).join('') || `<div class="proj-empty">No folders yet.</div>`;

    this.wrap.innerHTML = `
      <div class="proj-head">
        <h1 class="proj-title">Projects</h1>
        <div class="proj-head-actions">
          <label class="proj-toggle"><input type="checkbox" id="proj-show-terminal" ${this.showTerminal ? 'checked' : ''}/> Show completed</label>
          ${App.can('tasks.write') ? `<button class="btn btn-primary" data-action="new-folder" type="button"><i class="ti ti-plus"></i> New folder</button>` : ''}
        </div>
      </div>
      <div class="proj-grid">${cards}</div>`;

    const toggle = this.wrap.querySelector('#proj-show-terminal');
    if (toggle) toggle.addEventListener('change', () => { this.showTerminal = toggle.checked; this.render(); });
    this.wrap.querySelectorAll('.proj-card').forEach(card =>
      card.addEventListener('click', () => this.controller.openProject(card.dataset.project)));
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());
  }
};
