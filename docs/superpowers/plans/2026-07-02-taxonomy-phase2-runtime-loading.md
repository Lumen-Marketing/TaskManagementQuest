# Task Taxonomy — Phase 2 (Runtime Loading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use
> checkbox (`- [ ]`) syntax. Frontend-only; no DB changes (Phase 1 already applied).

**Goal:** Load the per-company taxonomy (types / per-type statuses / labels) from Supabase
at boot into `App.taxonomy`, and make the app's built-in lists **come from that data**
(with the hardcoded constants kept only as an offline fallback + a source of CSS colour
classes) — with **zero change to current behaviour or appearance**.

**Architecture:** New `js/taxonomy.js` holds `App.taxonomy` (indexed by company). The
existing boot data-load fetches the three taxonomy tables and hydrates it. `applyGlobals()`
rebuilds `App.TASK_TYPES / STATUSES / TASK_LABELS` from the loaded rows — keyed the same,
labels from the DB, `cls` (colour class) preserved from the original constants — so every
existing reader (~30 sites) keeps working unchanged.

**Tech Stack:** Vanilla JS on `window.App`, Supabase JS client, `App.EventBus`.

## Scope decision (why this is the safe Phase 2)

Because Phase 1 seeded every type with the **same** statuses the old constants had
(`todo…done`, `done`=is_done), the taxonomy is currently identical to the constants across
all three companies. So Phase 2 can make the lists **DB-driven** while looking and behaving
exactly as today. Deliberately **deferred** (they only matter once an admin actually
diverges the data, and they need the redesigned surfaces + browser testing):

- The `isDone(task)` completion refactor (~35 `status === 'done'` sites) → **Phase 3/4**.
  Kept as `=== 'done'` for now, which stays correct while every type's done key is `done`.
- Per-company pickers + inline-colour rendering + the layout redesign → **Phase 4**.

`App.taxonomy` still ships the `isDone` / `doneStatus` / `defaultStatus` / per-company
accessors now, so Phases 3–4 have them ready.

## Global Constraints

- No DB changes. No behaviour/appearance change in this phase.
- Constants in `js/constants.js` stay (offline fallback + `cls` colour source).
- If the taxonomy load fails or returns empty, fall back to the constants so the app never
  runs taxonomy-less.
- Preview/offline mode (`App.previewMode`) seeds `App.taxonomy` from the constants.

## Files

- **Create:** `js/taxonomy.js` — `App.taxonomy` (hydrate, accessors, `applyGlobals`, fallback).
- **Modify:** `js/services/SupabaseDataStore.js` `load()` — add the 3 taxonomy queries to the
  `Promise.all`; return `taxonomy: {types, statuses, labels}`.
- **Modify:** `js/app.js` — after the data load, `App.taxonomy.hydrate(saved.taxonomy)`;
  in preview mode, `App.taxonomy.hydrate(null)` (uses the constant fallback). Add the
  `<script>` for `taxonomy.js` in `app.html` before `constants.js`-dependent views but
  after `constants.js`.
- **Modify:** `app.html` — `<script src="js/taxonomy.js">` right after `js/constants.js`.

---

### Task 1: `App.taxonomy` module

**Files:** Create `js/taxonomy.js`. **Produces:** `App.taxonomy.hydrate(raw)`,
`.activeTypes(company)`, `.activeStatuses(company,type)`, `.activeLabels(company)`,
`.typeLabel(company,type)`, `.statusLabel(company,type,status)`, `.labelLabel(company,label)`,
`.isDone(task)`, `.doneStatus(company,type)`, `.defaultStatus(company,type)`,
`.color(kind,company,...)`, `.applyGlobals()`.

- [ ] **Step 1 — write the module.** Index rows by company; sort by `sort_order`; build a
  fallback from the constants for every `App.COMPANIES` key when `raw` is empty; `applyGlobals()`
  rebuilds `App.TASK_TYPES/STATUSES/TASK_LABELS` from a canonical company preserving each key's
  original `cls`. `isDone(task)` = `task.status === doneStatus(task.company, task.type)`.

```js
window.App = window.App || {};
App.taxonomy = (function () {
  let idx = {}; // idx[company] = { types:[], statusesByType:{}, labels:[] }
  const empty = () => ({ types: [], statusesByType: {}, labels: [] });
  const co = (c) => idx[c] || empty();
  const bySort = (a, b) => (a.sort - b.sort) || String(a.label).localeCompare(String(b.label));

  function hydrate(raw) {
    idx = {};
    const push = (c, bucket, row) => { (idx[c] || (idx[c] = empty()))[bucket]; };
    ((raw && raw.types) || []).forEach(r => {
      const c = idx[r.company_id] || (idx[r.company_id] = empty());
      c.types.push({ key: r.key, label: r.label, color: r.color, sort: r.sort_order, active: r.active !== false });
    });
    ((raw && raw.statuses) || []).forEach(r => {
      const c = idx[r.company_id] || (idx[r.company_id] = empty());
      (c.statusesByType[r.type_key] || (c.statusesByType[r.type_key] = [])).push(
        { key: r.key, label: r.label, color: r.color, sort: r.sort_order, isDone: !!r.is_done, isDefault: !!r.is_default, active: r.active !== false });
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
    App.EventBus && App.EventBus.emit && App.EventBus.emit('taxonomy:changed');
  }

  // Offline / empty fallback: rebuild the taxonomy from the hardcoded constants for
  // every known company so the app never runs without a taxonomy.
  function seedFromConstants() {
    idx = {};
    const companies = Object.keys(App.COMPANIES || { roofing: 1 });
    const types = Object.values(App.TASK_TYPES || {});
    const statuses = Object.entries(App.STATUSES || {});
    const labels = Object.values(App.TASK_LABELS || {}).filter(l => l.id !== 'none');
    companies.forEach(cid => {
      const c = idx[cid] = empty();
      types.forEach((t, i) => c.types.push({ key: t.id, label: t.label, color: '#8f867b', sort: i, active: true }));
      types.forEach(t => {
        c.statusesByType[t.id] = statuses.map(([k, v], i) => ({
          key: k, label: v.label, color: '#8f867b', sort: i, isDone: k === 'done', isDefault: k === 'todo', active: true }));
      });
      labels.forEach((l, i) => c.labels.push({ key: l.id, label: l.label, color: '#8f867b', sort: i, active: true }));
    });
  }

  const activeTypes = (company) => co(company).types.filter(t => t.active);
  const activeStatuses = (company, type) => (co(company).statusesByType[type] || []).filter(s => s.active);
  const activeLabels = (company) => co(company).labels.filter(l => l.active);
  const find = (list, key) => list.find(x => x.key === key);

  const typeLabel = (company, type) => (find(co(company).types, type) || {}).label || type || '—';
  const statusLabel = (company, type, status) => (find(co(company).statusesByType[type] || [], status) || {}).label || status || '—';
  const labelLabel = (company, label) => (find(co(company).labels, label) || {}).label || label || '—';

  const doneStatus = (company, type) => {
    const d = (co(company).statusesByType[type] || []).find(s => s.isDone);
    return d ? d.key : 'done';
  };
  const defaultStatus = (company, type) => {
    const d = (co(company).statusesByType[type] || []).find(s => s.isDefault);
    return d ? d.key : ((co(company).statusesByType[type] || [])[0] || { key: 'todo' }).key;
  };
  const isDone = (task) => !!task && task.status === doneStatus(task.company, task.type);

  // Rebuild the global constant maps from the loaded taxonomy (canonical company),
  // preserving each known key's original `cls` so CSS colouring is unchanged.
  function applyGlobals() {
    const canonical = Object.keys(idx)[0];
    if (!canonical) return;
    const c = idx[canonical];
    const clsOf = (map, key, fallback) => (map[key] && map[key].cls) || fallback;
    const CONST_TYPES = App.TASK_TYPES || {}, CONST_STATUS = App.STATUSES || {}, CONST_LABELS = App.TASK_LABELS || {};
    const T = {}; c.types.forEach(t => { T[t.key] = { id: t.key, label: t.label, cls: clsOf(CONST_TYPES, t.key, 'type-admin'), color: t.color }; });
    if (Object.keys(T).length) App.TASK_TYPES = T;
    const statusSrc = c.statusesByType[Object.keys(c.statusesByType)[0]] || [];
    const S = {}; statusSrc.forEach(s => { S[s.key] = { label: s.label, cls: clsOf(CONST_STATUS, s.key, 'status-pending'), color: s.color, isDone: s.isDone }; });
    if (Object.keys(S).length) App.STATUSES = S;
    const L = { none: CONST_LABELS.none || { id: 'none', label: 'No label' } };
    c.labels.forEach(l => { L[l.key] = { id: l.key, label: l.label, color: l.color }; });
    App.TASK_LABELS = L;
  }

  return { hydrate, activeTypes, activeStatuses, activeLabels, typeLabel, statusLabel,
           labelLabel, isDone, doneStatus, defaultStatus, applyGlobals };
})();
```

- [ ] **Step 2 — `node --check js/taxonomy.js`** → OK.
- [ ] **Step 3 — commit** `feat(taxonomy): App.taxonomy runtime store + constants fallback`.

### Task 2: Load the taxonomy at boot

**Files:** Modify `js/services/SupabaseDataStore.js` `load()`; `js/app.js`; `app.html`.
**Consumes:** `App.taxonomy.hydrate`.

- [ ] **Step 1 — `SupabaseDataStore.load()`**: add to the `Promise.all` (after `projects`):

```js
this.supabase.from('task_types').select('*'),
this.supabase.from('task_type_statuses').select('*'),
this.supabase.from('task_labels').select('*'),
```
destructure `taxTypesRes, taxStatusesRes, taxLabelsRes`, `_throwIfError` each, and add to the
returned object:
```js
taxonomy: {
  types: taxTypesRes.data || [],
  statuses: taxStatusesRes.data || [],
  labels: taxLabelsRes.data || [],
},
```

- [ ] **Step 2 — `js/app.js`**: after `timeModel.hydrate(...)` in the non-preview branch add
  `App.taxonomy.hydrate(saved.taxonomy);`. In the preview branch add `App.taxonomy.hydrate(null);`
  (uses the constants fallback). Both run **before** `new App.AppController(...)` so the first
  render sees taxonomy-derived globals.

- [ ] **Step 3 — `app.html`**: add `<script src="js/taxonomy.js"></script>` immediately after
  `<script src="js/constants.js"></script>` (so the fallback can read the constants).

- [ ] **Step 4 — verify**: `node --check` the two JS files. Load the app locally/deploy →
  confirm types/statuses/labels look identical, task list/detail/filters render, Overdue/Done
  counts unchanged. (Behaviour is preserved because the DB values equal the constants.)

- [ ] **Step 5 — commit** `feat(taxonomy): load per-company taxonomy at boot (constants fallback)`.

## Self-Review

- **Spec coverage:** runtime loading (spec §Runtime loading) ✓; `App.taxonomy` accessors incl.
  `isDone`/`doneStatus`/`defaultStatus` ✓; fallback ✓. The done-refactor across ~35 sites and
  per-company pickers/inline-colour/layout are explicitly deferred to Phases 3–4 (documented above).
- **Placeholders:** none — full module + exact load edits shown.
- **Consistency:** row fields (`company_id`,`type_key`,`key`,`is_done`,`is_default`,`sort_order`,
  `color`,`active`) match the Phase-1 tables; `applyGlobals` keeps the `{id,label,cls}` shape the
  ~30 existing readers expect.

## Risk / testing note

Behaviour and appearance are unchanged by construction (the DB equals the constants today), so
this phase is low-risk and verifiable by `node --check` + a load smoke-check. The genuinely
risky completion refactor is intentionally **not** here — it lands in Phase 3/4 alongside the
admin UI and the redesigned, browser-testable surfaces.
