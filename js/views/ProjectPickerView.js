window.App = window.App || {};

/* Shared folder picker popover. One instance (App.projectPicker), mounted on
   <body>, position:fixed so it escapes row clipping. Search + "No project" +
   company-scoped folder list + inline "Create '<query>'". Reports the choice
   via onSelect(projectIdOrNull). */
App.ProjectPickerView = class ProjectPickerView {
  constructor({ controller }) {
    this.controller = controller;
    this.el = null;
    this._onDocDown = (e) => {
      if (!this.el || this.el.classList.contains('hidden')) return;
      if (this.el.contains(e.target)) return;
      if (this._anchor && this._anchor.contains(e.target)) return;
      this.close();
    };
    document.addEventListener('pointerdown', this._onDocDown, true);
    window.addEventListener('resize', () => this.close());
    window.addEventListener('scroll', () => this.close(), true);
  }

  _ensure() {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'proj-picker status-menu hidden';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Set project');
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  open({ anchor, companyId, currentId, onSelect }) {
    const el = this._ensure();
    if (this._anchor === anchor && !el.classList.contains('hidden')) { this.close(); return; }
    this._anchor = anchor;
    this._companyId = companyId;
    this._currentId = currentId || null;
    this._onSelect = onSelect;
    this._query = '';
    this._render();
    el.classList.remove('hidden');
    this._position(anchor);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    const input = el.querySelector('.proj-picker-search');
    if (input) input.focus();
  }

  _options() {
    const all = Object.values(App.projects || {})
      .filter(p => p.companyId === this._companyId && (p.status === 'lead' || p.status === 'active' || p.status === 'hold'));
    const q = this._query.trim().toLowerCase();
    return q ? all.filter(p => p.name.toLowerCase().includes(q)) : all;
  }

  _render() {
    const el = this.el;
    const q = this._query.trim();
    const opts = this._options();
    const exact = opts.some(p => p.name.toLowerCase() === q.toLowerCase());
    const esc = App.utils.escapeHtml;
    const rows = opts.map(p => `
      <button class="status-menu-item proj-picker-item" role="option" data-id="${esc(p.id)}" aria-selected="${p.id === this._currentId}">
        <span class="status-dot" style="background:${esc(p.color)}"></span>
        <span class="status-menu-label">${esc(p.name)}</span>
        <i class="ti ti-check status-menu-check"></i>
      </button>`).join('');
    const createRow = (q && !exact)
      ? `<button class="status-menu-item proj-picker-create" data-create="1"><i class="ti ti-plus"></i><span class="status-menu-label">Create "${esc(q)}"</span></button>`
      : '';
    el.innerHTML = `
      <div class="proj-picker-searchwrap"><input type="text" class="proj-picker-search" placeholder="Search or create…" value="${esc(this._query)}" /></div>
      <button class="status-menu-item proj-picker-item" role="option" data-id="" aria-selected="${!this._currentId}">
        <span class="status-dot" style="background:var(--ink-3)"></span>
        <span class="status-menu-label">No project (unfiled)</span>
        <i class="ti ti-check status-menu-check"></i>
      </button>
      ${rows}${createRow}`;

    const input = el.querySelector('.proj-picker-search');
    input.addEventListener('input', () => { this._query = input.value; this._render(); this._position(this._anchor); const i = this.el.querySelector('.proj-picker-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const c = el.querySelector('.proj-picker-create');
        if (c) this._create(this._query.trim());
        else { const first = el.querySelector('.proj-picker-item[data-id]:not([data-id=""])'); if (first) this._choose(first.dataset.id); }
      }
    });
    el.querySelectorAll('.proj-picker-item').forEach(item =>
      item.addEventListener('click', (e) => { e.stopPropagation(); this._choose(item.dataset.id || null); }));
    const create = el.querySelector('.proj-picker-create');
    if (create) create.addEventListener('click', (e) => { e.stopPropagation(); this._create(this._query.trim()); });
  }

  async _create(name) {
    if (!name) return;
    const id = await this.controller.createProject({ name, companyId: this._companyId });
    if (id) this._choose(id);
  }

  _choose(id) {
    const cb = this._onSelect;
    this.close();
    if (cb) cb(id || null);
  }

  _position(anchor) {
    const el = this.el;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.minWidth = Math.max(r.width, 220) + 'px';
    const mh = el.offsetHeight, mw = el.offsetWidth, gap = 6;
    let top = r.bottom + gap;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - gap - mh);
    let left = r.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
    el.style.top = top + 'px';
    el.style.left = Math.max(8, left) + 'px';
  }

  close() {
    if (!this.el || this.el.classList.contains('hidden')) return;
    this.el.classList.add('hidden');
    if (this._anchor && document.contains(this._anchor)) this._anchor.setAttribute('aria-expanded', 'false');
    this._anchor = null;
  }
};
