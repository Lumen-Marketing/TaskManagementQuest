window.App = window.App || {};

/* UnderwritingView — the Underwriting panel on a Bid task's detail page.
   Mounted by TaskDetailView into its "Underwriting" tab; it owns no routing.

   Flow it serves:  Project / Job -> Bid task -> Underwriting -> Estimate
   Breakdown -> Approval.  Four stacked sections:
     1. Estimate  — inputs form (+ live unsaved preview) and the status/decision bar
     2. Estimate Breakdown — every figure with inputs, formula, calculation, result,
        rounding and source (App.UnderwritingTrace, built from the SAVED record)
     3. Estimate History — append-only old -> new / actor / timestamp / reason

   State lives in App.UnderwritingModel (via the controller), never on the DOM or
   the task row: the detail page re-renders wholesale on every task poll, so the
   unsaved draft has to survive that. The one thing this view remembers itself is
   which input had focus, so a background re-render doesn't drop the caret. */
App.UnderwritingView = class UnderwritingView {
  constructor({ controller }) {
    this.controller = controller;
    this._errors = {};   // taskId -> { field: message } from the last failed save
    this._focus = null;  // { taskId, field, start, end }
    this.proposalView = App.ProposalView ? new App.ProposalView({ controller }) : null;
    // A click anywhere that is not one of our inputs ends the "keep my caret"
    // window — otherwise a re-render would steal focus back from wherever the user went.
    document.addEventListener('mousedown', (e) => {
      if (this._focus && !(e.target.closest && e.target.closest('[data-uw-field]'))) this._focus = null;
    }, true);
  }

  get model() { return this.controller.underwriting; }

  /* ---------- formatting ---------- */

  // Thousands separators for display only; the underlying strings stay exact.
  static pretty(s) {
    return String(s).replace(/\d+(?:\.\d+)?/g, (m) => {
      const [w, f] = m.split('.');
      return w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? '.' + f : '');
    });
  }

  static historyValue(field, v) {
    if (v === null || v === undefined || v === '') return 'Not entered';
    const P = App.UnderwritingView.pretty;
    if (field === 'status') return App.UnderwritingCalc.STATUS_LABELS[v] || v;
    if (field === 'roof_area_sqft') return P(v) + ' sqft';
    if (field === 'waste_percent' || field === 'target_margin_percent') return v + '%';
    return '$' + P(v);
  }

  _esc(s) { return App.utils.escapeHtml(String(s == null ? '' : s)); }

  _who(memberId) {
    if (!memberId) return 'Unknown';
    const p = App.directory && App.directory.person(memberId);
    return (p && (p.full || p.name)) || memberId;
  }

  _when(iso) {
    return App.utils.formatInstant(iso, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  }

  /* ---------- mount ---------- */

  mount(host, task) {
    if (!host) return;
    this.host = host;
    this.task = task;
    const id = task.id;

    // Kick off the lazy load the first time this panel is drawn for the task.
    if (!this.model.isLoaded(id)) this.controller.loadTaskUnderwriting(id);

    const rec0 = this.model.record(id);
    if (this.proposalView && rec0) this.proposalView.prepare(task, rec0);

    host.innerHTML = this._html(task);
    this._wire(host, task);
    if (this.proposalView && rec0) this.proposalView.wire(host, task, rec0);
    this._restoreFocus(host, id);
  }

  /* ---------- rendering ---------- */

  _html(task) {
    const id = task.id;
    const m = this.model;
    if (!m.isLoaded(id)) {
      if (m.lastError(id)) {
        return `<div class="uw-empty"><i class="ti ti-cloud-off"></i>
          <div class="uw-empty-t">Couldn't load underwriting</div>
          <button class="btn btn-sm" type="button" data-uw-action="retry"><i class="ti ti-refresh"></i>Retry</button></div>`;
      }
      return `<div class="uw-empty"><div class="uw-empty-t">Loading underwriting…</div></div>`;
    }
    const rec = m.record(id);
    if (!rec) return this._emptyHtml(task);

    return `<div class="uw">
      ${this._headerHtml(task, rec)}
      ${this._formHtml(task, rec)}
      ${this.proposalView ? this.proposalView.sectionHtml(task, rec) : ''}
      ${this._breakdownHtml(id)}
      ${this._historyHtml(id)}
    </div>`;
  }

  _emptyHtml(task) {
    const canManage = App.can('underwriting.manage');
    const proj = task.project ? App.directory.project(task.project) : null;
    return `<div class="uw-empty">
      <i class="ti ti-calculator"></i>
      <div class="uw-empty-t">No underwriting yet</div>
      <div class="uw-empty-s">Start the estimate for this bid${proj ? ' — ' + this._esc(proj.name) : ''}. Roof area, waste, material, labor and margin go in; the recommended sale price and every step behind it come out.</div>
      ${canManage ? `<button class="btn btn-primary" type="button" data-uw-action="create"><i class="ti ti-plus"></i>Start underwriting</button>` : ''}
    </div>`;
  }

  _headerHtml(task, rec) {
    const C = App.UnderwritingCalc;
    const proj = task.project ? App.directory.project(task.project) : null;
    // The client is the project's own text field — shown, never copied or invented.
    const client = proj && proj.client ? proj.client : null;
    return `<div class="uw-head">
      <div class="uw-head-main">
        <span class="uw-status uw-status-${this._esc(rec.status)}" data-uw-status>${this._esc(C.STATUS_LABELS[rec.status] || rec.status)}</span>
        <span class="uw-meta">
          ${proj ? `<span><i class="ti ti-folder"></i>${this._esc(proj.name)}</span>` : '<span class="uw-muted"><i class="ti ti-folder-off"></i>No project</span>'}
          ${client ? `<span><i class="ti ti-building"></i>${this._esc(client)}</span>` : ''}
        </span>
      </div>
      ${rec.status === 'approved' && rec.approvedAt
        ? `<div class="uw-approved">Approved by ${this._esc(this._who(rec.approvedBy))} · ${this._esc(this._when(rec.approvedAt))}</div>` : ''}
    </div>`;
  }

  _field(key, label, unit, draft, errors, editable) {
    const err = errors[key];
    return `<label class="uw-f${err ? ' has-err' : ''}">
      <span class="uw-f-l">${label}</span>
      <span class="uw-f-box">${unit === '$' ? '<span class="uw-f-u">$</span>' : ''}<input class="uw-in" inputmode="decimal" autocomplete="off"
        data-uw-field="${key}" value="${this._esc(draft[key])}" ${editable ? '' : 'disabled'}
        ${err ? `aria-invalid="true" aria-describedby="uwErr-${key}"` : ''}
        placeholder="${key === 'roofAreaSqft' ? 'optional' : '0.00'}" />${unit && unit !== '$' ? `<span class="uw-f-u">${unit}</span>` : ''}</span>
      ${err ? `<span class="uw-f-err" id="uwErr-${key}" role="alert">${this._esc(err)}</span>` : ''}
    </label>`;
  }

  _formHtml(task, rec) {
    const id = task.id;
    const m = this.model;
    const C = App.UnderwritingCalc;
    const canManage = App.can('underwriting.manage');
    const editable = canManage && C.isEditable(rec.status);
    const draft = m.draft(id);
    const errors = this._errors[id] || {};
    const dirty = m.isDirty(id);

    return `<section class="uw-sec" aria-label="Estimate inputs">
      <h3 class="uw-h"><i class="ti ti-calculator"></i>Estimate</h3>
      ${!C.isEditable(rec.status) ? `<div class="uw-lock"><i class="ti ti-lock"></i>This estimate is ${this._esc((C.STATUS_LABELS[rec.status] || rec.status).toLowerCase())} — the numbers that were reviewed are locked.</div>` : ''}
      ${errors.form ? `<div class="uw-err-form" role="alert">${this._esc(errors.form)}</div>` : ''}
      <div class="uw-grid">
        ${this._field('roofAreaSqft', 'Base roof area', 'sqft', draft, errors, editable)}
        ${this._field('wastePercent', 'Waste', '%', draft, errors, editable)}
        ${this._field('materialCost', 'Material cost', '$', draft, errors, editable)}
        ${this._field('laborCost', 'Labor cost', '$', draft, errors, editable)}
        ${this._field('otherCost', 'Other cost', '$', draft, errors, editable)}
        ${this._field('targetMarginPercent', 'Target margin', '%', draft, errors, editable)}
      </div>
      ${editable ? `
        <label class="uw-f uw-f-reason">
          <span class="uw-f-l">Reason for this change <span class="uw-opt">(optional — recorded in history)</span></span>
          <input class="uw-in uw-in-text" data-uw-field="reason" value="${this._esc(draft.reason)}" maxlength="200" autocomplete="off" placeholder="e.g. supplier raised shingle price" />
        </label>
        <div class="uw-preview" data-uw-preview></div>
        <div class="uw-actions">
          <button class="btn btn-primary" type="button" data-uw-action="save" ${dirty || !rec.calculatedAt ? '' : 'disabled'}><i class="ti ti-device-floppy"></i>Save &amp; calculate</button>
          <button class="btn" type="button" data-uw-action="discard" ${dirty ? '' : 'disabled'}>Discard changes</button>
        </div>` : ''}
      ${this._decisionHtml(task, rec)}
    </section>`;
  }

  _decisionHtml(task, rec) {
    const C = App.UnderwritingCalc;
    const next = C.allowedNextStatuses(rec.status);
    if (!next.length) return '';
    const canManage = App.can('underwriting.manage');
    const canApprove = App.can('underwriting.approve');
    const btns = [];
    if (next.includes('ready_for_review') && canManage) {
      const ready = rec.recommendedSalePrice !== null;
      btns.push(`<button class="btn btn-primary" type="button" data-uw-to="ready_for_review" ${ready ? '' : 'disabled title="Save a calculated estimate first"'}><i class="ti ti-send"></i>Submit for review</button>`);
    }
    if (next.includes('approved') && canApprove) {
      btns.push(`<button class="btn btn-primary" type="button" data-uw-to="approved" ${C.canApprove(rec.recommendedSalePrice) ? '' : 'disabled'}><i class="ti ti-circle-check"></i>Approve estimate</button>`);
    }
    if (next.includes('declined') && canApprove) {
      btns.push(`<button class="btn" type="button" data-uw-to="declined"><i class="ti ti-circle-x"></i>Decline</button>`);
    }
    if (next.includes('draft') && canManage) {
      btns.push(`<button class="btn" type="button" data-uw-to="draft"><i class="ti ti-arrow-back-up"></i>Return to draft</button>`);
    }
    if (!btns.length) {
      return rec.status === 'ready_for_review' && !canApprove
        ? `<div class="uw-wait"><i class="ti ti-hourglass"></i>Waiting for an admin to approve or decline.</div>` : '';
    }
    return `<div class="uw-decision">
      <label class="uw-f uw-f-reason">
        <span class="uw-f-l">Note for this decision <span class="uw-opt">(optional)</span></span>
        <input class="uw-in uw-in-text" id="uwDecisionReason" maxlength="200" autocomplete="off" placeholder="Recorded in Estimate History" />
      </label>
      <div class="uw-actions">${btns.join('')}</div>
    </div>`;
  }

  _breakdownHtml(taskId) {
    const steps = this.model.trace(taskId);
    const P = App.UnderwritingView.pretty;
    const src = App.UnderwritingTrace.SOURCE_LABELS;
    const rows = steps.map((s) => {
      const detail = s.formula
        ? `<div class="uw-step-body">
            ${s.inputs.length ? `<div class="uw-k">Inputs</div><ul class="uw-inputs">${s.inputs.map(i => `<li><span>${this._esc(i.label)}</span><b>${this._esc(P(i.value))}</b></li>`).join('')}</ul>` : ''}
            <div class="uw-k">Formula</div><div class="uw-formula">${this._esc(s.formula)}</div>
            ${s.calculationLines.length ? `<div class="uw-k">Calculation</div><div class="uw-calc">${s.calculationLines.map(l => `<div>${this._esc(P(l))}</div>`).join('')}</div>` : ''}
            ${s.roundingNote ? `<div class="uw-k">Rounding</div><div class="uw-round">${this._esc(s.roundingNote)}</div>` : ''}
          </div>` : '';
      const flag = s.verified === true ? ' is-verified' : (s.verified === false ? ' is-mismatch' : '');
      return `<details class="uw-step uw-src-${this._esc(s.source)}${flag}" ${s.formula && s.source !== 'not_entered' ? 'open' : ''} data-uw-step="${this._esc(s.key)}">
        <summary>
          <span class="uw-step-l">${this._esc(s.label)}</span>
          <span class="uw-step-r">${this._esc(P(s.result))}</span>
          <span class="uw-src" title="Source of this figure">${this._esc(src[s.source] || s.source)}</span>
        </summary>
        ${detail}
      </details>`;
    }).join('');
    return `<section class="uw-sec" aria-label="Estimate breakdown">
      <h3 class="uw-h"><i class="ti ti-list-details"></i>Estimate breakdown</h3>
      <p class="uw-note">Built from the last <b>saved</b> calculation. Every figure shows where it came from.</p>
      <div class="uw-steps">${rows}</div>
    </section>`;
  }

  _historyHtml(taskId) {
    const hist = this.model.history(taskId);
    const F = App.UnderwritingView.FIELD_LABELS;
    const V = App.UnderwritingView.historyValue;
    const items = hist.map((h) => `<li class="uw-hi">
        <div class="uw-hi-top"><b>${this._esc(F[h.fieldName] || h.fieldName)}</b>
          <span class="uw-hi-chg"><span class="uw-old">${this._esc(V(h.fieldName, h.oldValue))}</span><i class="ti ti-arrow-right"></i><span class="uw-new">${this._esc(V(h.fieldName, h.newValue))}</span></span></div>
        <div class="uw-hi-meta">${this._esc(this._who(h.changedBy))} · ${this._esc(this._when(h.createdAt))}</div>
        ${h.reason ? `<div class="uw-hi-why">“${this._esc(h.reason)}”</div>` : ''}
      </li>`).join('');
    return `<section class="uw-sec" aria-label="Estimate history">
      <h3 class="uw-h"><i class="ti ti-history"></i>Estimate history</h3>
      ${items ? `<ol class="uw-hist">${items}</ol>` : '<div class="uw-muted">No changes recorded yet.</div>'}
    </section>`;
  }

  /* ---------- wiring ---------- */

  _wire(host, task) {
    const id = task.id;
    const ctl = this.controller;
    const q = (sel) => host.querySelector(sel);

    host.querySelectorAll('[data-uw-field]').forEach((el) => {
      const remember = () => { this._focus = { taskId: id, field: el.dataset.uwField, start: el.selectionStart, end: el.selectionEnd }; };
      el.addEventListener('focus', remember);
      el.addEventListener('keyup', remember);
      el.addEventListener('input', () => {
        remember();
        ctl.setUnderwritingDraftField(id, el.dataset.uwField, el.value);
        if (this._errors[id] && this._errors[id][this._modelKey(el.dataset.uwField)]) {
          delete this._errors[id][this._modelKey(el.dataset.uwField)];
        }
        this._refreshLive(host, id);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && el.dataset.uwField !== 'reason') {
          e.preventDefault();
          // Enter is a shortcut for the Save button: do nothing when Save is disabled
          // (nothing changed), instead of re-submitting an identical estimate.
          const saveBtn = host.querySelector('[data-uw-action="save"]');
          if (saveBtn && !saveBtn.disabled) this._save(id);
        }
      });
    });

    const on = (sel, fn) => { const el = q(sel); if (el) el.addEventListener('click', fn); };
    on('[data-uw-action="create"]', () => ctl.createTaskUnderwriting(id));
    on('[data-uw-action="retry"]', () => ctl.loadTaskUnderwriting(id, { force: true }));
    on('[data-uw-action="save"]', () => this._save(id));
    on('[data-uw-action="discard"]', () => { delete this._errors[id]; ctl.discardUnderwritingDraft(id); });
    host.querySelectorAll('[data-uw-to]').forEach((b) => b.addEventListener('click', () => {
      const reasonEl = q('#uwDecisionReason');
      ctl.setUnderwritingStatus(id, b.dataset.uwTo, reasonEl ? reasonEl.value : '');
    }));

    this._refreshLive(host, id);
  }

  // The form key (draft field) is the same as the data attribute; errors use it too.
  _modelKey(f) { return f; }

  async _save(id) {
    const res = await this.controller.saveUnderwritingDraft(id);
    this._errors[id] = res.ok ? {} : (res.errors || {});
    if (!res.ok) App.EventBus.emit('underwriting:changed', id); // paint field errors
  }

  /* Update the unsaved-preview line and the Save/Discard enabled state in place —
     no re-render, so typing never loses its caret. */
  _refreshLive(host, id) {
    const m = this.model;
    const prev = host.querySelector('[data-uw-preview]');
    const save = host.querySelector('[data-uw-action="save"]');
    const discard = host.querySelector('[data-uw-action="discard"]');
    const rec = m.record(id);
    const dirty = m.isDirty(id);
    if (save && rec) save.disabled = !(dirty || !rec.calculatedAt);
    if (discard) discard.disabled = !dirty;
    if (!prev) return;
    if (!dirty && rec && rec.calculatedAt) { prev.innerHTML = ''; return; }
    const ev = m.evaluateDraft(id);
    const P = App.UnderwritingView.pretty;
    if (ev.ok) {
      prev.innerHTML = `<i class="ti ti-eye"></i>Unsaved preview: recommended sale price <b>$${this._esc(P(ev.data.recommendedSalePrice))}</b> on a total cost of <b>$${this._esc(P(ev.data.totalEstimatedCost))}</b>. Save to record it in the breakdown and history.`;
    } else {
      prev.innerHTML = `<i class="ti ti-info-circle"></i>Fill in waste, the three costs and the target margin (enter 0 where none) to calculate.`;
    }
  }

  _restoreFocus(host, id) {
    const f = this._focus;
    if (!f || f.taskId !== id) return;
    const el = host.querySelector(`[data-uw-field="${f.field}"]`);
    if (!el || el.disabled) return;
    el.focus();
    try { el.setSelectionRange(f.start, f.end); } catch (e) { /* not selectable */ }
  }
};

// Display names for the history table's field_name values (migration 073).
App.UnderwritingView.FIELD_LABELS = {
  roof_area_sqft: 'Roof area', waste_percent: 'Waste %', material_cost: 'Material cost',
  labor_cost: 'Labor cost', other_cost: 'Other cost', target_margin_percent: 'Target margin %',
  status: 'Status',
};
