window.App = window.App || {};

/* NewFolderView — the "New folder" dialog opened from the Projects grid.
   Replaces the native window.prompt() with the app's own modal shell
   (.modal-backdrop / .modal), so it matches the rest of Quest HQ instead of
   showing the browser's "task.questroofing.com says" chrome.

   Promise-based: open() resolves to { name, companyId } when the user creates
   a folder, or null on Cancel / Escape / backdrop click. The company <select>
   only appears when the caller passes more than one option (multi-company user
   with "All companies" active); otherwise the caller has already resolved it. */
App.NewFolderView = class NewFolderView {
  constructor() {
    this.modal = null;
    this._resolve = null;
  }

  /* opts: { companies?: string[], defaultCompany?: string } */
  open(opts = {}) {
    if (this.modal) return Promise.resolve(null);
    const companies = (opts.companies || []).filter(Boolean);
    const defaultCompany = opts.defaultCompany || companies[0] || '';

    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'newFolderModal';
    this.modal.innerHTML = this.template({ companies, defaultCompany });
    document.body.appendChild(this.modal);
    this.bindEvents();

    // Focus the name field once the slide-up animation has settled.
    setTimeout(() => {
      const input = document.getElementById('nf-name');
      if (input) input.focus();
    }, 50);

    return new Promise((resolve) => { this._resolve = resolve; });
  }

  template({ companies, defaultCompany }) {
    const companyField = companies.length > 1 ? `
      <div class="field" style="margin-top:14px;">
        <label class="field-label" for="nf-company">Company</label>
        <select id="nf-company">
          ${companies.map((id) => {
            const label = (App.directory.company(id) || App.directory.companyFallback(id)).label;
            const sel = id === defaultCompany ? ' selected' : '';
            return `<option value="${App.utils.escapeHtml(id)}"${sel}>${App.utils.escapeHtml(label)}</option>`;
          }).join('')}
        </select>
      </div>` : '';

    return `
      <div class="modal" data-stop role="dialog" aria-modal="true" aria-labelledby="nf-title">
        <div class="modal-head">
          <div class="modal-title" id="nf-title">New project</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="nf-name">Project name</label>
            <input id="nf-name" type="text" maxlength="80" autocomplete="off"
                   placeholder="e.g. Q3 Reroof — Maple St" />
          </div>
          ${companyField}
          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="create" disabled>Create project</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Backdrop click (outside the .modal) cancels.
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this._done(null);
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach((el) => {
      el.addEventListener('click', () => this._done(null));
    });
    this.modal.querySelector('[data-action="create"]').addEventListener('click', () => this._submit());

    const input = this.modal.querySelector('#nf-name');
    const createBtn = this.modal.querySelector('[data-action="create"]');
    // Keep Create disabled until there's a real name — mirrors the old prompt's
    // "empty name → do nothing" behaviour but without letting the user click.
    input.addEventListener('input', () => {
      createBtn.disabled = input.value.trim().length === 0;
    });

    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this._done(null); }
      if (e.key === 'Enter') { e.preventDefault(); this._submit(); }
    });
  }

  _submit() {
    const name = (this.modal.querySelector('#nf-name').value || '').trim();
    if (!name) return;
    const companySel = this.modal.querySelector('#nf-company');
    const companyId = companySel ? companySel.value : '';
    this._done({ name, companyId });
  }

  _done(result) {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    const resolve = this._resolve;
    this._resolve = null;
    if (resolve) resolve(result);
  }
};
