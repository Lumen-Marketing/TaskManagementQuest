# Multiple "Reports To" supervisors — design

**Date:** 2026-07-22
**Status:** Approved (brainstorm) — ready for implementation plan

## Problem

Each person can currently report to exactly one supervisor. In the People/Approvals
admin, the "Reports To" cell is a single `<select>` bound to `profiles.supervisor_id`
(one `team_members.id`). Users want a person to be able to report to **multiple**
people (a short list, 2–4).

"Reports to" is not cosmetic. It drives:
- **Access:** a supervisor can read/see the **tasks** and **time/workload** of anyone
  whose `supervisor_id` points at their `member_id`. Enforced both client-side
  (`AppController` direct-report seams) and server-side (RLS policies).
- **Org chart:** `HierarchyView` builds the chain of command from `supervisor_id`.

## Decisions (from brainstorm)

- **Access semantics:** every supervisor a person reports to sees that person **fully**
  (tasks + time/workload), identical to how a single supervisor sees a direct report today.
- **Count:** a short list, capped at **4**.
- **Picker UI:** removable **chips + an "+ Add" dropdown** in the "Reports To" cell.
- **Notifications:** out of scope. Seams that notify "the supervisor" keep using the
  primary (`supervisor_ids[1]`). "Notify all my bosses" is a future follow-up.

## Approach

Follow the existing `profiles.company_ids text[]` precedent (a person already belongs to
multiple companies via a text array). Introduce a parallel `supervisor_ids text[]`.

### Data model

- Add `profiles.supervisor_ids text[]` (each element a `team_members.id`).
- **Backfill:** `supervisor_ids = array[supervisor_id]` where `supervisor_id` is not null,
  else `'{}'`.
- **Keep `supervisor_id`** for backward compatibility, always mirroring `supervisor_ids[1]`
  (the "primary") via a `before insert/update` trigger. Anything not yet migrated to the
  array keeps working. `supervisor_id` becomes a derived column — not written directly by
  the app.
- **Constraints/freezes carried over from the single-column era:**
  - `member_id` must not appear in its own `supervisor_ids` (replaces the
    `supervisor_id <> member_id` check from migration 014).
  - Self-update policies that froze `supervisor_id` (016/017/021/042) must also freeze
    `supervisor_ids`, so a worker cannot reassign their own reporting line.

### RLS

- Add helper `public.reports_to_me(sup_ids text[]) returns boolean`
  = `public.current_member_id() = any(sup_ids)` (security definer, stable, granted to
  authenticated) — mirrors the existing `current_member_id()` helper style.
- Every policy that currently tests `p.supervisor_id = public.current_member_id()`
  switches to `public.reports_to_me(p.supervisor_ids)`. Affected policies live in
  migrations 028, 043, 046, 051, and 072 (the committed-but-unapplied latest). 073 is
  written against the **post-072** baseline, so the apply order is simply 072 then 073.
- Index: add a GIN index on `supervisor_ids` to support `= any(...)` /
  `reports_to_me` subqueries (the old btree `profiles_supervisor_idx` on `supervisor_id`
  stays, since `supervisor_id` still exists).

### Client seams

- `AppController` direct-report seams ([:107-109](../../../js/controllers/AppController.js),
  [:557-558](../../../js/controllers/AppController.js)):
  `p.supervisor_id === me` → `Array.isArray(p.supervisor_ids) && p.supervisor_ids.includes(me)`.
- `SupabaseDataStore`:
  - `_profileColumns` selects `supervisor_ids` (in addition to / instead of `supervisor_id`).
  - `updateProfileAccess(updates)` accepts `supervisorIds` (array) → writes `supervisor_ids`.
  - `createUser({ ..., supervisorIds })` writes `supervisor_ids`.
- `app.js` local-profile patch ([:49](../../../js/app.js)) and preview/demo seeds
  (`auth-guard.js`, `app.js` demo profiles) updated to carry `supervisor_ids`.

### UI — ApprovalView

- Table "Reports to" cell ([:105](../../../js/views/ApprovalView.js)) and the "Add Person"
  modal field ([:228-229](../../../js/views/ApprovalView.js)) become a **chips + add**
  control:
  - Render each selected supervisor as a removable chip (`Name ×`).
  - A `+ Add` dropdown lists remaining eligible people (`supervisorOptions`, overseeing
    role + member id, excluding self and already-picked).
  - Hard cap at 4 selected; hide/disable `+ Add` at the cap.
- On save, collect chip ids into a `supervisorIds` array; pass through
  `updateProfileAccess` / `createUser`.

### HierarchyView

- A person renders as a direct report under **each** supervisor in `supervisor_ids`
  (a node may appear under multiple parents). No-supervisor people stay in the shared
  "Unassigned" pool as today.

## Migration & rollout

- New migration `supabase/sql/073_multiple_supervisors.sql`:
  1. add `supervisor_ids text[]` + backfill,
  2. `reports_to_me()` helper + GIN index,
  3. mirror trigger (`supervisor_id := supervisor_ids[1]`),
  4. self-membership check + extend self-update freezes to `supervisor_ids`,
  5. re-issue affected RLS policies using `reports_to_me()`.
- Companion `supabase/sql/verify/073_check.sql`: asserts backfill parity, trigger mirror,
  and that no rewritten policy still references the bare `supervisor_id = current_member_id()`.
- **Rollout discipline (per project memory):** apply 072 then 073 on a **dev copy** and
  pass the verify script **before prod**. Do not apply blind.

## Out of scope (YAGNI)

- "Notify all supervisors" on task/check-in events (keeps primary only).
- Changing the org-chart layout for multi-parent beyond duplicating the node.
- Any change to role-based visibility (only the explicit reporting line changes).

## Testing

- Unit: direct-report seam includes a person listed in `supervisor_ids` for **each**
  listed supervisor and excludes others; cap-at-4 enforced in the picker collector.
- Manual/QA: on a dev DB — a worker reporting to A and B; confirm both A and B see the
  worker's tasks + time; confirm the worker cannot self-edit `supervisor_ids`; confirm
  the org chart shows the worker under both A and B.
