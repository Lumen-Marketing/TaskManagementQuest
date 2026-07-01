# Customizable per-company task taxonomy (types, per-type statuses, labels)

**Date:** 2026-07-02
**Status:** Approved (design); ready for implementation planning
**Scope:** Large, multi-phase. Changes the production Supabase schema + migrates
existing task rows, then swaps the app from hardcoded taxonomy constants to
runtime-loaded, admin-editable, per-company taxonomy.

## Problem

Task **types**, **statuses**, and **labels** are hardcoded in `js/constants.js`
(`App.TASK_TYPES`, `App.STATUSES`, `App.BID_STATUSES`, `App.TASK_LABELS`) and locked
down in Supabase with fixed `CHECK` constraints (`tasks_type_check`,
`tasks_label_check`, and a status check). Only the `bid` type has a pipeline
("Bid status"). The user wants:

1. **Every type has its own status pipeline** — not just Bid.
2. **Types, statuses, and labels are customizable** by managers, not developers.
3. Because a company's set differs, the taxonomy is **per-company**.

## Decisions (locked during brainstorming)

- **Replace model:** each type defines its own ordered status list; a task's `status`
  is drawn from its type's statuses. Exactly one status per type is flagged
  `is_done` (drives completion / Overdue-Done / Reports) and one `is_default` (the
  status a new task of that type starts in, and the "reopen" target).
- **Per-company:** types / statuses / labels are scoped to a company.
- **Editable by** `admin` and `construction_supervisor` of that company; everyone else
  reads and picks from the lists.
- **Keyed storage** (not FK ids): tasks keep their existing text columns; taxonomy
  tables are keyed by `(company_id, key)`; the `CHECK` constraints are dropped.
  Deletes are **soft** (`active=false`) so historical tasks never orphan.
- **`bidStatus` is retired:** Bid becomes an ordinary type. To keep the launch
  migration purely additive, Bid is **initially seeded with the standard statuses**
  (like every other type) so no existing task row is rewritten; the old bid stages
  (In queue → Ready) are re-created by an admin later in Phase 3's admin screen. The
  `tasks.bid_status` column is kept (nullable, unused by new code) for history.
- The deferred **new-task / detail layout redesign** (visual hierarchy complaint) is
  folded into the Phase-4 UI work, since those screens are reworked here anyway.

## Data model

New tables (all with RLS; `color` is a hex string rendered via inline style since
custom entries can't have predefined CSS classes):

```
task_types
  id           uuid pk default gen_random_uuid()
  company_id   text not null            -- matches tasks.company / companies keys
  key          text not null            -- stable slug stored on tasks.type
  label        text not null
  color        text not null default '#8f867b'
  sort_order   double precision not null default 0
  active       boolean not null default true
  created_at   timestamptz default now()
  unique (company_id, key)

task_type_statuses
  id           uuid pk
  company_id   text not null
  type_key     text not null            -- FK-by-convention to task_types.key
  key          text not null            -- stored on tasks.status
  label        text not null
  color        text not null default '#8f867b'
  sort_order   double precision not null default 0
  is_done      boolean not null default false
  is_default   boolean not null default false
  active       boolean not null default true
  unique (company_id, type_key, key)

task_labels
  id           uuid pk
  company_id   text not null
  key          text not null            -- stored on tasks.label
  label        text not null
  color        text not null default '#8f867b'
  sort_order   double precision not null default 0
  active       boolean not null default true
  unique (company_id, key)
```

Per-type invariants (enforced in the admin UI + a DB trigger or partial unique
index): exactly one `is_done=true` and one `is_default=true` per `(company_id,
type_key)`; a type must have ≥1 status.

`tasks` changes: keep `type`, `status`, `label` (text). **Drop** `tasks_type_check`
and `tasks_label_check` (confirmed to exist in migrations 026/047) plus any
`tasks_status_check` / `tasks_bid_status_check` if present (Phase 1 inspects
`pg_constraint` and drops whatever status/type/label CHECKs it finds, name-agnostically,
the way migration 055 re-points the project FK). Keep `bid_status` nullable/unused.

**RLS:** `select` for any approved member whose `company_ids` include the row's
`company_id` (mirrors migration 028's task scoping + `current_company_ids()`);
`insert/update/delete` only when `current_profile_role()` in
(`developer`,`admin`,`construction_supervisor`) AND the row's `company_id` is in the
caller's companies.

## Runtime loading — `App.taxonomy`

The hardcoded constants are replaced by a per-company taxonomy loaded from Supabase
during the existing boot data load and cached in `App.taxonomy`. Shape:

```
App.taxonomy.typesFor(companyId)          -> [{key,label,color,sort}]
App.taxonomy.statusesFor(companyId,type)  -> [{key,label,color,sort,isDone,isDefault}]
App.taxonomy.labelsFor(companyId)         -> [{key,label,color,sort}]
App.taxonomy.typeLabel(companyId,type)    -> string
App.taxonomy.statusLabel(companyId,type,status) -> string
App.taxonomy.labelLabel(companyId,label)  -> string
App.taxonomy.isDone(task)                 -> boolean   (status === the type's is_done)
App.taxonomy.doneStatus(companyId,type)   -> key
App.taxonomy.defaultStatus(companyId,type)-> key
App.taxonomy.color(kind,...)              -> hex for inline style
```

`App.STATUSES / TASK_TYPES / TASK_LABELS / BID_STATUSES` are removed; every reader
(~16 files) switches to `App.taxonomy`. Reload the taxonomy when the admin edits it.

## "Done" refactor (highest-risk area)

Every current use of `status === 'done'` / `status !== 'done'` is replaced with
`App.taxonomy.isDone(task)` / its negation. Known touch points to convert:
`TaskModel` (overdue filter, grouping, `toggleDone`), `SidebarView` (Overdue/Done
counts), `ReportsView`, `HomeView`, `TaskListView`, `TaskDetailView` (`isDone`,
Mark complete), `AppController` (`completeTask`/`toggleTaskDone`,
`_revertToGeneralShiftIfOnTask`). `completeTask` sets `status = doneStatus(company,
type)`; reopen sets `status = defaultStatus(company, type)`.

## Migration (runs on Supabase BEFORE the frontend flip)

One reviewed SQL migration, **additive only — no existing task row is rewritten**:
1. Snapshot: `create table if not exists tasks_backup_<date> as select * from tasks`
   (cheap instant-rollback safety net).
2. Create the three tables + RLS + invariants.
3. **Seed each existing company** (`roofing`, `drafting`, `lumen`) from today's
   constants: types = current `TASK_TYPES`; labels = current `TASK_LABELS`; statuses
   per type = the shared set derived from `STATUSES` (todo/pending/hold/review/done,
   `done`=`is_done`, `todo`=`is_default`) for **every** type, Bid included. This makes
   every existing task's current `type`/`status`/`label` key valid in the new tables,
   so nothing needs to be updated on `tasks`.
4. Drop the old `CHECK` constraints (`tasks_type_check`, `tasks_label_check`, and any
   status/bid CHECK) last.
5. Verify: every distinct `(company, type)`, `(company, type, status)`, and
   `(company, label)` on existing tasks resolves to a seeded row; task row count
   unchanged. (Bid's real pipeline stages are added later by an admin in Phase 3.)

Seeding is idempotent and derived from the exact current constant values so no task
becomes invalid.

## Admin UI — Settings → Task setup

New screen gated to `admin`/`construction_supervisor`, scoped to the active company:
```
Task setup · [Company: Roofing ▾]

TYPES                          STATUSES for “Bid / Estimate”
─────────────                  ───────────────────────────────
• Lead            ⋮            • In queue      ● default    ⋮
• Bid / Estimate  ⋮ (sel)      • Started                     ⋮
• Admin           ⋮            • Waiting supplier            ⋮
• …                            • Ready to submit  ✓ done     ⋮
+ Add type                     + Add status

LABELS
─────────
• Roof   ⋮   • Framing  ⋮   + Add label
```
Add / rename / recolor (color swatch) / drag-reorder / soft-delete; set one status
`done` and one `default` per type. Writes go through new controller methods +
dataStore CRUD; the taxonomy reloads after a save.

## New-task + detail behavior (with the layout redesign)

- Type dropdown drives a **dependent Status dropdown** (options = that type's
  statuses; switching type resets status to that type's default).
- Changing a task's **company** re-scopes type/status/label to that company's sets,
  resetting any value that doesn't exist there to the company/type default.
- The new-task page and detail Details card are restyled for clearer visual hierarchy
  (the "no clear starting point / disconnected columns" complaint), using the UI/UX
  skills. Colors come from the taxonomy rows (inline style).

## Edge cases

- Soft-deleted type/status/label still resolves for display on old tasks (lookup
  includes inactive rows for read; pickers show only active).
- A company with no taxonomy yet (future new company) → seed defaults on creation, or
  the admin screen offers "Seed defaults."
- Reordering uses float `sort_order` midpoints (same pattern as `focus_seq`).

## Non-goals

- Priorities stay hardcoded.
- No per-user taxonomies; no cross-company copy tool (v1).
- `bid_status` column is not dropped (kept for history), just unused by new code.

## Phasing (each its own implementation plan)

1. **DB + migration:** tables, RLS, invariants, seed per company, map tasks, drop
   checks. Applied to Supabase and verified against real data first.
2. **Runtime loading + done-refactor:** `App.taxonomy` loader; replace the constants
   and every `status==='done'` site; keep the app behaving exactly as today but
   data-driven.
3. **Admin UI:** Settings → Task setup CRUD.
4. **New-task/detail UI + layout redesign:** dependent dropdowns, company/type resets,
   visual-hierarchy restyle.

## Delivery / risk

This modifies the **production database** (new tables, dropped constraints) — not a
pure frontend push. Chosen path (optimizing for speed without risking data): apply
directly to the live Supabase project, but keep **Phase 1 additive and reversible**
— it only creates + seeds new tables and drops CHECKs; **no existing task row is
rewritten**. A `tasks_backup_<date>` snapshot is taken first and row-count/resolution
checks run immediately after; rollback = drop the new tables + restore the CHECKs.
Phase 1 must be live and verified before Phase 2 (the frontend flip to `App.taxonomy`)
ships. A separate copy/branch project is intentionally skipped as the slow path.

## Testing

- Migration: dry-run/verify counts — every existing task still resolves a valid
  type/status/label; Overdue/Done counts unchanged pre/post.
- `App.taxonomy.isDone` parity: Reports/sidebar/overdue match the old `==='done'`
  results for seeded data.
- Admin CRUD: add/rename/reorder/recolor/soft-delete round-trips; invariants enforced
  (can't remove the last status, exactly one done/default).
- New-task/detail: type change resets status; company change re-scopes; create +
  complete + reopen use the right per-type statuses.
- Manual mobile check of the admin screen and restyled forms.
