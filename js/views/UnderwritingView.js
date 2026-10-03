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
    if (field === 'workflow') return 'Measurement / material / cost / review snapshot updated';
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
      ${this._workflowHtml(task, rec)}
      ${this._formHtml(task, rec)}
      ${this.proposalView ? this.proposalView.sectionHtml(task, rec) : ''}
      ${this._breakdownHtml(id)}
      ${this._historyHtml(id)}
    </div>`;
  }

  _workflowHtml(task, rec) {
    const w = this.model.draft(task.id).workflow;
    const editable = App.can('underwriting.manage') && this.model.isEditable(task.id);
    const disabled = editable ? '' : 'disabled';
    const E = v => this._esc(v);
    const entry = (path, label, value, type = 'text') => `<label class="uw-f"><span class="uw-f-l">${E(label)}</span><input class="uw-in" type="${type}" data-uw-workflow="${E(path)}" value="${E(value ?? '')}" ${disabled} /></label>`;
    if (!w) {
      const field = (key,label,type='text') => `<label class="uw-f"><span class="uw-f-l">${E(label)}</span><input class="uw-in" type="${type}" data-uw-import-field="${key}" /></label>`;
      return `<section class="uw-sec"><h3 class="uw-h">01 / MEASURE</h3><p>GAF supplies the roof measurements. Quest selects products, prices and the readiness decision.</p>
      ${editable ? `<details><summary>Enter measurements from a GAF report</summary><p>Attach the PDF to the Bid's files first, then enter its report reference and printed values. Leave unknown measurements blank; enter 0 only when confirmed.</p><div class="uw-grid">
      ${field('property','Property address')}${field('reportName','Report filename')}${field('reference','Source reference or Files link')}${field('reportDate','Report date','date')}${field('page','Summary page','number')}${field('roofAreaSqft','Roof area (SF)')}${field('facetCount','Facet count','number')}${field('suggestedWastePercent','GAF suggested waste (%)')}${field('adjustedAreaSqft','Printed adjusted area at suggested waste (SF)')}${field('orderSquares','Printed squares at suggested waste')}
      ${App.RoofMeasurement.LENGTHS.map(k=>field(k,k+' (FT)')).join('')}${App.RoofMeasurement.ACCESSORIES.map(k=>field(k,'Reported '+k+' (FT)')).join('')}${field('coilNails','Reported coil nail boxes')}${field('capNails','Reported cap nail boxes')}
      </div><label class="uw-f"><span class="uw-f-l">Pitch areas, one per line: 1/12: 276</span><textarea class="uw-in" data-uw-pitches rows="4"></textarea></label><button class="btn" type="button" data-uw-action="import">Import measurements</button><div data-uw-import-error role="alert"></div></details>` : ''}</section>`;
    }
    let r;
    try { r = App.UnderwritingCalc.calculateWorkflow(w, this.model.draft(task.id).wastePercent); }
    catch (e) { return `<section class="uw-sec"><div role="alert">${E(e.message)}</div><button class="btn" data-uw-action="discard">Discard changes</button></section>`; }
    const roof = w.measurement, src = roof.source;
    const geom = Object.entries(roof.lengths).map(([k,v]) => `<span>${E(k)} <b>${v == null ? 'Unknown' : E(v) + ' FT'}</b></span>`).join(' · ');
    const accessories = Object.entries(r.formulas).map(([k,v]) => `<div>${E(k)}: reported ${E(roof.reportedAccessories[k] ?? 'Unknown')} FT · formula ${E(v ?? 'Unknown')} FT</div>`).join('');
    const rows = r.lines.map(l => {
      const item = w.materials[l.key] || {};
      return `<tr data-uw-material-row="${E(l.key)}"><td>${entry('materials.'+l.key+'.product','Product',item.product || l.product)}<small>${E(l.rule)} · ${E(l.unit)}</small></td>
        <td><b data-uw-material-quantity>${E(l.quantity ?? 'Unknown')}</b><small data-uw-material-source>${l.overridden ? 'Underwriter override' : l.source === 'gaf_report' ? 'GAF report' : 'Coverage calculation'}</small>${entry('materials.'+l.key+'.quantity','Override quantity',item.quantity)}</td>
        <td>${entry('materials.'+l.key+'.unitPrice','Unit price',item.unitPrice)}${entry('materials.'+l.key+'.supplier','Supplier',item.supplier)}${entry('materials.'+l.key+'.pricedAt','Price checked on',item.pricedAt,'date')}</td><td data-uw-material-total>${l.total == null ? 'Unpriced' : '$'+E(l.total)}</td></tr>`;
    }).join('');
    const labels = { measurementsVerified: 'Measurements verified against source', wasteConfirmed: 'Waste confirmed', materialTakeoffReviewed: 'Material takeoff reviewed', laborConfirmed: 'Labor confirmed', pricingCurrent: 'Pricing current' };
    return `<section class="uw-sec"><h3 class="uw-h">01 / MEASURE</h3><b>${E(roof.property)}</b><p>${E(src.provider)} · ${E(src.reportName)} · ${E(src.reportDate)} · page ${E(src.page)}</p><p>Source reference: ${E(src.reference)}</p><p>Imported area: ${E(roof.roofAreaSqft)} SF · ${E(roof.facetCount ?? 'Unknown')} facets</p><p>${geom}</p><p>Pitch areas: ${roof.pitchAreas.map(p => E(p.pitchRise)+'/12: '+E(p.areaSqft)+' SF').join(' · ') || 'Unknown'}</p><details><summary>Reported accessory lengths and printed formulas</summary>${accessories}</details></section>
      <section class="uw-sec"><h3 class="uw-h">02 / CALCULATE</h3><div class="uw-grid">${this._field("roofAreaSqft", "Selected roof area", "SF", this.model.draft(task.id), this._errors[task.id] || {}, editable)}${this._field("wastePercent", "Underwriter waste", "%", this.model.draft(task.id), this._errors[task.id] || {}, editable)}</div><p>GAF suggested waste: ${E(roof.suggestedWastePercent ?? 'Unknown')}% · selected: ${E(this.model.draft(task.id).wastePercent)}%</p><p><strong data-uw-order>${E(r.order.adjustedAreaSqft)} SF · ${E(r.order.orderSquares)} order SQ</strong></p><p>Low-slope area: ${E(r.scope.lowSlopeSqft ?? 'Unknown')} SF · shingle area (2/12 and above): ${E(r.scope.shingleSqft ?? 'Unknown')} SF</p><p>Pitch-area rounding difference: ${E(r.scope.discrepancySqft ?? 'Unknown')} SF. Source values are retained.</p></section>
      <section class="uw-sec"><h3 class="uw-h">03 / MATERIALS</h3><p>Coverage guidance is a starting quantity. Confirm installation coverage, laps and scope; enter any adjustment with a change reason. Prices start blank.</p><div class="uw-material-scroll"><table class="uw-materials"><thead><tr><th>Quest product</th><th>Quantity</th><th>Supplier pricing</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="uw-sec"><h3 class="uw-h">04 / COST</h3><div class="uw-grid">${this._field('targetMarginPercent','Target net margin','%',this.model.draft(task.id),this._errors[task.id] || {},editable)}${entry('laborRate','Labor / order SQ',w.laborRate)}${entry('clientPrice','Client price',w.clientPrice)}${entry('taxPercent','Material tax %',w.taxPercent)}${entry('commissionPercent','Commission % of client price',w.commissionPercent)}${entry('overheadPercent','Overhead % of client price',w.overheadPercent)}${['dumpster','delivery','permit','plywood','solar','flashing','other'].map(k=>entry('jobCosts.'+k,k,w.jobCosts[k] ?? '0')).join('')}</div><div data-uw-economics>${this._economicsHtml(r)}</div></section>
      <section class="uw-sec"><h3 class="uw-h">05 / PROVE</h3>${Object.entries(labels).map(([key,label])=>`<label class="uw-review"><input type="checkbox" data-uw-review="${key}" ${w.review[key] === true ? 'checked' : ''} ${disabled} />${E(label)}</label>`).join('')}<p data-uw-readiness>${this._readinessHtml(r)}</p><p>Save the reviewed snapshot before submitting. Approval remains restricted to existing approvers.</p></section>`;
  }

  _economicsHtml(r) {
    return `Materials before tax $${this._esc(r.materialBeforeTax)} · taxed materials $${this._esc(r.materialCost)} · labor $${this._esc(r.laborCost)}<br>Hard cost $${this._esc(r.hardCost)} · commission $${this._esc(r.commission)} · overhead $${this._esc(r.overhead)}<br>Gross profit $${this._esc(r.grossProfit)} · net profit $${this._esc(r.netProfit)} · net margin ${this._esc(r.netMarginPercent ?? 'Unknown')}%`;
  }
  _readinessHtml(r) {
    const missing = Object.entries(r.checks).filter(([,v]) => !v).map(([k]) => k.replace(/([A-Z])/g,' $1').toLowerCase());
    return r.ready ? 'Ready for sales review' : 'Not ready: '+this._esc(missing.join(', '));
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
      <h3 class="uw-h"><i class="ti ti-calculator"></i>${draft.workflow ? "Selected waste, margin and saved decision" : "Estimate"}</h3>
      ${!C.isEditable(rec.status) ? `<div class="uw-lock"><i class="ti ti-lock"></i>This estimate is ${this._esc((C.STATUS_LABELS[rec.status] || rec.status).toLowerCase())} — the numbers that were reviewed are locked.</div>` : ''}
      ${errors.form ? `<div class="uw-err-form" role="alert">${this._esc(errors.form)}</div>` : ''}
      ${draft.workflow ? `<p>Costs are carried from the material and job-cost lines above. The legacy recommendation remains calculated from the saved allocated costs and target margin. Readiness uses the actual client price and net margin shown in COST.</p>` : `<div class="uw-grid">
        ${this._field('roofAreaSqft', 'Base roof area', 'sqft', draft, errors, editable)}
        ${this._field('wastePercent', 'Waste', '%', draft, errors, editable)}
        ${this._field('materialCost', 'Material cost', '$', draft, errors, editable && !draft.workflow)}
        ${this._field('laborCost', 'Labor cost', '$', draft, errors, editable && !draft.workflow)}
        ${this._field('otherCost', 'Other cost (includes commission / overhead)', '$', draft, errors, editable && !draft.workflow)}
        ${this._field('targetMarginPercent', 'Target margin', '%', draft, errors, editable)}
      </div>`}
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

    host.querySelectorAll('[data-uw-workflow], [data-uw-review]').forEach(el => {
      el.addEventListener(el.dataset.uwReview ? 'change' : 'input', () => {
        this.model.setWorkflowField(id, el.dataset.uwReview ? 'review.'+el.dataset.uwReview : el.dataset.uwWorkflow, el.dataset.uwReview ? el.checked : el.value);
        this._refreshLive(host,id);
      });
    });
    const on = (sel, fn) => { const el = q(sel); if (el) el.addEventListener('click', fn); };
    on('[data-uw-action="import"]', () => {
      try {
        const values = {}; host.querySelectorAll('[data-uw-import-field]').forEach(el=> { values[el.dataset.uwImportField]=el.value.trim(); });
        const page=Number(values.page), waste=values.suggestedWastePercent;
        const pitches=q('[data-uw-pitches]').value.trim();
        const pitchAreas=pitches ? pitches.split(/\n/).map(line=> {
          const match=/^\s*(\d+)\/12\s*:\s*(\d+(?:\.\d{1,2})?)\s*$/.exec(line);
          if (!match) throw new Error('Enter each pitch area as 1/12: 276.');
          return {pitchRise:Number(match[1]),areaSqft:match[2],page};
        }) : [];
        if ((values.adjustedAreaSqft === '') !== (values.orderSquares === '')) throw new Error('Enter both printed adjusted area and squares, or leave both blank.');
        const measurement={schemaVersion:1,property:values.property,roofAreaSqft:values.roofAreaSqft,
          facetCount:values.facetCount ? Number(values.facetCount) : null, pitchAreas,
          source:{provider:'GAF QuickMeasure',reportName:values.reportName,reference:values.reference,reportDate:values.reportDate,page},
          lengths:Object.fromEntries(App.RoofMeasurement.LENGTHS.map(k=>[k,values[k] || null])),
          reportedAccessories:Object.fromEntries(App.RoofMeasurement.ACCESSORIES.map(k=>[k,values[k] || null])),
          suggestedWastePercent:waste || null,
          reportWasteTable:values.adjustedAreaSqft ? [{wastePercent:waste,adjustedAreaSqft:values.adjustedAreaSqft,orderSquares:values.orderSquares}] : [],
          materialRecommendations:['coilNails','capNails'].filter(k=>values[k]).map(k=>({key:k,quantity:values[k],wastePercent:waste,page:page+1,unit:'box'}))};
        this.model.importMeasurement(id,measurement); this.mount(host,task);
      }
      catch (e) { q('[data-uw-import-error]').textContent = e.message; }
    });
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
    const w = m.syncWorkflow(id);
    if (!w && m.draft(id).workflow) {
      const cost = host.querySelector('[data-uw-economics]'); if (cost) cost.textContent = 'Correct the invalid input to recalculate costs.';
      const readiness = host.querySelector('[data-uw-readiness]'); if (readiness) readiness.textContent = 'Not ready: invalid input.';
    }
    if (w) {
      host.querySelectorAll('[data-uw-review]').forEach(el => { el.checked = m.draft(id).workflow.review[el.dataset.uwReview] === true; });
      const order = host.querySelector('[data-uw-order]'); if (order) order.textContent = w.order.adjustedAreaSqft+' SF · '+w.order.orderSquares+' order SQ';
      w.lines.forEach(l => {
        const row = host.querySelector('[data-uw-material-row="'+l.key+'"]');
        if (row) { row.querySelector('[data-uw-material-quantity]').textContent = l.quantity ?? 'Unknown'; row.querySelector('[data-uw-material-total]').textContent = l.total == null ? 'Unpriced' : '$'+l.total; row.querySelector('[data-uw-material-source]').textContent = l.overridden ? 'Underwriter override' : l.source === 'gaf_report' ? 'GAF report' : 'Coverage calculation'; }
      });
      const cost = host.querySelector('[data-uw-economics]'); if (cost) cost.innerHTML = this._economicsHtml(w);
      const readiness = host.querySelector('[data-uw-readiness]'); if (readiness) readiness.innerHTML = this._readinessHtml(w);
      ['materialCost','laborCost','otherCost'].forEach(k => { const el = host.querySelector('[data-uw-field="'+k+'"]'); if (el) el.value = m.draft(id)[k]; });
    }
    if (save && rec) save.disabled = !(dirty || !rec.calculatedAt);
    if (discard) discard.disabled = !dirty;
    if (!prev) return;
    if (!dirty && rec && rec.calculatedAt) { prev.innerHTML = ''; return; }
    const ev = m.evaluateDraft(id);
    const P = App.UnderwritingView.pretty;
    if (!ev.ok && m.draft(id).workflow) { prev.textContent = ev.errors.form || Object.values(ev.errors).join(' '); return; }
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
  status: 'Status', workflow: 'Underwriting V1 snapshot',
};
