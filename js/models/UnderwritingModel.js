window.App = window.App || {};

/* UnderwritingModel — owns each Bid task's underwriting: the saved record, its
   Estimate History, whether it has been loaded, the single in-flight fetch, and
   the user's UNSAVED form draft.

   Keyed by task id and deliberately kept OFF the Task row, for the same reason
   CommentStore is (see its header): a Task is a server-owned value the 30s sync
   poll replaces wholesale, so anything parked on it is destroyed on the next
   poll. The draft matters most here — a half-typed estimate must survive the
   task-detail re-render that a background poll triggers.

   This module emits nothing and touches no DOM — the caller owns
   'underwriting:changed'. All I/O is injected so load-once semantics, in-flight
   dedupe, draft handling and validation are testable in plain node:

     load(taskId)                        -> { record|null, history: [] }
     create(taskId)                      -> record
     saveEstimate(id, payload, reason)   -> void
     setStatus(id, status, reason)       -> void
*/
App.UnderwritingModel = class UnderwritingModel {
  constructor({ load, create, saveEstimate, setStatus } = {}) {
    this._load = typeof load === 'function' ? load : null;
    this._create = typeof create === 'function' ? create : null;
    this._saveEstimate = typeof saveEstimate === 'function' ? saveEstimate : null;
    this._setStatus = typeof setStatus === 'function' ? setStatus : null;
    this._entries = new Map(); // taskId -> { record, history, loaded, inflight, draft, error }
  }

  _entry(taskId) {
    let e = this._entries.get(taskId);
    if (!e) {
      e = { record: null, history: [], loaded: false, inflight: null, draft: null, error: null };
      this._entries.set(taskId, e);
    }
    return e;
  }

  /* ---------- reads ---------- */

  record(taskId) { return this._entry(taskId).record; }
  history(taskId) { return this._entry(taskId).history; }
  // Distinct from "has a record": a loaded task with no underwriting reads
  // "No underwriting yet"; an unloaded one reads "Loading…".
  isLoaded(taskId) { return this._entry(taskId).loaded; }
  lastError(taskId) { return this._entry(taskId).error; }

  isEditable(taskId) {
    const r = this.record(taskId);
    return !!r && App.UnderwritingCalc.isEditable(r.status);
  }

  /* ---------- loading ---------- */

  /* Fetch at most once. Concurrent callers share the in-flight promise. Resolves
     and NEVER rejects: a failure leaves the entry unloaded (and records the
     error) so a later render can retry — the same contract as CommentStore. */
  ensureLoaded(taskId) {
    const e = this._entry(taskId);
    if (e.loaded) return Promise.resolve(e);
    if (e.inflight) return e.inflight;
    if (!this._load) return Promise.resolve(e);
    e.inflight = this._fetch(taskId).then(() => e);
    return e.inflight;
  }

  _fetch(taskId) {
    const e = this._entry(taskId);
    let started;
    try { started = Promise.resolve(this._load(taskId)); }
    catch (err) { started = Promise.reject(err); }
    return started
      .then(res => {
        e.record = (res && res.record) || null;
        e.history = (res && Array.isArray(res.history)) ? res.history : [];
        e.loaded = true;
        e.error = null;
      })
      .catch(err => {
        console.warn('[underwriting] load failed:', err);
        e.error = err;
      })
      .then(() => { e.inflight = null; });
  }

  /* Re-pull an already-loaded entry; true if anything changed. Never rejects. */
  async refresh(taskId) {
    const e = this._entry(taskId);
    if (!e.loaded || !this._load || e.inflight) return false;
    const before = JSON.stringify([e.record, e.history]);
    e.inflight = this._fetch(taskId);
    await e.inflight;
    return JSON.stringify([e.record, e.history]) !== before;
  }

  /* Seed an entry with known rows and no round trip — preview harnesses and tests. */
  hydrate(taskId, { record, history } = {}) {
    const e = this._entry(taskId);
    e.record = record || null;
    e.history = Array.isArray(history) ? history.slice() : [];
    e.loaded = true;
    e.draft = null;
    return e;
  }

  /* ---------- draft (unsaved form state) ---------- */

  static blankDraft() {
    return { roofAreaSqft: '', wastePercent: '', materialCost: '', laborCost: '', otherCost: '',
             targetMarginPercent: '', reason: '' };
  }

  static draftFromRecord(r) {
    const blank = App.UnderwritingModel.blankDraft();
    // Until a real calculation save, the record's inputs are column defaults,
    // not entered values — leave the form blank rather than present 0.00 as typed.
    if (!r || !r.calculatedAt) return blank;
    return {
      roofAreaSqft: r.roofAreaSqft || '', wastePercent: r.wastePercent || '',
      materialCost: r.materialCost || '', laborCost: r.laborCost || '',
      otherCost: r.otherCost || '', targetMarginPercent: r.targetMarginPercent || '',
      reason: '',
    };
  }

  draft(taskId) {
    const e = this._entry(taskId);
    if (!e.draft) e.draft = App.UnderwritingModel.draftFromRecord(e.record);
    return e.draft;
  }

  setDraftField(taskId, field, value) {
    const d = this.draft(taskId);
    if (!(field in d)) return;
    d[field] = String(value == null ? '' : value);
  }

  discardDraft(taskId) { this._entry(taskId).draft = null; }

  // True when the form differs from what is saved (the reason alone is not a change).
  isDirty(taskId) {
    const e = this._entry(taskId);
    if (!e.draft) return false;
    const base = App.UnderwritingModel.draftFromRecord(e.record);
    return ['roofAreaSqft', 'wastePercent', 'materialCost', 'laborCost', 'otherCost', 'targetMarginPercent']
      .some(k => String(e.draft[k]).trim() !== String(base[k]).trim());
  }

  /* Validate + compute the current draft. Returns
       { ok: true, input, data }  — input is the normalised calc input, data the
                                    derived figures (see UnderwritingCalc.calculate)
       { ok: false, errors: { field: message } }
     Waste, the three costs and the margin are required (a blank is not silently a
     0 — a recorded 0 must be something a person typed); roof area is optional. */
  evaluateDraft(taskId) {
    const calc = App.UnderwritingCalc;
    const d = this.draft(taskId);
    const errors = {};
    const field = (key, label, { required, min, maxExclusive, minExclusive }) => {
      const raw = String(d[key] == null ? '' : d[key]).trim();
      if (raw === '') {
        if (required) errors[key] = label + ' is required (enter 0 if none).';
        return null;
      }
      let h;
      try { h = calc.parseToHundredths(raw); }
      catch (e) { errors[key] = label + ' must be a number with at most 2 decimals.'; return null; }
      if (min !== undefined && h < BigInt(min)) { errors[key] = label + ' cannot be negative.'; return null; }
      if (minExclusive !== undefined && h <= BigInt(minExclusive)) { errors[key] = label + ' must be greater than 0%.'; return null; }
      if (maxExclusive !== undefined && h >= BigInt(maxExclusive)) { errors[key] = label + ' must be less than 100%.'; return null; }
      return calc.hundredthsToString(h);
    };

    const input = {
      roofAreaSqft: field('roofAreaSqft', 'Roof area', { required: false, min: 0 }),
      wastePercent: field('wastePercent', 'Waste %', { required: true, min: 0 }),
      materialCost: field('materialCost', 'Material cost', { required: true, min: 0 }),
      laborCost: field('laborCost', 'Labor cost', { required: true, min: 0 }),
      otherCost: field('otherCost', 'Other cost', { required: true, min: 0 }),
      targetMarginPercent: field('targetMarginPercent', 'Target margin', { required: true, minExclusive: 0, maxExclusive: 10000 }),
    };
    if (Object.keys(errors).length) return { ok: false, errors };
    const r = calc.calculate(input);
    if (!r.ok) return { ok: false, errors: { form: r.error } };
    return { ok: true, input, data: r.data };
  }

  /* ---------- writes ---------- */

  // Create (or fetch) the underwriting for a Bid task. Throws on failure — the
  // caller toasts it.
  async createFor(taskId) {
    if (!this._create) throw new Error('Underwriting is unavailable.');
    const record = await this._create(taskId);
    const e = this._entry(taskId);
    e.record = record || null;
    e.loaded = true;
    e.draft = null;
    await this._reloadAll(taskId);
    return e.record;
  }

  /* Validate the draft, persist inputs + derived snapshot, reload record and
     history. Returns { ok, errors? }. Throws only on a transport/DB failure. */
  async saveDraft(taskId) {
    const e = this._entry(taskId);
    if (!e.record) return { ok: false, errors: { form: 'No underwriting to save.' } };
    if (!App.UnderwritingCalc.isEditable(e.record.status)) {
      return { ok: false, errors: { form: 'This estimate is ' + e.record.status.replace('_', ' ') + ' and can no longer be edited.' } };
    }
    const ev = this.evaluateDraft(taskId);
    if (!ev.ok) return ev;
    if (!this._saveEstimate) throw new Error('Underwriting is unavailable.');
    const reason = String(this.draft(taskId).reason || '').trim() || null;
    await this._saveEstimate(e.record.id, { input: ev.input, data: ev.data }, reason);
    e.draft = null;
    await this._reloadAll(taskId);
    return { ok: true };
  }

  /* Move the status (submit / approve / decline / back to draft). The client-side
     rule mirrors the database trigger; the database is the authority. */
  async transition(taskId, next, reason) {
    const e = this._entry(taskId);
    if (!e.record) return { ok: false, error: 'No underwriting.' };
    if (!App.UnderwritingCalc.allowedNextStatuses(e.record.status).includes(next)) {
      return { ok: false, error: 'Cannot move from ' + e.record.status + ' to ' + next + '.' };
    }
    if (next === 'approved' && !App.UnderwritingCalc.canApprove(e.record.recommendedSalePrice)) {
      return { ok: false, error: 'Approval requires a calculated, positive recommended sale price.' };
    }
    if (this.isDirty(taskId)) {
      return { ok: false, error: 'Save or discard your unsaved changes first.' };
    }
    if (!this._setStatus) throw new Error('Underwriting is unavailable.');
    await this._setStatus(e.record.id, next, String(reason || '').trim() || null);
    await this._reloadAll(taskId);
    return { ok: true };
  }

  async _reloadAll(taskId) {
    if (!this._load) return;
    await this._fetch(taskId);
  }

  /* ---------- derived views of the SAVED record ---------- */

  // The trace the Breakdown renders — always from the saved record, never the draft.
  trace(taskId) {
    const r = this.record(taskId);
    if (!r) return [];
    return App.UnderwritingTrace.build(r);
  }
};

/* Node test harness (tests/unit) requires this file directly. */
if (typeof module !== 'undefined' && module.exports) module.exports = { UnderwritingModel: App.UnderwritingModel };
