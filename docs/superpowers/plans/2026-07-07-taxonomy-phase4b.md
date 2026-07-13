# Taxonomy Phase 4b — Bid Pipeline Migration + TaskDetailView Gaps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last unfinished gaps in the customizable-taxonomy project: fix the three places in `TaskDetailView` where Type and Label dropdowns still use hardcoded global constants instead of the live per-company taxonomy; verify the bid-pipeline DB migration is applied (likely already done — the detailed memory confirms it, but the SQL file exists for confirmation).

**Architecture:** Phases 2 (runtime loader, `js/taxonomy.js`), 3 (admin UI, `TaskSetupAdminView.js`), and most of Phase 4 (dependent status dropdowns in `NewTaskPageView` + `_statusOpts` in `TaskDetailView`) are already shipped. The bid pipeline migration (`059_bid_pipeline.sql`) was applied per the project memory. The remaining gaps are in `TaskDetailView`: full-edit and inline-edit still pull Type and Label options from `App.TASK_TYPES` / `App.TASK_LABELS` instead of `App.taxonomy.activeTypes/activeLabels`, and the full-edit form has no company-change handler to re-scope those pickers.

**Tech Stack:** Vanilla JS (zero-build SPA); Supabase (project `qqvmcsvdxhgjooirznrj`); SQL via Supabase Dashboard SQL editor.

## Global Constraints

- Zero-build SPA: no npm, no bundler — every change is a plain `.js` or `.sql` file edit, live immediately on reload.
- Never hardcode `App.TASK_TYPES` or `App.TASK_LABELS` in a picker that should show per-company live data — use `App.taxonomy.activeTypes(company)` / `App.taxonomy.activeLabels(company)`.
- PROD Supabase project ID: `qqvmcsvdxhgjooirznrj`. Do NOT touch project `rqundirizvojpzhljtdn`.
- Migration files live in `supabase/sql/`. Filename prefix is the next available number: 059 is taken (both `059_bug_reports.sql` and `059_bid_pipeline.sql` exist); rename the bid pipeline file to `060_bid_pipeline.sql`.
- Existing migration `059_bid_pipeline.sql` has a number conflict — it must be renamed before applying.
- After any DB migration verify: task row count unchanged; every bid task's `status` resolves to a seeded active Bid status row.
- TaskDetailView inline edit is a single-field auto-save editor; changing type inline just commits the type key — no cascading status reset needed (the read view handles the edge case via `statusLabel` fallback).
- `_statusOpts` in `TaskDetailView` already uses `App.taxonomy.activeStatuses` — no change needed there.

---

### Task 1: Verify the bid pipeline migration is applied (likely already done)

**Files:**
- No code change expected — this is a verification step only.
- If NOT applied: `supabase/sql/059_bid_pipeline.sql` (rename to `060` first since `059_bug_reports.sql` already occupies that slot on PROD).

**Interfaces:**
- Produces: Bid type's `task_type_statuses` for every company = `[queue, started, supplier, ready, done]`; generic Bid statuses soft-deleted; all bid tasks have a pipeline `status` key.

- [ ] **Step 1: Run the verification query in Supabase Dashboard**

  Open the SQL editor for project `qqvmcsvdxhgjooirznrj`. Run:
  ```sql
  -- Confirm the pipeline statuses exist and generics are soft-deleted.
  select company_id, key, label, is_done, is_default, active
  from task_type_statuses
  where type_key = 'bid'
  order by company_id, sort_order;

  -- Confirm every bid task's status resolves to an active pipeline row.
  select t.status, ts.label, ts.active
  from tasks t
  left join task_type_statuses ts
    on ts.company_id = t.company
   and ts.type_key   = 'bid'
   and ts.key        = t.status
  where t.type = 'bid'
  group by t.status, ts.label, ts.active
  order by t.status;
  ```

  **Expected (migration already applied):** you see 5 active rows per company (`queue/started/supplier/ready/done`) and zero null `ts.label` for bid tasks. If so, skip the remaining steps in this task.

- [ ] **Step 2: If NOT applied — rename and apply**

  Only run these steps if Step 1 shows the generic statuses are still active or bid tasks have unresolved statuses:
  ```bash
  # Rename to avoid conflict with 059_bug_reports.sql
  git mv supabase/sql/059_bid_pipeline.sql supabase/sql/060_bid_pipeline.sql
  ```
  Then paste `supabase/sql/060_bid_pipeline.sql` into the Supabase Dashboard SQL editor and run it. Re-run the verification query from Step 1 to confirm.

---

### Task 2: Fix Type and Label dropdowns in TaskDetailView full-edit mode

**Files:**
- Modify: `js/views/TaskDetailView.js` (lines 1108, 1110 of `renderEditMode`)

**Interfaces:**
- Consumes: `App.taxonomy.activeTypes(company) → [{key, label}]`, `App.taxonomy.activeLabels(company) → [{key, label}]` (already used in `NewTaskPageView`; same pattern here).
- Produces: Full-edit Type and Label `<select>` elements driven by live per-company taxonomy.

- [ ] **Step 1: Locate the two hardcoded selects in `renderEditMode`**

  In `js/views/TaskDetailView.js`, around line 1108:
  ```js
  <label class="taf-field"><span class="taf-field-lbl">Type</span><select id="edit-type" data-action="type-change">${opts(Object.entries(App.TASK_TYPES).map(([k, v]) => [k, v.label]), d.type)}</select></label>
  <label class="taf-field"><span class="taf-field-lbl">Label</span><select id="edit-label">${opts(Object.entries(App.TASK_LABELS).map(([k, v]) => [k, v.label]), d.label)}</select></label>
  ```

- [ ] **Step 2: Replace both lines**

  Replace the Type line (1108) with:
  ```js
  <label class="taf-field"><span class="taf-field-lbl">Type</span><select id="edit-type" data-action="type-change">${opts(App.taxonomy.activeTypes(d.company).map(t => [t.key, t.label]), d.type)}</select></label>
  ```

  Replace the Label line (1110) with:
  ```js
  <label class="taf-field"><span class="taf-field-lbl">Label</span><select id="edit-label">${opts([['none', (App.TASK_LABELS.none && App.TASK_LABELS.none.label) || 'No label'], ...App.taxonomy.activeLabels(d.company).map(l => [l.key, l.label])], d.label || 'none')}</select></label>
  ```
  Note the `none` head option — mirrors what `NewTaskPageView._labelOptionsHtml` does so the "No label" choice is always available.

- [ ] **Step 3: Verify in the browser**

  Open the app (run a local server or open `index.html`). Open any task's detail, click Edit. Confirm:
  - The Type dropdown shows the company's live types (from `App.taxonomy.activeTypes`), not the hardcoded constants.
  - The Label dropdown starts with "No label" then shows the company's live labels.

- [ ] **Step 4: Commit**

  ```bash
  git add js/views/TaskDetailView.js
  git commit -m "fix(detail): wire full-edit Type/Label dropdowns to live taxonomy"
  ```

---

### Task 3: Fix Type and Label options in TaskDetailView inline-edit

**Files:**
- Modify: `js/views/TaskDetailView.js` (lines 744–745 of `_inlineEditorHtml`)

**Interfaces:**
- Consumes: `App.taxonomy.activeTypes(company) → [{key, label}]`, `App.taxonomy.activeLabels(company) → [{key, label}]`.
- Produces: Inline-edit Type and Label `<select>` elements driven by live per-company taxonomy.

- [ ] **Step 1: Locate the two hardcoded inline-edit cases**

  In `js/views/TaskDetailView.js`, around line 744 in `_inlineEditorHtml`:
  ```js
  case 'type':  return sel(Object.entries(App.TASK_TYPES).map(([k, v]) => [k, v.label]), t.type);
  case 'label': return sel(Object.entries(App.TASK_LABELS).map(([k, v]) => [k, v.label]), t.label || 'none');
  ```

- [ ] **Step 2: Replace both cases**

  Replace the `type` case (line 744) with:
  ```js
  case 'type':  return sel(App.taxonomy.activeTypes(t.company).map(tp => [tp.key, tp.label]), t.type);
  ```

  Replace the `label` case (line 745) with:
  ```js
  case 'label': return sel([['none', (App.TASK_LABELS.none && App.TASK_LABELS.none.label) || 'No label'], ...App.taxonomy.activeLabels(t.company).map(l => [l.key, l.label])], t.label || 'none');
  ```

- [ ] **Step 3: Verify in the browser**

  Open the app. Open any task detail (read mode). Click the Type value cell inline — confirm the inline `<select>` shows the company's live types. Click the Label value cell — confirm it starts with "No label" then the company's live labels.

- [ ] **Step 4: Commit**

  ```bash
  git add js/views/TaskDetailView.js
  git commit -m "fix(detail): wire inline-edit Type/Label selects to live taxonomy"
  ```

---

### Task 4: Add company-change handler in TaskDetailView full-edit

**Files:**
- Modify: `js/views/TaskDetailView.js` (`bindEditHandlers` method, around line 1186)

**Interfaces:**
- Consumes: `App.taxonomy.activeTypes(company)`, `App.taxonomy.defaultStatus(company, type)`, `App.utils.peopleInCompany(company, assignee)`.
- Produces: Changing Company in the full-edit form re-scopes Type, Status, Label, and Assignee dropdowns to the new company's taxonomy (mirrors `NewTaskPageView._onCompanyChanged`).

- [ ] **Step 1: Locate the company select in `bindEditHandlers`**

  In `js/views/TaskDetailView.js`, inside `bindEditHandlers` (starting around line 1157). The company select is `#edit-company` — currently there is no `change` listener for it.

- [ ] **Step 2: Add the company-change handler**

  Add this block immediately after the `type-change` handler (after line ~1186):
  ```js
  // Company change: re-scope Type, Status, Label, Assignee to the new company.
  const companySel = this.pane.querySelector('#edit-company');
  if (companySel) companySel.addEventListener('change', (e) => {
    this._syncDraftFromDom();
    const newCo = e.target.value;
    this.editDraft.company = newCo;
    // Reset type to first active type for the new company if current doesn't exist there.
    const newTypes = App.taxonomy.activeTypes(newCo);
    if (!newTypes.some(tp => tp.key === this.editDraft.type)) {
      this.editDraft.type = (newTypes[0] && newTypes[0].key) || this.editDraft.type;
    }
    this.editDraft.status = App.taxonomy.defaultStatus(newCo, this.editDraft.type);
    this.renderEditMode(t);
  });
  ```

- [ ] **Step 3: Verify in the browser**

  Open a task assigned to one company. Click Edit. Change the Company dropdown to a different company — confirm Type, Status, and Label dropdowns repopulate for the new company.

- [ ] **Step 4: Commit**

  ```bash
  git add js/views/TaskDetailView.js
  git commit -m "fix(detail): re-scope type/status/label on company change in full-edit"
  ```

---

## Self-review checklist

- [x] **Bid pipeline migration** — all 5 steps present in `060_bid_pipeline.sql`; pre/post verification queries included; rollback path documented.
- [x] **Full-edit Type** — `renderEditMode` line 1108 uses `App.taxonomy.activeTypes(d.company)`.
- [x] **Full-edit Label** — `renderEditMode` line 1110 uses `App.taxonomy.activeLabels(d.company)` with `none` head option.
- [x] **Inline-edit Type** — `_inlineEditorHtml` line 744 uses `App.taxonomy.activeTypes(t.company)`.
- [x] **Inline-edit Label** — `_inlineEditorHtml` line 745 uses `App.taxonomy.activeLabels(t.company)` with `none` head option.
- [x] **Company-change handler** — `bindEditHandlers` re-scopes type/status/label on company change.
- [x] **No changes to** `_statusOpts` (already taxonomy-driven), `NewTaskPageView` (already done), `FilterBarView` (uses `App.STATUSES`/`App.TASK_TYPES` globals which `applyGlobals()` rebuilds from taxonomy), `TaskSetupAdminView` (Phase 3 complete), `js/taxonomy.js` (Phase 2 complete).
- [x] **`059_bid_pipeline.sql`** has a number conflict — plan calls for renaming to `060` before committing/applying.
- [x] No placeholder steps — every step has exact code or exact SQL.
