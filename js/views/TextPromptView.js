window.App = window.App || {};

/* TextPromptView — a generic single-field prompt modal; the app's replacement
   for window.prompt(). Reuses the shared .modal-backdrop / .modal shell (like
   NewFolderView) so it matches Quest HQ instead of the browser's native dialog.

   Promise-based: open(opts) resolves to the trimmed string on confirm, or null
   on Cancel / Escape / backdrop click.
   opts: { title, label, placeholder, confirmLabel, value, maxLength } */
App.TextPromptView = class TextPromptView {
  constructor() {
    this.modal = null;
    this._resolve = null;
  }

  open(opts = {}) {
    if (this.modal) return Promise.resolve(null);
    const o = {
      title: opts.title || 'Name',
      label: opts.label || 'Name',
      placeholder: opts.placeholder || '',
      confirmLabel: opts.confirmLabel || 'Save',
      value: opts.value || '',
      maxLength: opts.maxLength || 80,
    };
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'textPromptModal';
    this.modal.innerHTML = this.template(o);
    document.body.appendChild(this.modal);
    this.bindEvents();
    setTimeout(() => {
      const input = document.getElementById('tp-input');
      if (input) { input.focus(); input.select(); }
    }, 50);
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  template(o) {
    const esc = App.utils.escapeHtml;
    return `
      <div class="modal" data-stop role="dialog" aria-modal="true" aria-labelledby="tp-title">
        <div class="modal-head">
          <div class="modal-title" id="tp-title">${esc(o.title)}</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="tp-input">${esc(o.label)}</label>
            <input id="tp-input" type="text" maxlength="${o.maxLength}" autocomplete="off"
                   value="${esc(o.value)}" placeholder="${esc(o.placeholder)}" />
          </div>
          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="confirm"${o.value.trim() ? '' : ' disabled'}>${esc(o.confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this._done(null); });
    this.modal.querySelectorAll('[data-action="close"]').forEach((el) =>
      el.addEventListener('click', () => this._done(null)));
    this.modal.querySelector('[data-action="confirm"]').addEventListener('click', () => this._submit());

    const input = this.modal.querySelector('#tp-input');
    const confirmBtn = this.modal.querySelector('[data-action="confirm"]');
    input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim().length === 0; });

    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this._done(null); }
      if (e.key === 'Enter') { e.preventDefault(); this._submit(); }
    });
  }

  _submit() {
    const v = (this.modal.querySelector('#tp-input').value || '').trim();
    if (!v) return;
    this._done(v);
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
