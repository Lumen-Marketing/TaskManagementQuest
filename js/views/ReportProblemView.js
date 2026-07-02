window.App = window.App || {};

/* ReportProblemView — "Report a problem" modal, opened from the account menu.
   Any role can submit. The description + a small auto-context bundle go to the
   report-problem Edge Function (via dataStore.submitBugReport), which stores
   the report and best-effort emails the developer. Identity is derived
   server-side from the JWT — nothing here names the reporter. */
App.ReportProblemView = class ReportProblemView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.modal = null;
    this.type = 'bug';
  }

  open() {
    if (this.modal) return;
    this.type = 'bug';
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'reportModal';
    this.modal.innerHTML = this.template();
    document.body.appendChild(this.modal);
    this.bindEvents();
    setTimeout(() => {
      const input = document.getElementById('rp-desc');
      if (input) input.focus();
    }, 50);
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  template() {
    const types = [['bug', 'Bug'], ['problem', 'Problem'], ['suggestion', 'Suggestion']];
    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">Report a problem</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label">What kind?</label>
            <div class="report-type-toggle" role="group" aria-label="Report type">
              ${types.map(([v, l]) => `
                <button type="button" class="theme-opt ${this.type === v ? 'active' : ''}"
                        data-report-type="${v}" aria-pressed="${this.type === v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:14px;">
            <label class="field-label" for="rp-desc">What happened?</label>
            <textarea id="rp-desc" maxlength="2000" rows="6"
              placeholder="What happened? What did you expect?"></textarea>
            <div class="rp-count" id="rp-count">0 / 2000</div>
          </div>
          <div class="rp-note">Your name, current page, and browser info are included automatically.</div>
          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Send report</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach(el => {
      el.addEventListener('click', () => this.close());
    });
    this.modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submit());
    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });
    this.modal.querySelectorAll('[data-report-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.type = btn.dataset.reportType;
        this.modal.querySelectorAll('[data-report-type]').forEach(b => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    });
    const desc = document.getElementById('rp-desc');
    desc.addEventListener('input', () => {
      const counter = document.getElementById('rp-count');
      if (counter) counter.textContent = `${desc.value.length} / 2000`;
    });
  }

  /* Diagnostics attached silently to every report (disclosed in the modal). */
  _context() {
    const ui = (this.controller && this.controller.uiState) || {};
    return {
      view: String(ui.view || ''),
      company: String(ui.currentCompany || ''),
      userAgent: String(navigator.userAgent || ''),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      path: String(window.location.pathname || ''),
    };
  }

  async submit() {
    const desc = document.getElementById('rp-desc');
    const description = (desc.value || '').trim();
    if (!description) {
      this._inlineError('Please describe the problem.');
      return;
    }

    const submitBtn = this.modal.querySelector('[data-action="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const result = await this.dataStore.submitBugReport({
      type: this.type,
      description,
      context: this._context(),
    });

    if (!this.modal) return; // closed while in flight
    if (result.ok) {
      this.modal.querySelector('.modal-body').innerHTML = `
        <div class="rp-thanks">
          <i class="ti ti-circle-check"></i>
          <div class="rp-thanks-title">Thanks — your report was sent to the developer.</div>
        </div>
      `;
      setTimeout(() => this.close(), 1600);
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    this._inlineError(result.status === 429
      ? "You've sent several reports recently — please wait a bit."
      : (result.error || 'Could not send the report.'));
  }

  _inlineError(msg) {
    const existing = this.modal.querySelector('.profile-inline-error');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'profile-inline-error';
    div.textContent = msg;
    const actions = this.modal.querySelector('.modal-actions');
    actions.parentNode.insertBefore(div, actions);
    setTimeout(() => { if (div.parentNode) div.remove(); }, 4000);
  }
};
