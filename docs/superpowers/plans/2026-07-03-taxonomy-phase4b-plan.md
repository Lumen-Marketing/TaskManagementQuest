# Taxonomy Phase 4b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the live per-company taxonomy through the task UI — the Status dropdown is driven by the selected type's own statuses, the separate Bid-status field is retired (its pipeline folded into the Bid type without data loss), and every custom taxonomy entry renders in its chosen colour.

**Architecture:** `App.taxonomy` already loads per-company, per-type statuses/types/labels (each with a hex `color`) and exposes `activeStatuses(company,type)`, `defaultStatus(company,type)`, `doneStatus(company,type)`, `isDone(task)`, `statusLabel/typeLabel/labelLabel`. Phase 4b (a) points the form/detail status controls at those accessors, (b) runs one snapshot-first SQL migration that seeds the Bid type's statuses to the real pipeline and rewrites bid tasks' `status`, then deletes the now-dead `bidStatus` field + `type==='bid'` special-cases, and (c) adds a `chipStyle(kind,company,key[,type])` helper that returns a legacy `cls` for seeded keys (unchanged look) or an inline `--pc` hex style for custom keys, applied at every chip render site.

**Tech Stack:** Vanilla JS (classes on `window.App`, no build step), Supabase (Postgres + RLS), CSS in `taskmanagement.css`. Verification: headless Node harness (`node`) for pure logic; `node --check` + grep for wiring; manual check on the production URL (no Chromium — project constraint).

## Global Constraints

- Work on branch `feat/taxonomy-phase4b` (already created off `origin/main`). Do NOT touch the user's other branches/stashes.
- Production Supabase project = `qqvmcsvdxhgjooirznrj` (NEVER `rqundirizvojpzhljtdn`). Any migration is snapshot-first + verified.
- No browser automation / no Chromium install. Pure-logic verification = headless Node harness; UI verification = `node --check` + grep + a manual look on `https://task.questroofing.com` after deploy.
- No new build tooling, no framework. Match existing file patterns.
- Seeded taxonomy keys must look EXACTLY as they do today (keep their pastel `cls`); only CUSTOM keys (no `cls` in the constant map) render via hex.
- `tasks.bid_status` column is NOT dropped (kept for history), only unused by new code.
- Priorities stay hardcoded (out of scope).
- Commit after each task. Do NOT merge to `main` until the user approves on prod (they cannot view Vercel previews — SSO wall).

## File Structure

- Create `supabase/sql/059_bid_pipeline.sql` — seeds Bid type statuses to the pipeline, rewrites bid tasks' `status`, soft-deletes the Bid type's leftover generic statuses. One-time migration.
- Create `tests/taxonomy-phase4b-harness.mjs` — headless Node harness for the new `App.taxonomy` colour/status accessors.
- Modify `js/taxonomy.js` — add `color(kind,company,key,type)` + `chipStyle(kind,company,key,type)`; expose `defaultLabel(company)` for label re-scope.
- Modify `js/views/NewTaskPageView.js` — per-type Status `<select>`; type-change + company-change re-scope Type/Status/Label; remove the Bid-status field + `updateBidStatusRow`.
- Modify `js/views/TaskDetailView.js` — edit-status / inline status editor / quick status menu from taxonomy; type-change resets status; remove `edit-bidStatus` + `type==='bid'` blocks; render chip/band colours via `chipStyle`.
- Modify `js/views/TaskListView.js` — render row + board chips via `chipStyle`.
- Modify `js/views/ReportsView.js` — status distribution colours from taxonomy.
- Modify `js/controllers/AppController.js` — drop `bidStatus` from create/update/duplicate.
- Modify `js/services/SupabaseDataStore.js` — stop writing `bid_status` on save (write `null`).
- Modify `js/validate.js` — remove the `bidStatus` rule.
- Modify `js/constants.js` — remove `App.BID_STATUSES`.
- (No `taskmanagement.css` change: custom chips ride the existing `.pill`/`.tdp-chip` base class + an inline hex style; seeded chips keep their `.cls` untouched.)

**Ordering:** Task 1 (migration) MUST be applied to prod before Tasks 3–5 (the frontend stops reading `bidStatus` and relies on the Bid type's pipeline statuses existing).

---

### Task 1: Bid pipeline migration (SQL)

**Files:**
- Create: `supabase/sql/059_bid_pipeline.sql`

**Interfaces:**
- Produces: after this runs, `task_type_statuses` for every company's `bid` type has ACTIVE rows `queue`(default) / `started` / `supplier` / `ready` / `done`(is_done), and every `tasks` row with `type='bid'` has `status` ∈ those keys.

- [ ] **Step 1: Write the migration file**

```sql
-- 059_bid_pipeline.sql — retire the separate bid_status field by folding the Bid
-- pipeline into the Bid type's own statuses. Snapshot-first; rewrites only bid rows.
begin;

-- 1. Snapshot (instant rollback safety net).
create schema if not exists backup;
create table if not exists backup.tasks_20260703 as select * from public.tasks;

-- 2. Clear the generic done/default flags on the Bid type so the partial unique
--    indexes (task_status_one_done / task_status_one_default) don't conflict.
update public.task_type_statuses
   set is_done = false, is_default = false
 where type_key = 'bid';

-- 3. Upsert the pipeline stages for every company that has a bid type.
--    Colours mirror the current bid pill tints; Done uses the standard done green.
insert into public.task_type_statuses
  (company_id, type_key, key, label, color, sort_order, is_done, is_default, active)
select c.company_id, 'bid', v.key, v.label, v.color, v.sort_order, v.is_done, v.is_default, true
from (select distinct company_id from public.task_type_statuses where type_key = 'bid') c
cross join (values
  ('queue',    'In queue',         '#3E7BF2', 0::float8, false, true),
  ('started',  'Started',          '#ED9A3A', 1,          false, false),
  ('supplier', 'Waiting supplier', '#E0484D', 2,          false, false),
  ('ready',    'Ready to submit',  '#8F867B', 3,          false, false),
  ('done',     'Done',             '#2E9E6B', 4,          true,  false)
) as v(key, label, color, sort_order, is_done, is_default)
on conflict (company_id, type_key, key) do update
  set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order,
      is_done = excluded.is_done, is_default = excluded.is_default, active = true;

-- 4. Soft-delete the Bid type's leftover generic statuses (todo/pending/hold/review),
--    so the active Bid list is exactly the pipeline. 'done' is reused above.
update public.task_type_statuses
   set active = false
 where type_key = 'bid' and key in ('todo','pending','hold','review');

-- 5. Rewrite bid tasks' status onto a pipeline key (the ONLY rows changed):
--    completed stays done; otherwise use the old bid_status; no-stage -> queue.
update public.tasks
   set status = case
       when status = 'done' then 'done'
       when bid_status is not null then bid_status
       else 'queue' end
 where type = 'bid';

commit;
```

- [ ] **Step 2: Apply to a Supabase branch and verify (NOT prod yet)**

Use the Supabase MCP: `create_branch` on project `qqvmcsvdxhgjooirznrj`, `apply_migration` with the file, then `execute_sql` the verification queries below. Expected results noted inline.

```sql
-- (a) Every bid task's status now resolves to an ACTIVE bid status row -> expect 0.
select count(*) as unresolved
from public.tasks t
where t.type = 'bid'
  and not exists (select 1 from public.task_type_statuses s
                  where s.company_id = t.company and s.type_key = 'bid'
                    and s.key = t.status and s.active);
-- (b) Task row count unchanged (compare to backup) -> expect 0 difference.
select (select count(*) from public.tasks) - (select count(*) from backup.tasks_20260703) as delta;
-- (c) isDone count unchanged: completed bids still 'done' -> expect equal.
select
  (select count(*) from public.tasks where type='bid' and status='done') as done_now,
  (select count(*) from backup.tasks_20260703 where type='bid' and status='done') as done_before;
-- (d) Exactly one default + one done per company for the bid type -> each row count = 1.
select company_id,
       count(*) filter (where is_default) as defaults,
       count(*) filter (where is_done)   as dones
from public.task_type_statuses where type_key='bid' and active group by company_id;
```

Expected: (a) `unresolved = 0`; (b) `delta = 0`; (c) `done_now = done_before`; (d) every row `defaults=1, dones=1`.

- [ ] **Step 3: Apply to production**

Only after Step 2 passes on the branch: `apply_migration` against project `qqvmcsvdxhgjooirznrj`, then re-run the Step 2 verification queries against prod. If any expectation fails, `rollback` = restore `tasks.status` from `backup.tasks_20260703` and re-run Step 2's checks. Delete the Supabase branch.

- [ ] **Step 4: Commit**

```bash
git add supabase/sql/059_bid_pipeline.sql
git commit -m "feat(taxonomy): 059 bid pipeline migration — fold bid_status into Bid type statuses"
```

---

### Task 2: `App.taxonomy` colour + chip-style accessors

**Files:**
- Modify: `js/taxonomy.js` (add methods to the returned `App.taxonomy` object, near `statusLabel` ~line 74)
- Test: `tests/taxonomy-phase4b-harness.mjs`

**Interfaces:**
- Consumes: existing private index `idx[company] = { types:[], statusesByType:{type:[{key,label,color,...}]}, labels:[] }`.
- Produces:
  - `App.taxonomy.color(kind, company, key, type) -> string|null` — hex colour for a taxonomy entry (`kind` ∈ `'type'|'status'|'label'`; `type` only used when `kind==='status'`). Reads inactive rows too (display). `null` if not found.
  - `App.taxonomy.chipStyle(kind, company, key, type) -> { cls: string, style: string }` — seeded key (the global constant map still has a `cls`) → `{cls: '<that cls>', style: ''}`; custom key → `{cls: '', style: 'background:<hex>1a;color:<hex>;'}` (hex + `1a` = ~10% alpha tint; readable ink = the hex). Empty `{cls:'',style:''}` if nothing resolves.

- [ ] **Step 1: Write the failing harness test**

Create `tests/taxonomy-phase4b-harness.mjs`:

```js
// Headless harness: stub globals, load constants.js + taxonomy.js, assert the new accessors.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/,'$1'), '..');
const ctx = { window:{}, document:{ addEventListener(){} }, console };
ctx.window.App = {}; ctx.App = ctx.window.App;
vm.createContext(ctx);
for (const f of ['js/constants.js','js/EventBus.js','js/taxonomy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'), ctx, { filename:f });
}
const App = ctx.window.App;
App.EventBus = App.EventBus || { emit(){}, on(){} };

// Hydrate with a seeded 'todo' status (has a cls) and a CUSTOM 'signed' status (no cls, hex).
App.taxonomy.hydrate({
  types:   [{ company_id:'roofing', key:'bid', label:'Bid', color:'#111111', sort_order:0, active:true }],
  statuses:[
    { company_id:'roofing', type_key:'bid', key:'todo',   label:'Working on it', color:'#3E7BF2', sort_order:0, is_default:true,  is_done:false, active:true },
    { company_id:'roofing', type_key:'bid', key:'signed', label:'Signed',        color:'#AA00FF', sort_order:1, is_default:false, is_done:true,  active:true },
  ],
  labels:  [{ company_id:'roofing', key:'roof', label:'Roof', color:'#E08A0B', sort_order:0, active:true }],
});

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (JSON.stringify(got)===JSON.stringify(want)) { pass++; } else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };

eq('color status seeded', App.taxonomy.color('status','roofing','todo','bid'), '#3E7BF2');
eq('color status custom', App.taxonomy.color('status','roofing','signed','bid'), '#AA00FF');
eq('color label',         App.taxonomy.color('label','roofing','roof'), '#E08A0B');
eq('color missing',       App.taxonomy.color('status','roofing','nope','bid'), null);
// Seeded status key 'todo' keeps its constant cls, no inline style.
eq('chipStyle seeded uses cls', App.taxonomy.chipStyle('status','roofing','todo','bid'),
   { cls: App.STATUSES.todo.cls, style: '' });
// Custom key 'signed' has no cls in constants -> inline hex.
eq('chipStyle custom uses hex', App.taxonomy.chipStyle('status','roofing','signed','bid'),
   { cls: '', style: 'background:#AA00FF1a;color:#AA00FF;' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `node tests/taxonomy-phase4b-harness.mjs`
Expected: FAIL — `App.taxonomy.color is not a function` (accessors don't exist yet).

- [ ] **Step 3: Implement the accessors in `js/taxonomy.js`**

Add these two methods to the object returned as `App.taxonomy` (place right after `statusLabel`). `co(company)` is the existing private index getter; `App.TASK_TYPES/STATUSES/TASK_LABELS` are the global maps whose seeded keys carry a `cls`.

```js
    // Hex colour for a taxonomy entry (reads inactive rows too, for display). kind: 'type'|'status'|'label'.
    color: (kind, company, key, type) => {
      const c = co(company); if (!c) return null;
      let list;
      if (kind === 'type') list = c.types;
      else if (kind === 'label') list = c.labels;
      else list = (c.statusesByType && c.statusesByType[type]) || [];
      const hit = (list || []).find(e => e.key === key);
      return hit && hit.color ? hit.color : null;
    },
    // Chip appearance: seeded key (constant map still carries a cls) -> that class, unchanged.
    // Custom key (no cls) -> inline hex tint via the entry's colour.
    chipStyle: (kind, company, key, type) => {
      const map = kind === 'type' ? App.TASK_TYPES : kind === 'label' ? App.TASK_LABELS : App.STATUSES;
      const cls = map && map[key] && map[key].cls;
      if (cls) return { cls, style: '' };
      const hex = App.taxonomy.color(kind, company, key, type);
      return hex ? { cls: '', style: `background:${hex}1a;color:${hex};` } : { cls: '', style: '' };
    },
```

- [ ] **Step 4: Run the harness, verify it PASSES**

Run: `node tests/taxonomy-phase4b-harness.mjs`
Expected: `6 passed, 0 failed`.

- [ ] **Step 5: `node --check` + commit**

```bash
node --check js/taxonomy.js
git add js/taxonomy.js tests/taxonomy-phase4b-harness.mjs
git commit -m "feat(taxonomy): color() + chipStyle() accessors (seeded cls vs custom hex)"
```

---

### Task 3: Per-type Status dropdown + company/type re-scope in the new-task form

**Files:**
- Modify: `js/views/NewTaskPageView.js` — the `nt-status`/`nt-type` selects (~line 124-126), `updateBidStatusRow` (~297-302) + its listener, `_onCompanyChanged` (~74-90), the bid-status row markup (~line 125), submit capture (~line 413).

**Interfaces:**
- Consumes: `App.taxonomy.activeStatuses(company,type)` → `[{key,label,...}]`; `App.taxonomy.defaultStatus(company,type)` → key; `App.taxonomy.activeTypes(company)`; `App.taxonomy.activeLabels(company)`.
- Produces: the form no longer emits `bidStatus`; `nt-status` options reflect the selected `(company,type)`.

- [ ] **Step 1: Add status/type/label option builders (near `_assigneeOptionsHtml`, ~line 67)**

```js
  _statusOptionsHtml(company, type, selected) {
    const list = App.taxonomy.activeStatuses(company, type);
    const opts = (list && list.length) ? list : Object.entries(App.STATUSES).map(([key, v]) => ({ key, label: v.label }));
    const sel = selected || App.taxonomy.defaultStatus(company, type);
    return opts.map(s => `<option value="${s.key}" ${s.key === sel ? 'selected' : ''}>${App.utils.escapeHtml(s.label)}</option>`).join('');
  }
  _typeOptionsHtml(company, selected) {
    const list = App.taxonomy.activeTypes(company);
    const opts = (list && list.length) ? list : Object.entries(App.TASK_TYPES).map(([key, v]) => ({ key, label: v.label }));
    return opts.map(t => `<option value="${t.key}" ${t.key === selected ? 'selected' : ''}>${App.utils.escapeHtml(t.label)}</option>`).join('');
  }
  _labelOptionsHtml(company, selected) {
    const list = App.taxonomy.activeLabels(company);
    const opts = (list && list.length) ? list : Object.entries(App.TASK_LABELS).map(([key, v]) => ({ key, label: v.label }));
    return opts.map(l => `<option value="${l.key}" ${l.key === selected ? 'selected' : ''}>${App.utils.escapeHtml(l.label)}</option>`).join('');
  }
```

- [ ] **Step 2: Point the Type / Status / Label selects at the builders and delete the Bid-status field**

In `template()`, the current default type is `'admin'`. Replace the three field rows (Type, Status, Label) and REMOVE the `nt-bid-status-row` `<label>` entirely:

```js
              <label class="taf-field"><span class="taf-field-lbl">Type</span><select id="nt-type">${this._typeOptionsHtml(selectedCompany, 'admin')}</select></label>
              <label class="taf-field"><span class="taf-field-lbl">Status</span><select id="nt-status">${this._statusOptionsHtml(selectedCompany, 'admin')}</select></label>
              <label class="taf-field"><span class="taf-field-lbl">Label</span><select id="nt-label">${this._labelOptionsHtml(selectedCompany, 'roof')}</select></label>
```

(Delete the line that renders `id="nt-bid-status-row"` / `nt-bid-status`.)

- [ ] **Step 3: Replace `updateBidStatusRow` with a status re-scope on type change**

Delete `updateBidStatusRow()` and its listener. In `bindEvents()`, where `nt-type` had a `change` listener calling `updateBidStatusRow`, call the new method; add it near `_onCompanyChanged`:

```js
  _onTypeChanged() {
    const company = document.getElementById('nt-company').value;
    const type = document.getElementById('nt-type').value;
    const sel = document.getElementById('nt-status');
    if (sel) sel.innerHTML = this._statusOptionsHtml(company, type, App.taxonomy.defaultStatus(company, type));
  }
```

Listener (replace the old `updateBidStatusRow` binding):
```js
    document.getElementById('nt-type').addEventListener('change', () => this._onTypeChanged());
```

- [ ] **Step 4: Extend `_onCompanyChanged` to re-scope Type/Status/Label**

Add to the existing `_onCompanyChanged(companyId)` body (after the assignee/watcher/project re-scope), before `updateDelegationBanner()`:

```js
    const typeSel = document.getElementById('nt-type');
    const labelSel = document.getElementById('nt-label');
    const statusSel = document.getElementById('nt-status');
    if (typeSel)  typeSel.innerHTML  = this._typeOptionsHtml(companyId, typeSel.value);
    if (labelSel) labelSel.innerHTML = this._labelOptionsHtml(companyId, labelSel.value);
    const type = typeSel ? typeSel.value : 'admin';
    // Reset status to the (possibly re-scoped) type's default — the old status may not
    // exist in the new company/type. Passing no `selected` makes the builder use defaultStatus.
    if (statusSel) statusSel.innerHTML = this._statusOptionsHtml(companyId, type);
```

(`_typeOptionsHtml`/`_labelOptionsHtml` keep the current value selected if it still exists in the new company's set; otherwise no `<option>` carries `selected`, so the browser sets the select to its first option — the effective re-scope reset. Status always resets to the type's default.)

- [ ] **Step 5: Remove `bidStatus` from the submit payload**

In `submit()`, delete the line that reads `bidStatus: document.getElementById('nt-bid-status').value,`. Leave `status:` as is.

- [ ] **Step 6: Verify + commit**

Run: `node --check js/views/NewTaskPageView.js` → expect no output (OK).
Run: `grep -n "bid-status\|bidStatus\|updateBidStatusRow\|BID_STATUSES" js/views/NewTaskPageView.js` → expect NO matches.
Manual (after deploy): open New task → change Type → Status options change and reset to the type's default; change Company → Type/Status/Label re-scope; create a task → it saves with the chosen status and no bid error.

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(new-task): per-type Status dropdown + company re-scope; drop separate Bid-status field"
```

---

### Task 4: Detail view — status controls from taxonomy; drop Bid-status; type-change resets

**Files:**
- Modify: `js/views/TaskDetailView.js` — read `statusObj` (~208); edit `edit-status` (~867) + `edit-bidStatus` block (~866) + type-change listener (~925); inline editor `case 'status'` (~560); `_openStatusMenu` (~602-630); the read-mode `type==='bid'` bid chip (~253/254).

**Interfaces:**
- Consumes: `App.taxonomy.activeStatuses(company,type)`, `App.taxonomy.defaultStatus(company,type)`, `App.taxonomy.statusLabel(company,type,status)`.
- Produces: no `edit-bidStatus`; status option sources are per-type.

- [ ] **Step 1: Add a status-options helper on the view**

Near the top helpers of `TaskDetailView`:

```js
  _statusOpts(t, selected) {
    const list = App.taxonomy.activeStatuses(t.company, t.type);
    const src = (list && list.length) ? list.map(s => [s.key, s.label])
              : Object.entries(App.STATUSES).map(([k, v]) => [k, v.label]);
    // include the current value if it's inactive/unknown so a save doesn't drop it
    if (selected && !src.some(([k]) => k === selected)) {
      src.unshift([selected, App.taxonomy.statusLabel(t.company, t.type, selected)]);
    }
    return src;
  }
```

- [ ] **Step 2: Edit-mode status select + delete the bid-status block**

Replace the `edit-status` options source to use `this._statusOpts(t, d.status)` via the existing `opts(...)` helper, and DELETE the entire `${d.type === 'bid' ? \`...edit-bidStatus...\` : ''}` block:

```js
        <select id="edit-status" style="font-size:12px; padding:4px 8px;">
          ${opts(this._statusOpts(t, d.status), d.status)}
        </select>
```

- [ ] **Step 3: Type-change in edit mode resets status to the type default**

The edit `data-action="type-change"` currently re-renders to toggle the bid row. Change its handler so that on type change it resets the draft status to the new type's default before re-render:

```js
    qa('[data-action="type-change"]').forEach(el => el.addEventListener('change', (e) => {
      this.editDraft.type = e.target.value;
      this.editDraft.status = App.taxonomy.defaultStatus(t.company, e.target.value);
      this.renderEditMode(t);
    }));
```

- [ ] **Step 4: Inline single-field status editor from taxonomy**

In the inline editor builder, replace `case 'status'`:

```js
      case 'status': return sel(this._statusOpts(t, t.status), t.status);
```

- [ ] **Step 5: Quick status menu from taxonomy**

In `_openStatusMenu(t, anchor)`, build options from the type's statuses:

```js
    const list = App.taxonomy.activeStatuses(t.company, t.type);
    const entries = (list && list.length) ? list.map(s => [s.key, s.label]) : Object.entries(App.STATUSES).map(([k, v]) => [k, v.label]);
    menu.innerHTML = entries.map(([k, label]) =>
      `<button class="tdp-status-opt ${k === t.status ? 'is-cur' : ''}" data-status="${k}" type="button">${App.utils.escapeHtml(label)}</button>`).join('');
```

- [ ] **Step 6: Remove the read-mode separate bid chip**

Delete the `${t.type === 'bid' ? \`<span class="tdp-chip">${...bidObj.label}</span>\` : ''}` in the chip row (~line 254) and the `bidObj` lookup (~212) if now unused. The type chip + the status chip (which now shows the pipeline stage) cover it.

- [ ] **Step 7: Verify + commit**

Run: `node --check js/views/TaskDetailView.js` → OK.
Run: `grep -n "edit-bidStatus\|bidStatus\|BID_STATUSES\|bidObj" js/views/TaskDetailView.js` → expect NO matches.
Manual (after deploy): open a Bid task detail → Edit → Status dropdown shows In queue…Done (no separate Bid-status field); change Type → Status resets to that type's default; the quick status menu on the chip lists the type's statuses.

```bash
git add js/views/TaskDetailView.js
git commit -m "feat(detail): status controls from per-type taxonomy; remove Bid-status field"
```

---

### Task 5: Remove remaining `bidStatus` from controller/store/validate/constants

**Files:**
- Modify: `js/controllers/AppController.js` (~793 duplicate, ~823 update, ~1334/1349/1512 create), `js/services/SupabaseDataStore.js` (`_taskRow`), `js/validate.js` (~135-141), `js/constants.js` (~38-43).

**Interfaces:**
- Produces: no code path reads/writes `task.bidStatus`; `_taskRow` writes `bid_status: null`.

- [ ] **Step 1: AppController — drop bidStatus from create/update/duplicate**

Remove the `const bidStatus = type === 'bid' ? ... : null;` computation and any `...(type === 'bid' ? { bidStatus } : {})` / `bidStatus` property from the task payloads at the create (~1334/1349/1512), update (~823), and duplicate (~793) sites. Do not add anything — status alone now carries the stage.

- [ ] **Step 2: SupabaseDataStore — stop writing bid_status**

In `_taskRow(task)`, change the `bid_status` line to always null (column kept for history):

```js
      bid_status: null,
```

Leave `_mapTaskRow` as-is (reading `row.bid_status` into `task.bidStatus` is harmless legacy; if it references it, keep — nothing else consumes it now).

- [ ] **Step 3: validate.js — remove the bidStatus rule**

Delete the block (~135-141) that validates `payload.bidStatus` when `type === 'bid'`.

- [ ] **Step 4: constants.js — remove App.BID_STATUSES**

Delete the `App.BID_STATUSES = { ... }` definition (~38-43).

- [ ] **Step 5: Verify + commit**

Run: `node --check js/controllers/AppController.js js/services/SupabaseDataStore.js js/validate.js js/constants.js` → OK.
Run: `grep -rn "BID_STATUSES\|bidStatus\|nt-bid-status\|edit-bidStatus" js/` → expect NO matches (a lingering `bid_status:` null write in `_taskRow` and a read in `_mapTaskRow` are the only allowed `bid_status` mentions).

```bash
git add js/controllers/AppController.js js/services/SupabaseDataStore.js js/validate.js js/constants.js
git commit -m "refactor(taxonomy): remove dead bidStatus paths (bid is now an ordinary type)"
```

---

### Task 6: Render custom colours across the chips (list, board, detail, reports)

**Files:**
- Modify: `js/views/TaskListView.js` (row status/type/label pills ~612-614, board header ~809), `js/views/TaskDetailView.js` (status chip ~252, type chip ~255), `js/views/ReportsView.js` (~92,104-105).

**Interfaces:**
- Consumes: `App.taxonomy.chipStyle(kind, company, key, type) -> {cls, style}`; `App.taxonomy.color(...)`.
- Produces: seeded chips render EXACTLY as today (their `.cls`, no inline style); custom chips get an inline hex tint.

**Design note (no new CSS class):** a custom chip reuses the SAME base class as the seeded one (`.pill` in the list, `.tdp-chip` in the detail) and only adds the inline `style` from `chipStyle`. Seeded chips get `{cls:'<class>', style:''}` → identical to today. Custom chips get `{cls:'', style:'background:…;color:…;'}` → the base class supplies the pill shape, the inline style supplies the colour. So NO change to `taskmanagement.css` is required — do not add a new chip class (it would restyle seeded chips too). The plain-text `.taf-meta` band values stay plain text (out of scope; only pills/chips are coloured).

- [ ] **Step 1: TaskListView — status/type/label pills via chipStyle**

At the row status cell, replace the class-only pill with a `chipStyle` render (base class `pill` kept, `cls`+`style` from the helper):

```js
      const ss = App.taxonomy.chipStyle('status', t.company, t.status, t.type);
      // render:
      `<span class="pill ${ss.cls}" style="${ss.style}">${App.utils.escapeHtml(App.taxonomy.statusLabel(t.company, t.type, t.status))}</span>`
```

Type cell — same shape with `const st = App.taxonomy.chipStyle('type', t.company, t.type);` → `<span class="pill ${st.cls}" style="${st.style}">…typeLabel…</span>`.
Label cell — `const sl = App.taxonomy.chipStyle('label', t.company, t.label);` → `<span class="pill ${sl.cls}" style="${sl.style}">…labelLabel…</span>`.
Kanban board column header — the column key is a status (or the current groupBy key); if it's a status, use `App.taxonomy.chipStyle('status', company, col.key, col.type)` and apply `{cls,style}` to the existing header element. (Priority-grouped columns are unchanged — priorities are hardcoded.)

- [ ] **Step 2: TaskDetailView — status + type chips via chipStyle**

Status chip (~252) — keep the base `tdp-chip tdp-chip-status`, add `{cls,style}`:
```js
      const sc = App.taxonomy.chipStyle('status', t.company, t.status, t.type);
      // render:
      `<button class="tdp-chip tdp-chip-status ${sc.cls}" style="${sc.style}" data-action="status-menu" type="button">${App.utils.escapeHtml(statusObj.label)} <i class="ti ti-chevron-down"></i></button>`
```
Type chip (~255) — `const tc = App.taxonomy.chipStyle('type', t.company, t.type);` → `<span class="tdp-chip ${tc.cls}" style="${tc.style}">${App.utils.escapeHtml(typeObj.label)}</span>`.

- [ ] **Step 3: ReportsView — status distribution colours from taxonomy**

Where the status bar uses a hardcoded `STATUS_VAR[x.s]`, prefer the taxonomy hex when present, falling back to the current value so seeded looks unchanged:
```js
      const hex = App.taxonomy.color('status', x.company, x.s, x.type) || STATUS_VAR[x.s];
```
and use `hex` in the inline `background`. If the Reports aggregation row lacks a `company`/`type` (e.g. a cross-company roll-up), `color(...)` returns `null` and it falls back to `STATUS_VAR[x.s]` — unchanged behaviour.

- [ ] **Step 4: Verify + commit**

Run: `node --check js/views/TaskListView.js js/views/TaskDetailView.js js/views/ReportsView.js` → OK.
Manual (after deploy): a seeded status/type/label looks exactly as before; create a CUSTOM status in Settings → Task setup with a distinct colour → it shows that colour in the list rows, board column, the detail chip, and Reports.

```bash
git add js/views/TaskListView.js js/views/TaskDetailView.js js/views/ReportsView.js
git commit -m "feat(taxonomy): render custom entry colours across list/board/detail/reports"
```

---

## Final integration check (before requesting prod review)

- [ ] Run the harness + all `node --check`:
```bash
node tests/taxonomy-phase4b-harness.mjs
for f in js/taxonomy.js js/views/NewTaskPageView.js js/views/TaskDetailView.js js/views/TaskListView.js js/views/ReportsView.js js/controllers/AppController.js js/services/SupabaseDataStore.js js/validate.js js/constants.js; do node --check "$f" || echo "FAIL $f"; done
grep -rn "BID_STATUSES\|updateBidStatusRow\|nt-bid-status\|edit-bidStatus" js/ ; echo "(expect nothing above)"
```
- [ ] Confirm migration 059 is applied + verified on prod (Task 1 Step 3).
- [ ] Open PR `feat/taxonomy-phase4b` → main; after merge + deploy, do the manual checks from Tasks 3/4/6 on `https://task.questroofing.com` (hard refresh). Merge to prod only after the user confirms.
