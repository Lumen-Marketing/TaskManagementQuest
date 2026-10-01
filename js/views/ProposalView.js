window.App = window.App || {};

/* ProposalView — the Proposal step of Bid task -> Underwriting -> Proposal -> Print.

   Two parts:
     1. sectionHtml()/wire(): a compact block inside the Underwriting tab, shown only
        once the underwriting is APPROVED — "Generate proposal", or "Open proposal".
     2. open(): a full-screen overlay (child of <body>, outside the task-detail page the
        30s poll re-renders, so typing is never wiped). Left: editable fields. Right:
        the customer document, live. Print hides everything but the document, so the
        sidebar / topbar / editor never reach the PDF.

   The document comes from App.ProposalDoc.documentHtml(proposal) — proposal fields
   only. This view never hands it anything from the underwriting but the proposal row. */
App.ProposalView = class ProposalView {
  constructor({ controller }) {
    this.controller = controller;
    this.overlay = null;
  }

  _esc(s) { return App.utils.escapeHtml(String(s == null ? '' : s)); }

  /* ---------- section inside the Underwriting tab ---------- */

  // Kick the lazy load for an approved underwriting (called from mount, not render).
  prepare(task, rec) {
    if (rec && rec.status === 'approved') this.controller.loadProposal(rec.id, task.id);
  }

  sectionHtml(task, rec) {
    if (!rec || rec.status !== 'approved') return '';
    const D = App.ProposalDoc;
    const e = this.controller.proposalFor(rec.id);
    const canGen = this.controller.canProposal();
    let body;
    if (e.generating) {
      body = `<div class="uw-muted">Generating proposal…</div>`;
    } else if (e.proposal) {
      const p = e.proposal;
      body = `<div class="pp-card">
          <div class="pp-card-main"><b>${this._esc(D.numberLabel(p.number))}</b> · ${this._esc(p.title)}
            <span class="pp-card-total">${this._esc(D.money(p.total))}</span></div>
          <button class="btn btn-primary" type="button" data-pp-action="open"><i class="ti ti-file-text"></i>Open proposal</button>
        </div>`;
    } else if (!e.loaded && !e.error) {
      body = `<div class="uw-muted">Checking for an existing proposal…</div>`;
    } else if (e.error) {
      body = `<div class="uw-err-form" role="alert">Couldn't load the proposal. <button class="btn btn-sm" type="button" data-pp-action="retry">Retry</button></div>`;
    } else {
      body = `<div class="pp-card">
          <div class="pp-card-main">Create the customer proposal for the approved price of <b>${this._esc(D.money(rec.recommendedSalePrice))}</b>. It is generated once; opening it again later returns the same proposal.</div>
          ${canGen ? `<button class="btn btn-primary" type="button" data-pp-action="generate"><i class="ti ti-file-plus"></i>Generate proposal</button>` : '<div class="uw-muted">Ask an admin or supervisor to generate it.</div>'}
        </div>`;
    }
    return `<section class="uw-sec" aria-label="Proposal" data-pp-section>
      <h3 class="uw-h"><i class="ti ti-file-text"></i>Proposal</h3>${body}</section>`;
  }

  wire(host, task, rec) {
    const on = (sel, fn) => { const el = host.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('[data-pp-action="generate"]', async () => {
      const p = await this.controller.generateProposal(task, rec);
      if (p) this.open(task, rec);
    });
    on('[data-pp-action="open"]', () => this.open(task, rec));
    on('[data-pp-action="retry"]', () => {
      const e = this.controller.proposalFor(rec.id); e.error = null;
      this.controller.loadProposal(rec.id, task.id);
    });
  }

  /* ---------- overlay: edit + print ---------- */

  open(task, rec) {
    const e = this.controller.proposalFor(rec.id);
    if (!e.proposal || this.overlay) return;
    const p = e.proposal;
    const D = App.ProposalDoc;
    const field = (key, label, value, rows) => `<label class="pp-f"><span>${label}</span>${
      rows ? `<textarea data-pp-f="${key}" rows="${rows}">${this._esc(value)}</textarea>`
           : `<input data-pp-f="${key}" value="${this._esc(value)}" autocomplete="off" />`}</label>`;

    const el = document.createElement('div');
    el.id = 'proposalOverlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Proposal');
    el.innerHTML = `
      <div class="pp-bar">
        <button class="btn" type="button" data-pp-act="close"><i class="ti ti-arrow-left"></i>Back to underwriting</button>
        <div class="pp-bar-title">${this._esc(D.numberLabel(p.number))} · <span class="pp-src">generated from the approved underwriting</span></div>
        <span class="pp-saved" data-pp-saved aria-live="polite"></span>
        <button class="btn" type="button" data-pp-act="save"><i class="ti ti-device-floppy"></i>Save</button>
        <button class="btn btn-primary" type="button" data-pp-act="print"><i class="ti ti-printer"></i>Print / Save as PDF</button>
      </div>
      <div class="pp-body">
        <div class="pp-edit">
          <div class="pp-ro"><span>Proposal number</span><b>${this._esc(D.numberLabel(p.number))}</b></div>
          <div class="pp-ro"><span>Total price</span><b>${this._esc(D.money(p.total))}</b><em>from the approved estimate; not editable here</em></div>
          ${field('title', 'Title', p.title)}
          ${field('clientName', 'Client name', p.clientName)}
          ${field('jobAddress', 'Job address', p.jobAddress)}
          ${field('scopeOfWork', 'Scope of work', p.scopeOfWork, 9)}
          ${field('terms', 'Terms', p.terms, 7)}
        </div>
        <div class="pp-paper"><article class="pp-doc" data-pp-doc></article></div>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('pp-open');
    this.overlay = el;

    const state = () => ({
      title: el.querySelector('[data-pp-f="title"]').value,
      clientName: el.querySelector('[data-pp-f="clientName"]').value,
      jobAddress: el.querySelector('[data-pp-f="jobAddress"]').value,
      scopeOfWork: el.querySelector('[data-pp-f="scopeOfWork"]').value,
      terms: el.querySelector('[data-pp-f="terms"]').value,
    });
    let saved = JSON.stringify(state());
    const savedEl = el.querySelector('[data-pp-saved]');
    const paint = () => {
      // Only the proposal row's fields — never anything from the underwriting.
      el.querySelector('[data-pp-doc]').innerHTML = D.documentHtml({ ...e.proposal, ...state() });
      savedEl.textContent = JSON.stringify(state()) === saved ? 'Saved' : 'Unsaved changes';
    };
    const save = async () => {
      const res = await this.controller.saveProposal(rec.id, state());
      if (res.ok) { saved = JSON.stringify(state()); paint(); }
      return res.ok;
    };
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('pp-open');
      el.remove(); this.overlay = null;
      App.EventBus.emit('underwriting:changed', task.id);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape' && !(ev.target && ev.target.closest && ev.target.closest('.pp-edit'))) close();
    };
    document.addEventListener('keydown', onKey, true);

    el.querySelectorAll('[data-pp-f]').forEach((i) => i.addEventListener('input', paint));
    el.querySelector('[data-pp-act="save"]').addEventListener('click', save);
    el.querySelector('[data-pp-act="close"]').addEventListener('click', async () => {
      if (JSON.stringify(state()) !== saved && !(await save())) return; // keep the overlay if the save failed
      close();
    });
    el.querySelector('[data-pp-act="print"]').addEventListener('click', async () => {
      if (JSON.stringify(state()) !== saved && !(await save())) return; // print what is stored
      window.print();
    });
    paint();
    const first = el.querySelector('[data-pp-f="scopeOfWork"]');
    if (first) first.focus();
  }
};
