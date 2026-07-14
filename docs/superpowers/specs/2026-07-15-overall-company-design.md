# "Overall" company — design

**Date:** 2026-07-15
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Add an **Overall** option to the company selector when creating/editing a task.
An Overall task "belongs to all companies": it appears under every company's
view/filter (Roofing, Drafting, Lumen) and under its own Overall view, and it
renders an `OVERALL` pill everywhere a company is displayed (tables, task
detail, New Task preview, Home/Reports, CSV export).

## Decisions (from brainstorming)

- **Semantics:** Overall = *belongs to all companies*. A task with
  `company === 'overall'` matches every company filter, not a separate isolated
  bucket.
- **Visibility:** *only cross-company members*. No RLS/schema migration. Overall
  tasks are visible/creatable only to users whose `profiles.company_ids`
  includes `'overall'` (the existing migration-028 RLS gate:
  `company_id = any(current_company_ids())`). A single-company worker will not
  see Overall tasks — this is the accepted trade-off.
- **Taxonomy (Type/Label/Status):** **union** of all companies' active
  types/labels (deduped by key); statuses derive from the type's company of
  origin.
- **Assignee / Watcher / Project:** **everyone / all projects** — full
  cross-company roster and all projects are offered for an Overall task.
- **Scope:** ship the **full feature** (all five parts below) in one plan.

## Non-goals

- No schema migration and no new RLS carve-out. (If we later want *everyone* to
  see Overall tasks regardless of company, that's a separate migration adding an
  `id`-style carve-out like `general-shift`.)
- No taxonomy-table seeding for `overall`; the union is computed client-side.
- No change to how existing single-company tasks behave.

## Data model

- Add a pseudo-company to `App.COMPANIES` (js/constants.js):
  `overall: { id: 'overall', label: 'Overall', pill: 'pill-overall', all: true }`.
  The `all: true` flag marks it as the spans-all sentinel so code can special-case
  it without string-matching `'overall'` everywhere.
- Tasks persist `company_id = 'overall'`. The column is free text (no FK), so the
  DB accepts it; the only gate is RLS on `company_ids`.

### Prerequisite data step (no migration)

For a user to create or see Overall tasks, `'overall'` must be in their
`profiles.company_ids`. Provide this SQL for the admin to run per user (or for
all admins/devs):

```sql
-- Add 'overall' to a specific user's company access.
update public.profiles
set company_ids = array_append(company_ids, 'overall')
where id = '<auth-uuid>'
  and not ('overall' = any(company_ids));
```

Document in the plan that the feature is inert for any user who has not been
granted `'overall'` — the picker option is hidden and RLS blocks the insert.

## Part 1 — Company picker (New Task + Task Detail)

- The "Overall" option appears in the company dropdown **only when the current
  user's accessible companies include `overall`** (i.e. it's in
  `uiState.companies` / their `company_ids`). This keeps the option consistent
  with who can actually save it — never show an option that then fails RLS.
- `NewTaskPageView._companyChoices()` already reads `uiState.companies`; because
  the option is data-driven, granting `'overall'` via the SQL above makes it
  appear automatically. Ensure the fallback path
  (`Object.keys(App.COMPANIES)` when `uiState.companies` is empty) does **not**
  leak `overall` — filter it out of that fallback.
- Task Detail company-edit dropdown follows the same rule.

## Part 2 — "Belongs to all companies" filtering

Add one helper (js/utils.js):

```js
// A company filter of `companyId` matches this task when the task is in that
// company OR is an Overall task (spans all). '*' means "no company filter".
taskInCompany(task, companyId) {
  if (!companyId || companyId === '*') return true;
  return task.company === companyId || task.company === 'overall';
}
```

Route the scattered per-company equality filters through it (or inline the
`|| t.company === 'overall'` where a helper call is awkward):

- `js/controllers/AppController.js:104` — scope filter.
- `js/models/TaskModel.js:107` (`byCompany`), `:134`, `:160`, `:193`
  (`f.companies.includes(t.company)` → also match overall).
- `js/views/tasklist/WatchingLayout.js:19`.

Add an explicit **Overall chip** to the company chip row
(`js/views/tasklist/TableLayout.js` ~:29-34) and the FilterBar company group
(`js/views/FilterBarView.js:45`) so the user can also view *only* Overall tasks.
The Overall chip filters with strict equality (`t.company === 'overall'`), not
the spans-all helper.

## Part 3 — Display ("reflect in tables and others")

- Add `.pill-overall` to the pill palette (css) using an existing accent token —
  no hardcoded hex (per design-taste guidance).
- `App.directory.company('overall')` must return the Overall descriptor so every
  consumer that renders a company pill/label shows `OVERALL`:
  - table rows (`TableLayout`),
  - Task Detail company chip + the New Task preview `COMPANY` row,
  - Home / Reports company breakdowns,
  - CSV export company column.
- Audit every `App.directory.company(id)` / `App.COMPANIES[id]` render site so
  none of them break or show a raw `overall` string.

## Part 4 — Taxonomy union for Overall

`App.taxonomy` currently returns `empty()` for an unknown company, so
`activeTypes('overall')` is `[]`. Add an Overall branch:

- `activeTypes('overall')` → union of `activeTypes(c)` for every real company,
  deduped by `key` (first wins).
- `activeLabels('overall')` → same union over labels.
- `activeStatuses('overall', type)` → statuses for `type` from whichever real
  company defines that type (first match), so the status list is non-empty.
- `typeLabel` / `statusLabel` / `labelLabel` / `defaultStatus` / `doneStatus`
  resolve against the same union so an Overall task's stored type/label/status
  render and complete correctly.

Keep this isolated behind a small internal helper (e.g. `unionCo()`), so the
per-company accessors stay simple and the Overall behavior is testable on its
own.

## Part 5 — Assignee / Watcher / Project scope for Overall

- `App.utils.peopleInCompany('overall', includeIds)` → return the full active
  roster (same as the `'*'` path). Add `overall` to the early-return alongside
  `'*'`.
- New Task project picker (`NewTaskPageView` project items) for an Overall task →
  list projects from **all** companies (drop the `p.companyId === S.company`
  filter when `S.company === 'overall'`).

## Testing

- Unit: `taskInCompany` truth table (real company, overall, `'*'`, empty).
- Unit: taxonomy union — `activeTypes('overall')` dedupes; `activeStatuses`
  resolves a type defined in only one company; `defaultStatus`/`isDone` for an
  Overall task.
- Unit: `peopleInCompany('overall')` returns the full roster.
- Manual QA (as a user granted `'overall'`):
  1. Create an Overall task; confirm it saves (RLS) and shows an `OVERALL` pill.
  2. It appears under Roofing, Drafting, Lumen, and the Overall chip.
  3. Type/Label/Assignee/Project pickers are populated.
  4. As a single-company user *without* `'overall'`: the option is hidden and the
     task is not visible. (Confirms the visibility trade-off.)

## Risks / notes

- **Silent RLS failure:** if the option ever renders for a user lacking
  `'overall'`, the insert fails. Mitigated by gating the option on
  `uiState.companies`.
- **Union ambiguity:** two companies could define the same type key with
  different labels; first-wins is deterministic and acceptable.
- Follow existing patterns: no hairline borders, tokens only, ALL-CAPS on save
  already handled by the controller seams (unchanged here).
