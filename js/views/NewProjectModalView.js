window.App = window.App || {};

/* NewProjectModalView — create a project. Mirrors NewTaskModalView's shell
   (same .modal chrome, drag-to-resize, Ctrl+Enter / Esc), with project fields.
   The shared sizing/resize/typography come from the :is(#newTaskModal,
   #newProjectModal) CSS rules. */
App.NewProjectModalView = class NewProjectModalView {
  constructor({ controller }) {
    this.controller = controller;
    this.modal = null;
  }

  open() {
    if (this.modal) return;
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'newProjectModal';
    this.modal.innerHTML = this.template();
    document.body.appendChild(this.modal);
    this.bindEvents();
    setTimeout(() => { const el = document.getElementById('np-name'); if (el) el.focus(); }, 50);
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  _companyOptions() {
    // Projects belong to a real company, so exclude the developer/all-companies
    // '*' sentinel; default to the active company (or the first accessible one).
    let ids = (this.controller.uiState.companies || []).filter(id => id !== '*');
    if (!ids.length) ids = Object.keys(App.COMPANIES || {});
    const cur = this.controller.uiState.currentCompany;
    const sel = (cur && cur !== '*') ? cur : ids[0];
    return ids.map(id => {
      const c = App.COMPANIES[id] || { label: id };
      return `<option value="${App.utils.escapeHtml(id)}" ${id === sel ? 'selected' : ''}>${App.utils.escapeHtml(c.label)}</option>`;
    }).join('');
  }

  template() {
    const statuses = [
      ['active', 'Active'], ['lead', 'Lead'], ['hold', 'On hold'],
      ['complete', 'Complete'], ['cancelled', 'Cancelled'],
    ];
    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">New project</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field field-title">
            <input type="text" id="np-name" placeholder="Project name" maxlength="120" autofocus />
          </div>

          <div class="field-row" style="margin-top:8px;">
            <div>
              <div class="field-label">Company</div>
              <select id="np-company" style="width:100%; padding:6px 10px; font-size:12px;">
                ${this._companyOptions()}
              </select>
            </div>
            <div>
              <div class="field-label">Status</div>
              <select id="np-status" style="width:100%; padding:6px 10px; font-size:12px;">
                ${statuses.map(([k, label]) => `<option value="${k}" ${k === 'active' ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="field" style="margin-top:14px;">
            <div class="field-label">Address <span class="field-optional">Optional</span></div>
            <input type="text" id="np-address" placeholder="Job site / location" maxlength="200" style="width:100%; padding:6px 10px; font-size:12px;" />
          </div>
        </div>
        <div class="modal-foot">
          <span style="font-size:10.5px; color: var(--ink-3);">Press <kbd>Ctrl ↵</kbd> to create</span>
          <div style="display:flex; gap:6px;">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Create project</button>
          </div>
        </div>
        <div class="modal-resize-handle" data-stop title="Drag to resize"></div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal && !this._resizing) this.close();
      if (e.target.closest('[data-stop]') && !e.target.closest('[data-action]')) e.stopPropagation();
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => this.close()));
    this.modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submit());
    this.modal.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') this.close();
    });
    this._bindResize();
  }

  // Drag-to-resize from the bottom-left grip — identical behaviour to the New
  // task modal (width grows symmetrically; text zooms via --nt-scale).
  _bindResize() {
    const handle = this.modal.querySelector('.modal-resize-handle');
    const panel = this.modal.querySelector('.modal');
    if (!handle || !panel) return;
    const baseW = panel.getBoundingClientRect().width || 540;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._resizing = true;
      const startX = e.clientX, startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      const startW = rect.width, startH = rect.height;
      const onMove = (ev) => {
        const maxW = window.innerWidth * 0.97;
        const maxH = window.innerHeight * 0.95;
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        const w = Math.max(380, Math.min(maxW, startW + (startX - ev.clientX) * 2));
        panel.style.width = w + 'px';
        panel.style.height = Math.max(280, Math.min(maxH, startH + (ev.clientY - startY))) + 'px';
        const scale = Math.max(0.85, Math.min(2, w / baseW));
        panel.style.setProperty('--nt-scale', scale.toFixed(3));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        setTimeout(() => { this._resizing = false; }, 0);
      };
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  submit() {
    if (!this.modal) return;
    const name = document.getElementById('np-name').value.trim();
    if (!name) {
      const el = document.getElementById('np-name');
      el.focus();
      el.style.borderBottom = '1px solid var(--rust)';
      if (this.controller.toastView) this.controller.toastView.show({ title: 'Project needs a name', sub: 'Enter a name to create it.' });
      return;
    }
    const companyId = document.getElementById('np-company').value;
    const address = document.getElementById('np-address').value.trim();
    const status = document.getElementById('np-status').value;
    this.controller.createProject(name, companyId, { address, status }).then(proj => {
      if (proj && this.controller.toastView) this.controller.toastView.show({ title: 'Project created', sub: proj.name });
    });
    this.close();
  }
};
