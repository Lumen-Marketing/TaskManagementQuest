# Multiple "Reports To" Supervisors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person report to multiple supervisors (a short list, capped at 4), where every listed supervisor sees that person's tasks and time/workload — replacing the single `profiles.supervisor_id`.

**Architecture:** Add a `profiles.supervisor_ids text[]` array (mirroring the existing `company_ids text[]` pattern), backfilled from `supervisor_id`. A DB trigger keeps the scalar `supervisor_id` = `supervisor_ids[1]` (the "primary") in both directions, so legacy readers/writers (e.g. the `create-user` edge function, check-in/notify seams) keep working untouched. RLS policies that gate a supervisor to their reports switch from `p.supervisor_id = current_member_id()` to a new `public.reports_to_me(p.supervisor_ids)` helper. The client reads the array through one pure seam, `App.utils.reportsTo(profile, memberId)`, and the People/Approvals table cell becomes a chips + "+ Add" multi-picker.

**Tech Stack:** Zero-build static SPA (vanilla JS, `window.App` globals), Supabase Postgres + RLS, Node's built-in `node:test` for unit tests (`npm run test:unit`).

## Global Constraints

- **Never `git add -A` / `git add .`** — stage explicit paths only (hundreds of untracked scratch files exist).
- **Migrations do not get applied by this plan.** Migration 073 is written to disk and committed only. It is sequenced **after 072** (which is committed but unapplied on every DB). Applying = a separate, manual step on a **dev copy first**, passing the verify script **before prod**.
- **`git commit -F <file>`** for commit messages (PowerShell here-strings shatter into pathspecs). End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Multi-value writes on `profiles` follow the `company_ids text[]` precedent exactly (NOT NULL, default `'{}'`, GIN index).
- Cap a person at **4** supervisors in the UI.
- Do NOT change notification/check-in behavior — those seams keep reading the scalar `supervisor_id` (= primary).
- Preview mode (`?role=`/`?member=`) is localhost-only; keep its demo profiles working but don't over-invest.

---

### Task 1: `App.utils.reportsTo` pure seam

The one place that answers "does this profile report to member X?". Both `AppController` and `HierarchyView` will consume it, and it is trivially unit-testable — same shape as the existing `isAssignee` seam.

**Files:**
- Modify: `js/utils.js` (insert after `isAssignee`, which ends at line 212)
- Test: `tests/unit/reports-to.test.mjs` (create)

**Interfaces:**
- Produces: `App.utils.reportsTo(profile, memberId) -> boolean` — true iff `memberId` is a non-empty string present in `profile.supervisor_ids`. Legacy rows may carry only the scalar `supervisor_id`, so fall back to it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reports-to.test.mjs`:

```js
// tests/unit/reports-to.test.mjs
//
// Multiple supervisors (migration 073). A profile stores supervisor_ids[] — each
// element a team_members id. Every listed supervisor "oversees" the person. Rows
// written before 073 may carry only the scalar supervisor_id, so fall back to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');

const U = global.App.utils;

const A = 'abraham';
const B = 'joshua';
const C = 'someone';

const twoBosses = { member_id: 'kristin', supervisor_ids: [A, B] };
const oneBoss    = { member_id: 'andres',  supervisor_ids: [A] };
const noBoss     = { member_id: 'olivia',  supervisor_ids: [] };
const legacy     = { member_id: 'jesse',   supervisor_id: A }; // pre-073 row, no array

test('reportsTo is true for EACH supervisor in the list', () => {
  assert.equal(U.reportsTo(twoBosses, A), true);
  assert.equal(U.reportsTo(twoBosses, B), true);
});

test('reportsTo is false for someone not in the list', () => {
  assert.equal(U.reportsTo(twoBosses, C), false);
  assert.equal(U.reportsTo(oneBoss, B), false);
  assert.equal(U.reportsTo(noBoss, A), false);
});

test('reportsTo falls back to the legacy scalar supervisor_id', () => {
  assert.equal(U.reportsTo(legacy, A), true);
  assert.equal(U.reportsTo(legacy, B), false);
});

test('reportsTo guards bad input', () => {
  assert.equal(U.reportsTo(null, A), false);
  assert.equal(U.reportsTo(twoBosses, ''), false);
  assert.equal(U.reportsTo(twoBosses, null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/reports-to.test.mjs`
Expected: FAIL — `U.reportsTo is not a function`.

- [ ] **Step 3: Add the helper**

In `js/utils.js`, immediately after the `isAssignee(task, userId) { ... }` method (closing `},` at line 212), insert:

```js
  /* Does this profile report to `memberId`? A person may report to MULTIPLE
     supervisors (migration 073): supervisor_ids[] holds team_members ids and
     EVERY one of them oversees the person. Rows written before 073 carry only
     the scalar supervisor_id (the primary), so fall back to it. Every "is this
     my report?" seam must ask THIS, never `profile.supervisor_id === id`. */
  reportsTo(profile, memberId) {
    if (!profile || !memberId) return false;
    if (Array.isArray(profile.supervisor_ids)) return profile.supervisor_ids.includes(memberId);
    return profile.supervisor_id === memberId;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/reports-to.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/utils.js tests/unit/reports-to.test.mjs
git commit -F <msg-file>
# feat(reports-to): add App.utils.reportsTo seam for multiple supervisors
```

---

### Task 2: Migration 073 — `supervisor_ids` column, sync trigger, RLS rewrite

Adds the array column, backfills it, keeps the scalar in sync both ways, extends the self-update freeze + self-supervisor guard, and re-issues every RLS policy that gates a supervisor to their reports.

**Files:**
- Create: `supabase/sql/073_multiple_supervisors.sql`
- Create: `supabase/sql/verify/073_check.sql`

**Interfaces:**
- Produces (SQL): `public.reports_to_me(sup_ids text[]) -> boolean` = `current_member_id() = any(sup_ids)`. Consumed only inside RLS policies in this migration.
- Produces (schema): `public.profiles.supervisor_ids text[] NOT NULL DEFAULT '{}'`, kept in sync with the pre-existing scalar `supervisor_id` by a BEFORE INSERT/UPDATE trigger.

Context — the three affected task policies currently embed this subquery (verbatim, appearing in migrations 028/043/046/051 and re-issued by 072):
```sql
exists (
  select 1 from public.profiles p
  where p.member_id = public.tasks.assignee_id
    and p.supervisor_id = public.current_member_id()
)
```
073 replaces that inner `and p.supervisor_id = public.current_member_id()` with `and public.reports_to_me(p.supervisor_ids)`. The read policy also re-includes the `watchers ? public.current_member_id()` clause from migration 051 (072 dropped it when it recreated the policy; re-adding keeps watcher reads working — otherwise applying 072→073 would silently strip watcher access).

- [ ] **Step 1: Write the migration**

Create `supabase/sql/073_multiple_supervisors.sql`:

```sql
-- 073: Multiple "reports to" supervisors.
--
-- Until now profiles.supervisor_id (migration 012) held a SINGLE team_members id:
-- a person reported to exactly one supervisor. The product now needs a person to
-- report to SEVERAL supervisors, where EACH of them sees that person's tasks and
-- time/workload — the same access a single supervisor has today.
--
-- Approach (mirrors the company_ids text[] pattern, migration 042):
--   1. Add profiles.supervisor_ids text[] NOT NULL DEFAULT '{}', backfilled from
--      the scalar supervisor_id.
--   2. Keep supervisor_id as a derived "primary" (= supervisor_ids[1]) via a
--      BEFORE trigger that syncs BOTH directions, so legacy writers (the
--      create-user edge fn, which writes supervisor_id) and legacy readers (the
--      check-in / notify seams) keep working untouched.
--   3. reports_to_me(sup_ids) helper + GIN index.
--   4. Guard: a person can't be their own supervisor (any slot).
--   5. Extend the self-update freeze so a worker can't self-edit supervisor_ids.
--   6. Re-issue the RLS policies that gate a supervisor to their reports, using
--      reports_to_me(p.supervisor_ids) in place of p.supervisor_id = current_member_id().
--
-- SEQUENCING: written against the POST-072 baseline (uses is_shared_bucket, added
-- by 072). Apply 072 first, then 073. Idempotent; transaction-wrapped.
-- RLS is the wall — apply on a DEV COPY and pass verify/073_check.sql BEFORE prod.

begin;

------------------------------------------------------------------------
-- 1. Array column + backfill.
------------------------------------------------------------------------
alter table public.profiles
  add column if not exists supervisor_ids text[];

update public.profiles
  set supervisor_ids = case
    when supervisor_id is null then '{}'::text[]
    else array[supervisor_id]
  end
  where supervisor_ids is null;

alter table public.profiles
  alter column supervisor_ids set default '{}'::text[];
alter table public.profiles
  alter column supervisor_ids set not null;

-- Fast "who reports to member X" lookups (the RLS subquery below).
create index if not exists profiles_supervisor_ids_idx
  on public.profiles using gin (supervisor_ids);

------------------------------------------------------------------------
-- 2. Two-way sync trigger: array is the source of truth, but a legacy write
--    that only sets the scalar (create-user edge fn) is promoted to the array.
------------------------------------------------------------------------
create or replace function public.sync_supervisor_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Legacy insert path that set only the scalar: seed the array from it.
    if (new.supervisor_ids is null or array_length(new.supervisor_ids, 1) is null)
       and new.supervisor_id is not null then
      new.supervisor_ids := array[new.supervisor_id];
    end if;
  elsif new.supervisor_ids is distinct from old.supervisor_ids then
    -- Array changed (the new client path) — array wins.
    null;
  elsif new.supervisor_id is distinct from old.supervisor_id then
    -- Only the scalar changed (legacy path) — promote it to the array.
    new.supervisor_ids := case
      when new.supervisor_id is null then '{}'::text[]
      else array[new.supervisor_id]
    end;
  end if;

  -- Primary scalar is always supervisor_ids[1] (or null when empty).
  new.supervisor_id := case
    when array_length(new.supervisor_ids, 1) >= 1 then new.supervisor_ids[1]
    else null
  end;
  return new;
end;
$$;

drop trigger if exists profiles_sync_supervisor on public.profiles;
create trigger profiles_sync_supervisor
  before insert or update on public.profiles
  for each row execute function public.sync_supervisor_columns();

------------------------------------------------------------------------
-- 3. reports_to_me helper (mirrors current_company_ids() style).
------------------------------------------------------------------------
create or replace function public.reports_to_me(sup_ids text[])
returns boolean
language sql
stable
as $$
  select public.current_member_id() = any(coalesce(sup_ids, '{}'::text[]));
$$;

revoke all on function public.reports_to_me(text[]) from public, anon;
grant execute on function public.reports_to_me(text[]) to authenticated;

------------------------------------------------------------------------
-- 4. A person can't be their own supervisor (any slot).
--    Replaces the scalar-only check from migration 014.
------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_not_self_supervisor;
alter table public.profiles
  add constraint profiles_not_self_supervisor
  check (member_id is null or not (member_id = any(supervisor_ids)));

------------------------------------------------------------------------
-- 5. Self-update freeze: a user edits their own name only, NOT their reporting
--    line. Recreated verbatim from migration 042 with supervisor_ids added.
------------------------------------------------------------------------
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role           = (select p.role           from public.profiles p where p.id = auth.uid())
  and approved       = (select p.approved       from public.profiles p where p.id = auth.uid())
  and supervisor_id  is not distinct from (select p.supervisor_id  from public.profiles p where p.id = auth.uid())
  and supervisor_ids is not distinct from (select p.supervisor_ids from public.profiles p where p.id = auth.uid())
  and company_ids    is not distinct from (select p.company_ids    from public.profiles p where p.id = auth.uid())
  and member_id      is not distinct from (select p.member_id      from public.profiles p where p.id = auth.uid())
  and email          is not distinct from (select p.email          from public.profiles p where p.id = auth.uid())
);

------------------------------------------------------------------------
-- 6. Re-issue the task policies that gate a supervisor to their reports.
--    Bodies are the POST-072 versions (is_shared_bucket), with:
--      - the supervisor subquery switched to reports_to_me(p.supervisor_ids)
--      - the watchers ? current_member_id() clause (migration 051) preserved
--        in the READ policy.
------------------------------------------------------------------------
drop policy if exists "role users can read tasks"   on public.tasks;
create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or watchers ? public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and public.reports_to_me(p.supervisor_ids)
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or watchers ? public.current_member_id()
          or is_shared_bucket
        )
      )
    )
  )
);

drop policy if exists "role users can update tasks" on public.tasks;
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and public.reports_to_me(p.supervisor_ids)
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (assignee_id = public.current_member_id() or is_shared_bucket)
      )
    )
  )
)
with check (
  public.current_profile_role() = 'developer'
  or (
    (company_id = any(public.current_company_ids()) or is_shared_bucket)
    and (
      public.current_profile_role() in ('admin', 'construction_supervisor', 'sales')
      or (
        public.current_profile_role() = 'supervisor'
        and (
          assignee_id = public.current_member_id()
          or creator_id = public.current_member_id()
          or exists (
            select 1 from public.profiles p
            where p.member_id = public.tasks.assignee_id
              and public.reports_to_me(p.supervisor_ids)
          )
        )
      )
      or (
        public.current_profile_role() = 'worker'
        and (
          assignee_id = public.current_member_id()
          or (
            creator_id = public.current_member_id()
            and public.assignee_in_company(assignee_id, company_id)
          )
          or is_shared_bucket
        )
      )
    )
  )
);

commit;

-- Verify: run supabase/sql/verify/073_check.sql on the SAME dev DB after applying.
```

- [ ] **Step 2: Write the verify script**

Create `supabase/sql/verify/073_check.sql`:

```sql
-- Verify 073 on a DEV COPY (apply 072 then 073 first). Every SELECT should
-- return ok = true. Run as the service role / SQL editor.

-- 1. Column exists, NOT NULL, default '{}'.
select 'supervisor_ids column' as check,
       (data_type = 'ARRAY' and is_nullable = 'NO' and column_default like '%{}%') as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'supervisor_ids';

-- 2. Backfill parity: every row that had a scalar has it as supervisor_ids[1],
--    and no row is null.
select 'backfill parity' as check,
       count(*) filter (
         where supervisor_ids is null
            or (supervisor_id is not null and (array_length(supervisor_ids,1) is null or supervisor_ids[1] <> supervisor_id))
       ) = 0 as ok
from public.profiles;

-- 3. Scalar mirror holds: supervisor_id always equals supervisor_ids[1] (or null).
select 'scalar mirror' as check,
       count(*) filter (
         where supervisor_id is distinct from (case when array_length(supervisor_ids,1) >= 1 then supervisor_ids[1] else null end)
       ) = 0 as ok
from public.profiles;

-- 4. Helper exists and is callable.
select 'reports_to_me helper' as check,
       exists (select 1 from pg_proc where proname = 'reports_to_me') as ok;

-- 5. No task policy still gates on the bare scalar supervisor_id.
select 'no scalar supervisor gate left' as check,
       count(*) = 0 as ok
from pg_policies
where schemaname = 'public' and tablename = 'tasks'
  and qual like '%supervisor_id = %current_member_id%';

-- 6. Self-supervisor guard present.
select 'self-supervisor guard' as check,
       exists (
         select 1 from pg_constraint
         where conname = 'profiles_not_self_supervisor'
       ) as ok;
```

- [ ] **Step 3: Commit (do NOT apply)**

```bash
git add supabase/sql/073_multiple_supervisors.sql supabase/sql/verify/073_check.sql
git commit -F <msg-file>
# feat(reports-to): migration 073 — supervisor_ids[] + reports_to_me RLS
```

Note: applying 072 then 073 on a dev branch and running `verify/073_check.sql` is a manual/execution-time step (e.g. via Supabase `create_branch` → `apply_migration` → `execute_sql`). It is NOT part of this commit.

---

### Task 3: Client read seams use `supervisor_ids`

Switch the two direct-report seams and the org chart from the scalar to `App.utils.reportsTo` / the array.

**Files:**
- Modify: `js/controllers/AppController.js:108-109` and `:557-558`
- Modify: `js/views/HierarchyView.js:56-61` (and the header comment at `:6`)

**Interfaces:**
- Consumes: `App.utils.reportsTo(profile, memberId)` from Task 1.

- [ ] **Step 1: Update AppController seam 1 (`getScopedTasks`, ~line 108)**

Replace:
```js
      const reports = new Set((App.PROFILES || [])
        .filter(p => p.supervisor_id === me).map(p => p.member_id));
```
with:
```js
      const reports = new Set((App.PROFILES || [])
        .filter(p => App.utils.reportsTo(p, me)).map(p => p.member_id));
```

- [ ] **Step 2: Update AppController seam 2 (`_reportMemberIds`, ~line 557)**

Replace:
```js
    return (role === 'supervisor' && App.realRole() !== 'developer')
      ? new Set((App.PROFILES || []).filter(p => p.supervisor_id === me).map(p => p.member_id))
      : null;
```
with:
```js
    return (role === 'supervisor' && App.realRole() !== 'developer')
      ? new Set((App.PROFILES || []).filter(p => App.utils.reportsTo(p, me)).map(p => p.member_id))
      : null;
```

- [ ] **Step 3: Update HierarchyView `directReports` + `unassignedPool` (~lines 56-61)**

Replace:
```js
    const directReports = (memberId) => profiles
      .filter(p => p.supervisor_id === memberId)
      .sort((a, b) => this.person(a.member_id).full.localeCompare(this.person(b.member_id).full));
    const unassignedPool = profiles
      .filter(p => !p.supervisor_id && poolRoles.includes(p.role))
      .sort((a, b) => this.person(a.member_id).full.localeCompare(this.person(b.member_id).full));
```
with:
```js
    // A person reporting to N supervisors appears under EACH of them (migration 073).
    const directReports = (memberId) => profiles
      .filter(p => App.utils.reportsTo(p, memberId))
      .sort((a, b) => this.person(a.member_id).full.localeCompare(this.person(b.member_id).full));
    const hasSupervisor = (p) => Array.isArray(p.supervisor_ids) ? p.supervisor_ids.length > 0 : !!p.supervisor_id;
    const unassignedPool = profiles
      .filter(p => !hasSupervisor(p) && poolRoles.includes(p.role))
      .sort((a, b) => this.person(a.member_id).full.localeCompare(this.person(b.member_id).full));
```

- [ ] **Step 4: Update the HierarchyView header comment (line 6)**

Replace:
```js
     - explicit per-user override: profile.supervisor_id (a team_member id)
```
with:
```js
     - explicit per-user override: profile.supervisor_ids (team_member ids; a
       person may report to several supervisors and appears under each)
```

- [ ] **Step 5: Sanity-check nothing else reads the scalar for report-membership**

Run: `npm run test:unit`
Expected: PASS (full suite, incl. Task 1's `reports-to.test.mjs`). This proves the shared seam still behaves; the AppController/HierarchyView edits are wiring to it.

- [ ] **Step 6: Commit**

```bash
git add js/controllers/AppController.js js/views/HierarchyView.js
git commit -F <msg-file>
# feat(reports-to): client report seams + org chart read supervisor_ids
```

---

### Task 4: `SupabaseDataStore` reads & writes `supervisor_ids`

Select the new column and let `updateProfileAccess` persist an array. The scalar `supervisor_id` stays selected too (the sync trigger keeps it accurate; other code still reads it).

**Files:**
- Modify: `js/services/SupabaseDataStore.js:9` (`_profileColumns`) and `:862` (`updateProfileAccess`)

**Interfaces:**
- Produces: `updateProfileAccess(profileId, { role, approved, supervisorIds, companyIds, position })` — `supervisorIds` is a `string[]` of team_members ids written to `profiles.supervisor_ids`. (`supervisorId` scalar support is dropped from this method; the only caller is Task 5's ApprovalView, updated in the same series.)

- [ ] **Step 1: Add `supervisor_ids` to the selected columns (line 9)**

Replace:
```js
    this._profileColumns = 'id, email, full_name, approved, role, email_verified, member_id, supervisor_id, company_ids, avatar_url, position, created_at';
```
with:
```js
    this._profileColumns = 'id, email, full_name, approved, role, email_verified, member_id, supervisor_id, supervisor_ids, company_ids, avatar_url, position, created_at';
```

- [ ] **Step 2: Write `supervisor_ids` in `updateProfileAccess` (line 862)**

Replace:
```js
    // supervisorId / companyIds / position are optional; only set them when provided.
    if ('supervisorId' in updates) patch.supervisor_id = updates.supervisorId || null;
```
with:
```js
    // supervisorIds / companyIds / position are optional; only set them when provided.
    // supervisor_id (the scalar primary) is derived by the DB sync trigger (migration 073).
    if ('supervisorIds' in updates) patch.supervisor_ids = Array.isArray(updates.supervisorIds) ? updates.supervisorIds : [];
```

- [ ] **Step 3: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -F <msg-file>
# feat(reports-to): datastore selects + writes supervisor_ids
```

---

### Task 5: ApprovalView "Reports to" chips + add picker

Turn the single `<select>` in the table's "Reports to" cell into removable chips plus a "+ Add" dropdown (cap 4), and collect the chosen ids into a `supervisorIds` array on save.

**Files:**
- Modify: `js/views/ApprovalView.js` — `renderRow` (the supervisor cell, lines 80-83 + 105) and `bind`'s save handler (line 144, 152)
- Modify: `css/taskmanagement.css` (append a small `.reports-multi` block near the existing `.company-multi` rules)

**Interfaces:**
- Consumes: `this.supervisorOptions(excludeMemberId)` (unchanged) → `[{id, name}]`; `this.dataStore.updateProfileAccess(profileId, { ..., supervisorIds })` from Task 4.

- [ ] **Step 1: Add a chip-picker builder method**

In `js/views/ApprovalView.js`, add this method right after `supervisorOptions(...)` (which closes at line 26):

```js
  // The "Reports to" multi-picker for one profile: removable chips for the
  // already-chosen supervisors + a "+ Add" dropdown of the remaining eligible
  // people. Capped at MAX_SUPERVISORS. Selected ids live in data-sup-ids on the
  // container; the dropdown and chips are re-rendered from it on every change.
  supervisorPickerHtml(profile) {
    const selected = Array.isArray(profile.supervisor_ids)
      ? profile.supervisor_ids
      : (profile.supervisor_id ? [profile.supervisor_id] : []);
    return this.renderSupervisorPicker(this.supervisorOptions(profile.member_id), selected);
  }

  renderSupervisorPicker(options, selected) {
    const MAX = 4;
    const byId = new Map(options.map(o => [o.id, o.name]));
    const chips = selected.map(id => `
      <span class="rep-chip" data-sup="${App.utils.escapeHtml(id)}">
        ${App.utils.escapeHtml(byId.get(id) || id)}
        <button type="button" class="rep-chip-x" data-action="sup-remove" data-sup="${App.utils.escapeHtml(id)}" aria-label="Remove">&times;</button>
      </span>`).join('');
    const remaining = options.filter(o => !selected.includes(o.id));
    const addControl = (selected.length >= MAX || remaining.length === 0)
      ? (selected.length >= MAX ? '<span class="rep-cap">Max 4</span>' : '')
      : `<select class="rep-add" data-action="sup-add">
           <option value="">+ Add…</option>
           ${remaining.map(o => `<option value="${App.utils.escapeHtml(o.id)}">${App.utils.escapeHtml(o.name)}</option>`).join('')}
         </select>`;
    const empty = selected.length ? '' : '<span class="rep-none">— None —</span>';
    return `<div class="reports-multi" data-field="supervisors" data-sup-ids="${App.utils.escapeHtml(JSON.stringify(selected))}">${empty}${chips}${addControl}</div>`;
  }
```

- [ ] **Step 2: Use it in `renderRow` — drop the old `supervisorOpts`**

In `renderRow`, delete the old block (lines 80-83):
```js
    const supervisorOpts = ['<option value="">— None —</option>']
      .concat(this.supervisorOptions(profile.member_id).map(s =>
        `<option value="${s.id}" ${profile.supervisor_id === s.id ? 'selected' : ''}>${App.utils.escapeHtml(s.name)}</option>`
      )).join('');
```
and replace the cell (line 105):
```js
        <td data-label="Reports to"><select data-field="supervisor">${supervisorOpts}</select></td>
```
with:
```js
        <td data-label="Reports to">${this.supervisorPickerHtml(profile)}</td>
```

- [ ] **Step 3: Wire chip add/remove in `bind()`**

In `bind()`, after the `approved`-toggle `forEach` block (ends line 136), add the handler below. It is scoped to the **cell** (`<td>`), not the `.reports-multi` div, because `renderSupervisorPicker` replaces that div via `outerHTML` on every change — the cell survives, so its listeners keep firing on the freshly rendered chips/dropdown (event delegation):

```js
    // "Reports to" multi-picker: add via the dropdown, remove via a chip ×.
    // Scoped to the surviving <td> so listeners persist across re-renders.
    this.wrap.querySelectorAll('td[data-label="Reports to"]').forEach(cell => {
    this.wrap.querySelectorAll('td[data-label="Reports to"]').forEach(cell => {
      const box = () => cell.querySelector('[data-field="supervisors"]');
      const readIds = () => { try { return JSON.parse(box().dataset.supIds || '[]'); } catch { return []; } };
      const rerender = (ids) => {
        const excludeMember = cell.closest('[data-profile-id]')?.dataset.memberId || null;
        box().outerHTML = this.renderSupervisorPicker(this.supervisorOptions(excludeMember), ids);
      };
      cell.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-action="sup-add"]');
        if (!sel || !sel.value) return;
        const ids = readIds();
        if (!ids.includes(sel.value)) ids.push(sel.value);
        rerender(ids);
      });
      cell.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-action="sup-remove"]');
        if (!rm) return;
        rerender(readIds().filter(id => id !== rm.dataset.sup));
      });
    });
```

- [ ] **Step 4: Collect `supervisorIds` in the save handler**

In the `save-access` handler, replace line 144:
```js
        const supervisorId = row.querySelector('[data-field="supervisor"]').value || null;
```
with:
```js
        let supervisorIds = [];
        try { supervisorIds = JSON.parse(row.querySelector('[data-field="supervisors"]').dataset.supIds || '[]'); } catch { supervisorIds = []; }
```
and replace the `updateProfileAccess` call (line 152):
```js
          await this.dataStore.updateProfileAccess(profileId, { role, approved, supervisorId, companyIds, position });
```
with:
```js
          await this.dataStore.updateProfileAccess(profileId, { role, approved, supervisorIds, companyIds, position });
```

- [ ] **Step 5: Add styles**

Append to `css/taskmanagement.css`:

```css
/* People/Approvals "Reports to" multi-picker (migration 073) */
.reports-multi { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.reports-multi .rep-none { color: var(--muted, #8A8577); font-size: 12px; }
.reports-multi .rep-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px 3px 9px; border-radius: 999px;
  background: rgba(237, 78, 15, 0.12); color: var(--ink, #EDE9DF);
  font-size: 12px; line-height: 1; white-space: nowrap;
}
.reports-multi .rep-chip-x {
  border: 0; background: none; cursor: pointer; color: inherit;
  font-size: 15px; line-height: 1; padding: 0 2px; opacity: 0.7;
}
.reports-multi .rep-chip-x:hover { opacity: 1; }
.reports-multi .rep-add { font-size: 12px; padding: 3px 6px; }
.reports-multi .rep-cap { color: var(--muted, #8A8577); font-size: 11px; }
```

- [ ] **Step 6: Verify in the app**

Run the app (People → User approvals). Confirm: a row shows existing supervisor(s) as chips; "+ Add" adds a second chip and disappears at 4; "×" removes a chip; Save persists and the row reloads with the same chips. (This is a manual check — the seam logic is covered by Task 1's unit tests; the DB round-trip needs a dev DB with 073 applied, so if unapplied, verify the payload via the Network tab shows `supervisor_ids: [...]`.)

- [ ] **Step 7: Commit**

```bash
git add js/views/ApprovalView.js css/taskmanagement.css
git commit -F <msg-file>
# feat(reports-to): chips + add multi-picker in the approvals table
```

---

### Task 6: Preview/demo profiles carry `supervisor_ids`

Preview mode (localhost `?role=`/`?member=`) builds mock profiles without Supabase. Give them `supervisor_ids` so the org chart / report seams work there too. Low-risk, small.

**Files:**
- Modify: `js/app.js:49` and `:98`
- Modify: `js/auth-guard.js:37`
- Modify: `js/app.js:84-85` (demo reporting lines)

**Interfaces:**
- Consumes: `App.utils.reportsTo` reads `supervisor_ids`; these seeds make it non-empty in preview.

- [ ] **Step 1: Mirror the array when a preview profile update sets a supervisor (`app.js:49`)**

Replace:
```js
            if ('supervisorId' in updates) p.supervisor_id = updates.supervisorId || null;
```
with:
```js
            if ('supervisorIds' in updates) { p.supervisor_ids = Array.isArray(updates.supervisorIds) ? updates.supervisorIds : []; p.supervisor_id = p.supervisor_ids[0] || null; }
            else if ('supervisorId' in updates) { p.supervisor_id = updates.supervisorId || null; p.supervisor_ids = p.supervisor_id ? [p.supervisor_id] : []; }
```

- [ ] **Step 2: Seed `supervisor_ids` on the mock profile shape (`app.js:98`)**

Replace:
```js
        supervisor_id: cfg.supervisor_id || null,
```
with:
```js
        supervisor_id: cfg.supervisor_id || null,
        supervisor_ids: cfg.supervisor_id ? [cfg.supervisor_id] : [],
```

- [ ] **Step 3: Add `supervisor_ids` to the auth-guard fallback profile (`auth-guard.js:37`)**

Replace:
```js
      supervisor_id: null,
```
with:
```js
      supervisor_id: null,
      supervisor_ids: [],
```

- [ ] **Step 4: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (full suite).

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/auth-guard.js
git commit -F <msg-file>
# feat(reports-to): preview/demo profiles carry supervisor_ids
```

---

## Rollout (post-implementation, manual)

Not part of the coding tasks — do this deliberately, on a dev copy first:

1. Apply migration **072** then **073** on a Supabase dev branch (`create_branch` → `apply_migration`).
2. Run `supabase/sql/verify/073_check.sql` — every `ok` must be `true`.
3. Smoke on the dev branch: a worker reporting to A **and** B — confirm both A and B (as `supervisor` role) load the worker's tasks; confirm the worker cannot self-edit `supervisor_ids`; confirm the org chart lists the worker under both A and B.
4. Only then apply to prod (`qqvmcsvdxhgjooirznrj`) and deploy the client.

## Out of scope (YAGNI)

- The **Add Person** modal keeps its single "Reports to" dropdown — a new account is created with one primary supervisor (the `create-user` edge function writes the scalar; the 073 sync trigger promotes it to the array). Additional supervisors are added afterward from the table. This avoids redeploying the edge function.
- "Notify all my supervisors" on task/check-in events — those seams keep using the scalar primary.
- Multi-parent org-chart layout beyond duplicating the node under each supervisor.
