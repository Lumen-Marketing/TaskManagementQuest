# Taxonomy Phase 4b — dependent status dropdowns, bid retirement, custom colours

**Date:** 2026-07-03
**Status:** Approved (design); ready for implementation planning
**Parent design:** `docs/superpowers/specs/2026-07-02-customizable-task-taxonomy-design.md`
(this spec is the "New-task/detail behavior" + colour parts of that parent, now that
Phases 1–4a are live on prod).

## Context — what is already live (origin/main)

- **Phase 1 (DB):** `task_types`, `task_type_statuses`, `task_labels` exist in the
  production Supabase project, seeded per company, each row carrying a hex `color`.
- **Phase 2 (`App.taxonomy`):** loads those tables at boot and exposes per-company,
  per-type accessors — `activeTypes(company)`, `activeStatuses(company, type)`,
  `activeLabels(company)`, `typeLabel/statusLabel/labelLabel(...)`, `isDone(task)`,
  `doneStatus(company, type)`, `defaultStatus(company, type)`. It also rebuilds the
  global `App.TASK_TYPES/STATUSES/TASK_LABELS` maps, **preserving each seeded key's
  `cls`** (the offline pastel class); custom keys have no `cls`.
- **Phase 3:** the **Settings → Task setup** admin screen (add / rename / recolor /
  reorder / soft-delete types, statuses, labels; set one done + one default per type).
  Colour swatches already save a hex `color` to the DB.
- **Phase 4a:** the new-task form and detail edit/read use the `.taf` layout.

**What is NOT done yet (this spec):** the forms still populate the Status dropdown from
a *flat* hardcoded option list (Active/Pending/Hold) and keep a **separate Bid-status
field**; every status/type/label chip renders through the hardcoded pastel `cls`, so a
**custom** taxonomy entry's chosen colour is never shown. Phase 4b wires the live
taxonomy through the UI.

## Goal

Make the task forms drive Status from the selected type's own statuses, retire the
separate Bid-status field (folding the Bid pipeline into the Bid type's statuses without
losing data), and render each custom taxonomy entry's colour everywhere its chip appears.

## Component 1 — Per-type Status dropdown (forms + inline editors)

The Status control is populated from `App.taxonomy.activeStatuses(company, type)` for the
currently-selected `(company, type)`, in every place the user picks or changes a status:

- **New-task form** (`NewTaskPageView`): the `nt-status` `<select>`.
- **Detail edit mode** (`TaskDetailView`): the `edit-status` `<select>`.
- **Detail inline status editor** and the **quick status menu** (the click-to-change
  popover on the status chip).

Behaviour:

- **On type change** → repopulate the Status options for the new type and set the value to
  that type's `App.taxonomy.defaultStatus(company, type)`.
- **On company change** → re-scope the Type, Status, and Label pickers to the new
  company's taxonomy. Reset any currently-selected value that does not exist in the new
  company's set to that company/type default (type → company default type; status → new
  type's default; label → company's default/first label).
- **Read-mode display** already resolves labels through `App.taxonomy.statusLabel(...)`;
  no change beyond colour (Component 3).

New-task defaults: on first render, Status defaults to the selected type's
`defaultStatus`; changing type/company follows the rules above.

## Component 2 — Retire the separate Bid-status field (pipeline preserved)

### Data migration (one reviewed SQL file; snapshot + verify; Phase-1 style)

1. **Snapshot:** `create table if not exists backup.tasks_<date> as select * from tasks`.
2. **Seed the Bid type's statuses** for every company that has a `bid` type, replacing its
   generic seeded statuses with the real pipeline (idempotent upsert on
   `(company_id, type_key, key)`):

   | key        | label             | sort | flags                |
   |------------|-------------------|------|----------------------|
   | `queue`    | In queue          | 0    | `is_default = true`  |
   | `started`  | Started           | 1    |                      |
   | `supplier` | Waiting supplier  | 2    |                      |
   | `ready`    | Ready to submit   | 3    |                      |
   | `done`     | Done              | 4    | `is_done = true`     |

   `done` reuses the existing generic `done` row (relabel/keep); the four pipeline stages
   are inserted. Then **soft-delete the Bid type's other generic statuses**
   (`pending`, `hold`, `review`, and the generic `todo`) so the Bid type's *active* list is
   exactly In queue → Started → Waiting supplier → Ready to submit → Done. Set the flags so
   exactly one `is_default` (`queue`) and one `is_done` (`done`) hold — clear the old
   generic flags first, honouring the partial unique indexes from Phase 1. Colours: reuse
   the existing bid `cls` palette values as the seeded hex so the pills look unchanged; Done
   uses the standard done green.
3. **Migrate existing bid task rows** (the only rows this migration rewrites) so every bid
   task lands on a pipeline status:
   `update tasks set status = case when status = 'done' then 'done'
     when bid_status is not null then bid_status else 'queue' end where type = 'bid';`
   A bid task mid-pipeline (`bid_status='started'`) now has `status='started'`; one already
   completed keeps `status='done'`; a bid with no stage (`bid_status` null, status not done)
   defaults to `queue` (In queue). Since old `bid_status` keys are exactly
   queue/started/supplier/ready, every result is a seeded Bid status. `bid_status` is left
   in place for history.
4. **Verify:** every `(company,'bid')` bid task's resulting `status` resolves to a seeded
   **active** Bid status row; task row count unchanged; the count of tasks with `isDone`
   true is unchanged from before (completed bids stay completed).

Rollback = restore `status` from the snapshot, re-activate the generic Bid statuses, and
remove the pipeline stages.

### Frontend removal

- Delete the separate Bid-status field from the new-task form (`nt-bid-status-row`,
  `nt-bid-status`, `updateBidStatusRow` and its type-change listener) and from detail edit
  (`edit-bidStatus`).
- Remove every `type === 'bid'` special-case that shows/reads/saves `bidStatus`
  (`NewTaskPageView`, `TaskDetailView` read+edit+inline+draft, `AppController`
  create/update/duplicate, `SupabaseDataStore._taskRow`/`_mapTaskRow`, `validate.js`).
- `SupabaseDataStore` stops writing `bid_status` (leave the column; new writes set it
  `null`/omit). The Bid type now flows through Component 1 like any type — its Status
  dropdown *is* the pipeline.
- `App.BID_STATUSES` is removed from constants (no remaining readers).

## Component 3 — Custom colours everywhere

One helper resolves the visual treatment for a taxonomy chip (type / status / label):

- **Seeded key** (the constant map still carries a `cls` for it) → emit that pastel
  **class** exactly as today. Nothing currently on screen changes.
- **Custom key** (no `cls`) → emit the entry's **hex colour inline**, using the same
  `--pc` custom-property pattern already proven for project folders
  (`style="--pc:<hex>"` + a small chip rule that reads `--pc`).

Signature (added to `js/taxonomy.js`):
`App.taxonomy.chipStyle(kind, company, key[, type]) -> { cls: string|'', style: string|'' }`
where `kind ∈ {type, status, label}`. `color(kind, company, key[, type]) -> hex` backs it.

Applied at every chip render site: task-list rows (status / type / label cells), board
column headers, the detail chip row + properties band, the new-task/detail forms, and
Reports' status distribution. Priorities stay hardcoded (non-goal).

CSS: add one neutral chip rule per kind that consumes `--pc` (background tint + readable
ink) mirroring the existing `--pc` project-tag rule, so custom entries get a consistent,
on-brand pill without a bespoke class.

## Edge cases

- A soft-deleted (inactive) type/status/label still **resolves for display** on old tasks
  (lookups read inactive rows); pickers list **active only**.
- A company with no taxonomy rows falls back to the seeded defaults already present.
- If a task's stored status isn't in its type's active list (e.g. after an admin
  soft-deletes a status), the read view still shows its resolved label; the edit dropdown
  shows the current value as a disabled/one-off option plus the active choices, so saving
  doesn't silently change it.

## Non-goals

- Priorities remain hardcoded.
- No new admin-screen work (Phase 3 already manages colours/statuses); 4b only *consumes*
  the taxonomy. The Bid pipeline is seeded by the migration, then editable in Task setup.
- `tasks.bid_status` column is not dropped (kept for history), just unused by new code.

## Testing

- **Migration:** on a snapshot/branch first — every bid task's new `status` resolves to a
  seeded Bid status; total task count unchanged; `isDone` count unchanged pre/post.
- **Component 1:** changing type in the new-task form and detail edit repopulates Status
  and selects the type's default; changing company re-scopes and resets invalid values;
  create + Mark complete + reopen use the per-type default/done statuses.
- **Component 2:** a Bid task's Status dropdown shows In queue…Done; no separate Bid-status
  field remains anywhere; a previously "Started" bid reads "Started"; a completed bid reads
  Done.
- **Component 3:** a seeded status/type/label looks identical to today; a custom entry
  created in Task setup shows its chosen colour in the list rows, board, detail, forms, and
  Reports.
- Manual mobile check of the forms.
