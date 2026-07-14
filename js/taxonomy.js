window.App = window.App || {};

/* Runtime task taxonomy (Phase 2 of the customizable-taxonomy project).
   Loads the per-company types / per-type statuses / labels from Supabase at boot and
   makes the app's built-in lists come from that data — with the hardcoded js/constants.js
   values kept only as (a) an offline/empty fallback and (b) the source of the CSS colour
   classes (`cls`) so appearance is unchanged. Behaviour + looks are identical today because
   Phase 1 seeded the DB with the same values the constants had.

   The per-company accessors + isDone/doneStatus/defaultStatus are provided now but the
   app-wide completion refactor and per-company pickers land in Phases 3-4. See
   docs/superpowers/specs/2026-07-02-customizable-task-taxonomy-design.md. */
App.taxonomy = (function () {
  let idx = {}; // idx[company] = { types:[], statusesByType:{}, labels:[] }
  const empty = () => ({ types: [], statusesByType: {}, labels: [] });
  const co = (c) => (c === 'overall' ? unionCo() : (idx[c] || empty()));

  // Overall spans every company: merge each real company's taxonomy into one
  // index. Types/labels dedupe by key (first real company wins); a type's
  // statuses come from the first company that defines that type. Computed on
  // demand from `idx` so it always reflects the latest hydrate().
  function unionCo() {
    const out = empty();
    const seenType = new Set(), seenLabel = new Set();
    Object.keys(idx).forEach(cid => {
      if (cid === 'overall') return;
      const c = idx[cid];
      c.types.forEach(t => { if (!seenType.has(t.key)) { seenType.add(t.key); out.types.push(t); } });
      c.labels.forEach(l => { if (!seenLabel.has(l.key)) { seenLabel.add(l.key); out.labels.push(l); } });
      Object.keys(c.statusesByType).forEach(tk => {
        if (!out.statusesByType[tk]) out.statusesByType[tk] = c.statusesByType[tk];
      });
    });
    out.types.sort(bySort); out.labels.sort(bySort);
    return out;
  }
  const bySort = (a, b) => (a.sort - b.sort) || String(a.label).localeCompare(String(b.label));
  const find = (list, key) => (list || []).find(x => x.key === key);

  // Seeded colour classes snapshotted from the ORIGINAL constants (captured now, before
  // applyGlobals() rebuilds App.* and gives unknown keys a FALLBACK cls). A key present
  // here is "seeded" and keeps its pastel cls; a key absent is CUSTOM and renders via hex.
  const SEED_CLS = { type: {}, status: {}, label: {} };
  Object.entries(App.TASK_TYPES  || {}).forEach(([k, v]) => { if (v && v.cls) SEED_CLS.type[k]   = v.cls; });
  Object.entries(App.STATUSES    || {}).forEach(([k, v]) => { if (v && v.cls) SEED_CLS.status[k] = v.cls; });
  Object.entries(App.TASK_LABELS || {}).forEach(([k, v]) => { if (v && v.cls) SEED_CLS.label[k]  = v.cls; });

  // Build the index from raw Supabase rows (or fall back to the constants when empty),
  // then refresh the global constant maps and announce the change.
  function hydrate(raw) {
    idx = {};
    ((raw && raw.types) || []).forEach(r => {
      const c = idx[r.company_id] || (idx[r.company_id] = empty());
      c.types.push({ key: r.key, label: r.label, color: r.color, sort: r.sort_order, active: r.active !== false });
    });
    ((raw && raw.statuses) || []).forEach(r => {
      const c = idx[r.company_id] || (idx[r.company_id] = empty());
      (c.statusesByType[r.type_key] || (c.statusesByType[r.type_key] = [])).push({
        key: r.key, label: r.label, color: r.color, sort: r.sort_order,
        isDone: !!r.is_done, isDefault: !!r.is_default, active: r.active !== false,
      });
    });
    ((raw && raw.labels) || []).forEach(r => {
      const c = idx[r.company_id] || (idx[r.company_id] = empty());
      c.labels.push({ key: r.key, label: r.label, color: r.color, sort: r.sort_order, active: r.active !== false });
    });
    Object.values(idx).forEach(c => {
      c.types.sort(bySort); c.labels.sort(bySort);
      Object.values(c.statusesByType).forEach(l => l.sort(bySort));
    });
    if (!Object.keys(idx).length) seedFromConstants();
    applyGlobals();
    if (App.EventBus && App.EventBus.emit) App.EventBus.emit('taxonomy:changed');
  }

  // Offline / empty fallback: rebuild from the hardcoded constants for every known
  // company so the app never runs without a taxonomy.
  function seedFromConstants() {
    idx = {};
    // 'overall' is synthesized on demand by co('overall') → unionCo(); never seed it.
    const companies = Object.keys(App.COMPANIES || { roofing: 1 }).filter(c => c !== 'overall');
    const types = Object.values(App.TASK_TYPES || {});
    const statuses = Object.entries(App.STATUSES || {});
    const labels = Object.values(App.TASK_LABELS || {}).filter(l => l.id !== 'none');
    companies.forEach(cid => {
      const c = idx[cid] = empty();
      types.forEach((t, i) => c.types.push({ key: t.id, label: t.label, color: '#8f867b', sort: i, active: true }));
      types.forEach(t => {
        c.statusesByType[t.id] = statuses.map(([k, v], i) => ({
          key: k, label: v.label, color: '#8f867b', sort: i,
          isDone: k === 'done', isDefault: k === 'todo', active: true,
        }));
      });
      labels.forEach((l, i) => c.labels.push({ key: l.id, label: l.label, color: '#8f867b', sort: i, active: true }));
    });
  }

  const activeTypes = (company) => co(company).types.filter(t => t.active);
  const activeStatuses = (company, type) => (co(company).statusesByType[type] || []).filter(s => s.active);
  const activeLabels = (company) => co(company).labels.filter(l => l.active);

  const typeLabel = (company, type) => (find(co(company).types, type) || {}).label || type || '—';
  const statusLabel = (company, type, status) => (find(co(company).statusesByType[type] || [], status) || {}).label || status || '—';
  const labelLabel = (company, label) => (find(co(company).labels, label) || {}).label || label || '—';

  const doneStatus = (company, type) => {
    const d = (co(company).statusesByType[type] || []).find(s => s.isDone);
    return d ? d.key : 'done';
  };
  const defaultStatus = (company, type) => {
    const list = co(company).statusesByType[type] || [];
    const d = list.find(s => s.isDefault);
    return d ? d.key : ((list[0] || { key: 'todo' }).key);
  };
  // A task is complete when its status is its type's is_done status (for its company).
  const isDone = (task) => !!task && task.status === doneStatus(task.company, task.type);

  // Hex colour for a taxonomy entry (reads inactive rows too, for display). kind: 'type'|'status'|'label'.
  const color = (kind, company, key, type) => {
    const c = co(company); if (!c) return null;
    let list;
    if (kind === 'type') list = c.types;
    else if (kind === 'label') list = c.labels;
    else list = (c.statusesByType && c.statusesByType[type]) || [];
    const hit = (list || []).find(e => e.key === key);
    return hit && hit.color ? hit.color : null;
  };
  // Chip appearance: a SEEDED key (in SEED_CLS) keeps its pastel class, unchanged.
  // A CUSTOM key renders via an inline hex tint (bg = hex@~10% alpha, ink = hex).
  const chipStyle = (kind, company, key, type) => {
    const cls = (SEED_CLS[kind] || {})[key];
    if (cls) return { cls, style: '' };
    const hex = color(kind, company, key, type);
    return hex ? { cls: '', style: `background:${hex}1a;color:${hex};` } : { cls: '', style: '' };
  };

  // Rebuild App.TASK_TYPES / STATUSES / TASK_LABELS from the loaded taxonomy so every
  // existing reader stays data-driven. Labels come from the DB; each known key's `cls`
  // (CSS colour class) is preserved from the current constants so nothing recolours.
  // (All companies share one taxonomy today, so a canonical company drives the globals;
  // per-company-accurate rendering arrives in Phase 4.)
  function applyGlobals() {
    const canonical = Object.keys(idx)[0];
    if (!canonical) return;
    const c = idx[canonical];
    const CT = App.TASK_TYPES || {}, CS = App.STATUSES || {}, CL = App.TASK_LABELS || {};
    const clsOf = (map, key, fb) => (map[key] && map[key].cls) || fb;

    if (c.types.length) {
      const T = {};
      c.types.forEach(t => { T[t.key] = { id: t.key, label: t.label, cls: clsOf(CT, t.key, 'type-admin'), color: t.color }; });
      App.TASK_TYPES = T;
    }
    const statusSrc = c.statusesByType[Object.keys(c.statusesByType)[0]] || [];
    if (statusSrc.length) {
      const S = {};
      statusSrc.forEach(s => { S[s.key] = { label: s.label, cls: clsOf(CS, s.key, 'status-pending'), color: s.color, isDone: s.isDone }; });
      App.STATUSES = S;
    }
    if (c.labels.length) {
      const L = { none: CL.none || { id: 'none', label: 'No label' } };
      c.labels.forEach(l => { L[l.key] = { id: l.key, label: l.label, cls: clsOf(CL, l.key, ''), color: l.color }; });
      App.TASK_LABELS = L;
    }
  }

  return {
    hydrate, activeTypes, activeStatuses, activeLabels,
    typeLabel, statusLabel, labelLabel,
    isDone, doneStatus, defaultStatus, applyGlobals,
    color, chipStyle,
  };
})();
