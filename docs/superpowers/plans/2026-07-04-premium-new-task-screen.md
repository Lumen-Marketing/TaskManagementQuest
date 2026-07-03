# Premium New-Task Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `js/views/NewTaskPageView.js` into the premium "work-order" screen from the `quest-hq-premium-v2.html` prototype (custom pickers, live dark ticket rail, title token parser, readiness gating), wearing the app's real `tokens.css` skin, and wire the backend for true ordered multi-assignee and a persisted per-tenant `QH-####` work-order number.

**Architecture:** Zero-build vanilla-JS SPA; views are `window.App.*` classes loaded via plain `<script>` tags in `app.html` and driven by an EventBus. The New-Task page renders into `#newTaskWrap` on `newtask:changed` and submits through `AppController.createTask()` → `saveNow()` → `_deliver()`. New pure modules (`tokenParser.js`, `WorkOrderRail.js`) are dual-exported so they unit-test under `node --test` without a browser. Backend changes are three additive SQL migrations plus data-layer wiring.

**Tech Stack:** Vanilla ES2019 browser JS (no bundler), Supabase (Postgres + RLS + Edge Functions), `tokens.css` design system, Playwright (e2e) + `node --test` (unit).

## Global Constraints

- **Zero-build.** No bundler, no npm deps for app code. New JS files attach to `window.App` and are loaded as plain `<script>` tags in `app.html`. Every new `js/**` file MUST get a `<script src="...">` line in `app.html` placed **before** `js/app.js` and after its own dependencies.
- **Styling = `tokens.css` only.** No hardcoded hex/font literals anywhere. Use `--font-display|-body|-mono`, `--bg|-surface|-border|-ink|-ink-2|-ink-3`, `--amber|-green|-rust|-blue`, `--u-critical|-urgent|-high|-medium|-low`, `--shadow-*`, `--radius-*`, `--space-*`, `--ease-*`, `--dur-*`. Screen must render correctly under both `[data-theme="light"]` and `[data-theme="dark"]`. Reduced-motion is already globally honored by `tokens.css` — do not re-implement it, just don't fight it.
- **Field ids stay `nt-*`** where `App.validate.newTask`'s field→input error map references them (`nt-title`, `nt-company`, `nt-type`, `nt-status`, `nt-label`, `nt-priority`, `nt-due`, `nt-time`). Custom pickers keep a hidden/attribute source of truth but reuse these ids for the error-focus path, OR the plan updates `_showFieldError`'s map — see Task 9.
- **Priorities are the app's five:** `critical|urgent|high|medium|low` (`App.PRIORITIES`, `js/constants.js:46`). The prototype's 3-segment Low/Med/High is replaced by the real set. **WhatsApp gate = "high or above"**: armed iff `App.PRIORITIES[p].order <= App.PRIORITIES.high.order` (i.e. high, urgent, critical). This matches the existing checkbox label "WhatsApp ping (urgent only)".
- **Multi-assignee contract:** the app ALWAYS writes `assignee_id = whos[0]` (the lead) alongside the new `assignee_ids` array, so every existing RLS policy, notify path, and query keeps working unchanged.
- **Migrations start at `060`** (tree ends at two colliding `059_*`). **Never auto-apply to PROD** (`qqvmcsvdxhgjooirznrj`). Present SQL, get explicit user approval, then apply and run `get_advisors`.
- **Prototype file is the behavior spec.** `quest-hq-premium-v2.html` (in the handoff doc) contains readable vanilla JS for pickers, calendar, parser, and rail. Where a task says "port from the prototype," lift that markup/logic and apply the adaptations the task enumerates. Where a task shows full code, use it verbatim.
- **Spec:** `docs/superpowers/specs/2026-07-04-premium-new-task-screen-design.md` is the source of truth; this plan implements it.

---

## File structure

| File | Responsibility |
|------|----------------|
| `supabase/sql/060_task_multi_assignee.sql` | **Create.** `tasks.assignee_ids text[]`, backfill, additive `assignees_read_tasks` SELECT policy |
| `supabase/sql/061_wo_number.sql` | **Create.** `wo_counters` table, `assign_wo_number(text)` RPC, `tasks.wo_number int` |
| `supabase/sql/062_task_reminder_offset.sql` | **Create.** `tasks.reminder_offset text` |
| `js/views/newtask/tokenParser.js` | **Create.** Pure `App.parseTaskTitle(text, ctx)`; dual-export for `node --test` |
| `js/views/newtask/WorkOrderRail.js` | **Create.** Pure `App.WorkOrderRail.render/tickKeys`; dual-export |
| `js/views/NewTaskPageView.js` | **Rewrite.** View shell: `S` state, custom pickers, calendar/time, parser wiring, readiness/create |
| `js/validate.js` | **Modify.** `newTask` accepts `whos[]`, returns `assigneeIds` + lead `assignee` |
| `js/controllers/AppController.js` | **Modify.** `createTask` multi-assignee + notify fan-out + wo_number |
| `js/services/SupabaseDataStore.js` | **Modify.** `_taskRow`/`_mapTaskRow`/`_mergeConflict` new fields + `assignWoNumber()` |
| `taskmanagement.css` | **Modify.** Appended `#newTaskWrap.wo-mode …` scoped block |
| `app.html` | **Modify.** `<script>` tags for the two new modules |
| `tests/unit/tokenParser.test.mjs` | **Create.** Parser unit suite |
| `tests/unit/workOrderRail.test.mjs` | **Create.** Rail render suite |
| `tests/unit/validate-newtask.test.mjs` | **Create.** Multi-assignee validation suite |
| `tests/newtask-premium.spec.js` | **Create.** Playwright critical-path |

Build order: backend (T1–T3) → data layer (T4–T6) → pure modules (T7–T8) → view (T9–T12) → CSS + wiring (T13) → e2e (T14). Pure modules and backend are independent and can proceed in parallel; the view depends on all of them.

---

### Task 1: Migration 060 — multi-assignee column + additive read policy

**Files:**
- Create: `supabase/sql/060_task_multi_assignee.sql`
- Reference (read first, do not modify): `supabase/sql/051_watchers_read_tasks.sql`, `supabase/sql/043_workers_read_created_tasks.sql`

**Interfaces:**
- Produces: `tasks.assignee_ids text[]` (not null default `'{}'`), a permissive SELECT policy `assignees_read_tasks`. Consumed by Task 4 (`_taskRow`/`_mapTaskRow`) and Task 6 (notify fan-out).

- [ ] **Step 1: Read the existing watcher-read policy to mirror its member-id expression**

Run: open `supabase/sql/051_watchers_read_tasks.sql`. It grants `SELECT` when the caller's member id appears in the `watchers` array. Note the exact expression it uses to resolve "caller's member id" (e.g. a `current_member_id()` helper or a subquery on `team_members`/`profiles`). Task 1's new policy reuses that **same** expression, checking `assignee_ids` instead of `watchers`.

- [ ] **Step 2: Write the migration**

```sql
-- 060_task_multi_assignee.sql
-- Ordered multi-assignee. assignee_ids[0] is the accountable "lead" and is ALSO
-- mirrored into the existing assignee_id column by the app, so every prior RLS
-- policy / notify path / query keeps working unchanged. This migration only ADDS:
--   (a) the array column, backfilled from the current single assignee, and
--   (b) a NEW permissive SELECT policy so a non-lead assignee can read the task.
-- Postgres RLS combines permissive policies with OR, so existing policies are
-- untouched. Idempotent so it is safe to re-run.

alter table public.tasks
  add column if not exists assignee_ids text[] not null default '{}';

-- Backfill: seed the array from the current single assignee where present.
update public.tasks
  set assignee_ids = array[assignee_id]
  where assignee_id is not null
    and (assignee_ids = '{}' or assignee_ids is null);

-- Additive read grant for non-lead assignees. MIRROR the caller-member-id
-- expression from 051_watchers_read_tasks.sql (see Step 1) — replace the
-- <CALLER_MEMBER_ID_EXPR> placeholder with that exact expression.
drop policy if exists assignees_read_tasks on public.tasks;
create policy assignees_read_tasks on public.tasks
  for select
  using ( <CALLER_MEMBER_ID_EXPR> = any(assignee_ids) );
```

- [ ] **Step 3: Present the SQL to the user and get explicit approval before applying**

Show the file. Do not apply until the user says go. This touches the RLS wall (migrations 040–048 lineage).

- [ ] **Step 4: Apply to PROD and verify**

After approval, apply via the Supabase MCP `apply_migration` against project `qqvmcsvdxhgjooirznrj` (name `task_multi_assignee`). Then verify:

Run (MCP `execute_sql`):
```sql
select column_name, data_type from information_schema.columns
  where table_name='tasks' and column_name='assignee_ids';
select count(*) as seeded from public.tasks
  where assignee_ids <> '{}';
select polname from pg_policies where tablename='tasks' and polname='assignees_read_tasks';
```
Expected: one column row (`ARRAY`), `seeded` = the count of tasks that had an assignee, one policy row.

- [ ] **Step 5: Run advisors**

Run: MCP `get_advisors` (type `security`) on `qqvmcsvdxhgjooirznrj`.
Expected: no new ERROR-level findings referencing `tasks` / `assignees_read_tasks`. Fix any before proceeding.

- [ ] **Step 6: Commit**

```bash
git add supabase/sql/060_task_multi_assignee.sql
git commit -m "feat(db): tasks.assignee_ids + additive assignee read policy (060)"
```

---

### Task 2: Migration 061 — QH work-order number counter + RPC

**Files:**
- Create: `supabase/sql/061_wo_number.sql`

**Interfaces:**
- Produces: `tasks.wo_number int`, function `public.assign_wo_number(company text) returns int`. Consumed by Task 4 (`assignWoNumber`) and Task 6 (createTask).

- [ ] **Step 1: Write the migration**

```sql
-- 061_wo_number.sql
-- Per-company sequential work-order number (QH-####). Assigned atomically at
-- create time via an RPC; the increment is a single upsert statement so
-- concurrent inserts can never collide on the same value. Idempotent.

create table if not exists public.wo_counters (
  company_id text primary key,
  next_val   int not null default 1
);
alter table public.wo_counters enable row level security;

alter table public.tasks
  add column if not exists wo_number int;

-- security definer so any authenticated caller can advance the counter without
-- direct table grants; the atomic upsert returns the value assigned to THIS call.
create or replace function public.assign_wo_number(company text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned int;
begin
  insert into public.wo_counters as c (company_id, next_val)
    values (company, 2)
  on conflict (company_id)
    do update set next_val = c.next_val + 1
    returning (c.next_val - 1) into assigned;
  -- First insert path: returning above sees the pre-existing row only on
  -- conflict; on the initial insert assigned is null, so fall back to 1.
  return coalesce(assigned, 1);
end;
$$;

grant execute on function public.assign_wo_number(text) to authenticated;
```

- [ ] **Step 2: Present the SQL and get approval** (same gate as Task 1 Step 3).

- [ ] **Step 3: Apply to PROD and verify the counter is atomic + sequential**

Apply via MCP `apply_migration` (name `wo_number`). Then:

Run (MCP `execute_sql`):
```sql
select public.assign_wo_number('roofing') as a;   -- expect 1
select public.assign_wo_number('roofing') as b;   -- expect 2
select public.assign_wo_number('drafting') as c;  -- expect 1 (per-company)
select company_id, next_val from public.wo_counters order by company_id;
```
Expected: `a=1`, `b=2`, `c=1`; `roofing` next_val=3, `drafting` next_val=2. **Then reset the test rows so live numbering starts clean:**
```sql
delete from public.wo_counters where company_id in ('roofing','drafting');
```
(Only if no real tasks were numbered yet — this is a fresh column.)

- [ ] **Step 4: Run advisors** (MCP `get_advisors` security). Confirm the `security definer` function raises no unaddressed advisor error (search_path is pinned, which is the usual flag). Commit.

```bash
git add supabase/sql/061_wo_number.sql
git commit -m "feat(db): per-company QH work-order number + assign_wo_number RPC (061)"
```

---

### Task 3: Migration 062 — reminder offset column

**Files:**
- Create: `supabase/sql/062_task_reminder_offset.sql`

**Interfaces:**
- Produces: `tasks.reminder_offset text`. Consumed by Task 4 (`_taskRow`/`_mapTaskRow`).

- [ ] **Step 1: Write the migration**

```sql
-- 062_task_reminder_offset.sql
-- Stores the chosen reminder OFFSET spec ('none'|'at'|'1h'|'1d'|'morn' or
-- 'custom:{n}:{unit}') so a future server-side firing job can recompute fire
-- time. The absolute reminder_at (migration 037) is still written by the client
-- for now; server-side firing stays deferred. Idempotent.
alter table public.tasks
  add column if not exists reminder_offset text;
```

- [ ] **Step 2: Present, approve, apply** (MCP `apply_migration`, name `task_reminder_offset`). Verify the column exists:

Run (MCP `execute_sql`):
```sql
select column_name from information_schema.columns
  where table_name='tasks' and column_name='reminder_offset';
```
Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/062_task_reminder_offset.sql
git commit -m "feat(db): tasks.reminder_offset for future server-side reminders (062)"
```

---

### Task 4: Data layer — map/write new columns + wo_number RPC method

**Files:**
- Modify: `js/services/SupabaseDataStore.js:344-375` (`_taskRow`), `:732-759` (`_mapTaskRow`), `:317-321` (`_mergeConflict` EDITABLE), add a new method near `createProject` (`:379`)

**Interfaces:**
- Consumes: columns from Tasks 1–3.
- Produces: `assignWoNumber(company) → Promise<int|null>`; camel fields `task.assigneeIds`, `task.woNumber`, `task.reminderOffset` on mapped tasks; row fields `assignee_ids`, `wo_number`, `reminder_offset` on save. Consumed by Task 6.

- [ ] **Step 1: Extend `_taskRow` to write the new columns**

In `_taskRow` (`:344`), add these fields to the returned row object (place `assignee_ids` right after `assignee_id`, the others near their existing siblings):

```javascript
      assignee_id: task.assignee,
      assignee_ids: Array.isArray(task.assigneeIds) && task.assigneeIds.length
        ? task.assigneeIds
        : (task.assignee ? [task.assignee] : []),
      // ... existing project_id/due/etc ...
      reminder_at: task.reminderAt || null,
      reminder_offset: task.reminderOffset || null,
      // ... existing priority/status/watchers/subtasks/activity ...
      wo_number: (task.woNumber === null || task.woNumber === undefined) ? null : task.woNumber,
```

- [ ] **Step 2: Extend `_mapTaskRow` to read them back**

In `_mapTaskRow` (`:732`), add after `assignee: row.assignee_id,`:

```javascript
      assignee: row.assignee_id,
      assigneeIds: Array.isArray(row.assignee_ids) && row.assignee_ids.length
        ? row.assignee_ids
        : (row.assignee_id ? [row.assignee_id] : []),
```
and near `reminderAt`:
```javascript
      reminderAt: row.reminder_at || null,
      reminderOffset: row.reminder_offset || null,
```
and near `focusSeq`:
```javascript
      woNumber: (row.wo_number === null || row.wo_number === undefined) ? null : Number(row.wo_number),
```

- [ ] **Step 3: Add the new fields to the conflict-merge editable list**

In `_mergeConflict` `EDITABLE` (`:317`), add `'assigneeIds', 'reminderOffset', 'woNumber'` to the array (woNumber is server-assigned once but harmless to preserve locally):

```javascript
    const EDITABLE = [
      'title', 'description', 'type', 'label', 'company', 'creator',
      'assignee', 'assigneeIds', 'project', 'due', 'dueTime', 'reminderAt', 'reminderOffset',
      'priority', 'status', 'watchers', 'subtasks', 'activity',
      'clearedAt', 'completedAt', 'focusSeq', 'woNumber',
    ];
```

- [ ] **Step 4: Add the `assignWoNumber` RPC method**

Add this method to the class (e.g. right after `createProject`, `:383`):

```javascript
  /* Atomically claim the next per-company work-order number (migration 061).
     Returns the assigned int, or null offline / on error (caller leaves the
     task unnumbered; it can be backfilled later). */
  async assignWoNumber(company) {
    if (!company) return null;
    try {
      const res = await this.supabase.rpc('assign_wo_number', { company });
      if (res.error) { console.warn('[wo] assign_wo_number failed', res.error); return null; }
      return typeof res.data === 'number' ? res.data : null;
    } catch (err) {
      console.warn('[wo] assign_wo_number threw', err);
      return null;
    }
  }
```

- [ ] **Step 5: Verify no syntax errors**

Run: `node --check js/services/SupabaseDataStore.js`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -m "feat(datastore): persist assignee_ids/wo_number/reminder_offset + assignWoNumber RPC"
```

---

### Task 5: `validate.newTask` — multi-assignee

**Files:**
- Modify: `js/validate.js:103-140` (`newTask`)
- Create: `tests/unit/validate-newtask.test.mjs`

**Interfaces:**
- Consumes: `payload.whos` (array of member ids, ordered) with legacy `payload.assignee` still accepted.
- Produces: frozen object now including `assignee` (= lead = `whos[0]`) and `assigneeIds` (deduped, order-preserving). Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/validate-newtask.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal browser-global stubs so validate.js's IIFE can load under node.
global.window = global.window || {};
global.App = global.window.App = {
  errors: { ValidationError: class ValidationError extends Error {
    constructor(msg, opts = {}) { super(msg); this.field = opts.field; } } },
  PEOPLE: { abraham: { name: 'Abraham' }, alkeith: { name: 'Alkeith' }, andres: { name: 'Andres' } },
  TASK_TYPES: { admin: {}, bid: {} },
  TASK_LABELS: { none: {}, roof: {} },
  COMPANIES: { roofing: {}, drafting: {} },
  PRIORITIES: { high: {}, medium: {}, low: {} },
  STATUSES: { todo: {}, done: {} },
};
require('../../js/validate.js');
const { newTask } = global.App.validate;

const base = { title: 'Fix roof', company: 'roofing', due: '2026-07-05' };

test('whos[] maps to ordered assignee_ids with lead first', () => {
  const r = newTask({ ...base, whos: ['alkeith', 'andres'] });
  assert.deepEqual(r.assigneeIds, ['alkeith', 'andres']);
  assert.equal(r.assignee, 'alkeith'); // lead = index 0
});

test('legacy single assignee still works', () => {
  const r = newTask({ ...base, assignee: 'abraham' });
  assert.deepEqual(r.assigneeIds, ['abraham']);
  assert.equal(r.assignee, 'abraham');
});

test('duplicate assignees are deduped, order preserved', () => {
  const r = newTask({ ...base, whos: ['andres', 'alkeith', 'andres'] });
  assert.deepEqual(r.assigneeIds, ['andres', 'alkeith']);
});

test('empty whos throws on the assignee field', () => {
  assert.throws(() => newTask({ ...base, whos: [] }), (e) => e.field === 'assignee');
});

test('unknown assignee throws', () => {
  assert.throws(() => newTask({ ...base, whos: ['ghost'] }), (e) => e.field === 'assignee');
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test tests/unit/validate-newtask.test.mjs`
Expected: FAIL (current `newTask` ignores `whos`, returns no `assigneeIds`).

- [ ] **Step 3: Implement multi-assignee in `newTask`**

Replace the single-assignee block (`js/validate.js:114-115`) with whos-aware logic:

```javascript
    // Assignees: prefer the ordered multi-assignee array (whos); fall back to the
    // legacy single `assignee`. Lead = index 0. Dedupe, preserve order, validate each.
    const rawWhos = Array.isArray(payload.whos) && payload.whos.length
      ? payload.whos
      : (payload.assignee ? [payload.assignee] : []);
    const assigneeIds = [];
    for (const w of rawWhos) {
      const id = String(w == null ? '' : w).trim();
      if (!id) continue;
      if (!(App.PEOPLE || {})[id]) throw new ValidationError(`Unknown assignee: ${id}`, { field: 'assignee' });
      if (!assigneeIds.includes(id)) assigneeIds.push(id);
    }
    if (!assigneeIds.length) throw new ValidationError('Assign at least one person.', { field: 'assignee' });
    const assignee = assigneeIds[0];
```

Then in the returned frozen object (`:136`), add `assigneeIds` and keep `assignee`:

```javascript
    return Object.freeze({
      title, description, type, label, company, priority, status,
      assignee, assigneeIds, watchers: watchers.slice(), subtasks, due, dueTime,
    });
```

(Delete the now-removed old `assignee` lines at `:114-115`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/unit/validate-newtask.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add js/validate.js tests/unit/validate-newtask.test.mjs
git commit -m "feat(validate): multi-assignee whos[] -> assigneeIds + lead"
```

---

### Task 6: `AppController.createTask` — multi-assignee task + notify fan-out + wo_number

**Files:**
- Modify: `js/controllers/AppController.js:1841-1974` (`createTask`)

**Interfaces:**
- Consumes: `payload.whos`/`assignee`/`assigneeIds` (from validated payload), `payload.reminderOffset`, `this.dataStore.assignWoNumber` (Task 4).
- Produces: a task with `assigneeIds`, `assignee` (lead), `woNumber`, `reminderOffset`; in-app + email notifications to ALL assignees + watchers.

- [ ] **Step 1: Assign the work-order number before building the task**

At the top of `createTask` (after the `App.can` guard, before `const task = {`), add:

```javascript
    const assigneeIds = Array.isArray(payload.assigneeIds) && payload.assigneeIds.length
      ? payload.assigneeIds
      : (payload.assignee ? [payload.assignee] : []);
    const lead = assigneeIds[0] || payload.assignee;
    const woNumber = this.dataStore && this.dataStore.assignWoNumber
      ? await this.dataStore.assignWoNumber(payload.company)
      : null;
```

- [ ] **Step 2: Put the new fields on the task object**

In the `const task = {` literal (`:1848`), set:

```javascript
      assignee: lead,
      assigneeIds,
      woNumber,
      reminderOffset: payload.reminderOffset || null,
```
(Replace the existing `assignee: payload.assignee,` line; add the other three.)

- [ ] **Step 3: Fan out in-app + email to every assignee (not just the lead)**

Replace the single-assignee notify block (`:1880-1915`) with a loop over `assigneeIds`. The lead's activity string and the delegation toast still key off the lead; every non-creator assignee gets an in-app + email:

```javascript
    const creatorName = this.getUserName(this.currentUser);
    const creatorEmail = App.PEOPLE[this.currentUser] ? App.PEOPLE[this.currentUser].email : '';
    const leadPerson = App.PEOPLE[lead];
    const leadName = leadPerson ? leadPerson.name : lead;
    const leadEmail = leadPerson ? leadPerson.email : '';
    const titleEsc = App.utils.escapeHtml(task.title);
    const delegated = assigneeIds.some(id => id !== this.currentUser);

    const inapp = [];
    const emails = [];
    if (creatorEmail) emails.push(creatorEmail);

    assigneeIds.forEach(id => {
      if (id === this.currentUser) return; // never notify yourself about your own create
      if (payload.notify.inapp) {
        inapp.push({
          memberId: id,
          taskId: task.id,
          meta: 'Task assigned',
          html: `<strong>${App.utils.escapeHtml(creatorName)}</strong> assigned <em>${titleEsc}</em> to you`,
        });
      }
      if (App.PEOPLE[id] && App.PEOPLE[id].email) emails.push(App.PEOPLE[id].email);
    });

    (payload.watchers || []).forEach(w => {
      if (payload.notify.watchers) {
        inapp.push({
          memberId: w, taskId: task.id, meta: 'Watching',
          html: `You're now watching <em>${titleEsc}</em> (assigned to ${App.utils.escapeHtml(leadName)})`,
        });
      }
      if (App.PEOPLE[w] && App.PEOPLE[w].email) emails.push(App.PEOPLE[w].email);
    });
```

- [ ] **Step 4: Update the success toast to name all assignees**

In the `if (saved)` block (`:1930`), replace the delegated/undelegated toast title with a joined-names summary:

```javascript
      const names = assigneeIds.map(id => (App.PEOPLE[id] ? App.PEOPLE[id].name : id)).join(' + ');
      this.toastView.show({
        title: delegated ? `Task assigned to ${names}` : 'Task created',
        sub: (delegated && leadEmail) ? `Notifying ${names}` : 'Tap View to open it',
        action: viewAction,
      });
```
(Keep the `viewAction` definition above it and the `whatsapp` queued toast below it unchanged. Also update the email `_emailBody` intro that references `assigneeName` to use `leadName`/`names`.)

- [ ] **Step 5: Fix the activity line to reference the lead**

In the `activity` array (`:1867-1876`), the `what` string uses `payload.assignee`; change it to `lead`:

```javascript
        what: payload.activityWhat || (lead === this.currentUser
          ? 'created this task'
          : `assigned this to ${App.PEOPLE[lead] ? App.PEOPLE[lead].name : lead}`),
```

- [ ] **Step 6: Verify syntax**

Run: `node --check js/controllers/AppController.js`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add js/controllers/AppController.js
git commit -m "feat(controller): createTask multi-assignee + notify fan-out + wo_number"
```

---

### Task 7: `tokenParser.js` — pure title token parser (TDD)

**Files:**
- Create: `js/views/newtask/tokenParser.js`
- Create: `tests/unit/tokenParser.test.mjs`
- Modify: `app.html` (add `<script>` tag)

**Interfaces:**
- Produces: `App.parseTaskTitle(text, ctx)` where `ctx = { team:[{id,name}], companies:[{id,label}], atEnd:boolean }`, returning `{ cleanTitle, patches:{ addWhos:[id], company, pri, date, time }, hits:[{kind,label}] }`. `date` is `'YYYY-MM-DD'` computed from `ctx.today` (`'YYYY-MM-DD'`, injected so tests are deterministic); `time` is 24h `'HH:MM'`. Consumed by Task 11.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/tokenParser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseTaskTitle } = require('../../js/views/newtask/tokenParser.js');

const TEAM = [
  { id: 'abraham', name: 'Abraham' }, { id: 'alkeith', name: 'Alkeith' },
  { id: 'andres', name: 'Andres' }, { id: 'sean', name: 'Sean' },
];
const COMPANIES = [{ id: 'roofing', label: 'Quest Roofing' }, { id: 'drafting', label: 'Quest Drafting' }];
const ctx = (over = {}) => ({ team: TEAM, companies: COMPANIES, today: '2026-07-04', atEnd: false, ...over });

test('unambiguous @alkeith followed by space adds to whos and strips token', () => {
  const r = parseTaskTitle('Fix roof @alkeith ', ctx());
  assert.deepEqual(r.patches.addWhos, ['alkeith']);
  assert.equal(r.cleanTitle, 'Fix roof');
});

test('ambiguous @a does nothing (Abraham/Alkeith/Andres)', () => {
  const r = parseTaskTitle('Job @a ', ctx());
  assert.deepEqual(r.patches.addWhos || [], []);
  assert.equal(r.cleanTitle.includes('@a'), true);
});

test('token only resolves when followed by whitespace, unless atEnd', () => {
  assert.equal(parseTaskTitle('Job @alkeith', ctx()).patches.addWhos, undefined);        // still typing
  assert.deepEqual(parseTaskTitle('Job @alkeith', ctx({ atEnd: true })).patches.addWhos, ['alkeith']); // blur/create
});

test('!high sets priority high; first letter decides', () => {
  assert.equal(parseTaskTitle('Roof !high ', ctx()).patches.pri, 'high');
  assert.equal(parseTaskTitle('Roof !med ', ctx()).patches.pri, 'medium');
  assert.equal(parseTaskTitle('Roof !l ', ctx()).patches.pri, 'low');
});

test('date words map to today-relative ISO', () => {
  assert.equal(parseTaskTitle('Ship tmrw ', ctx()).patches.date, '2026-07-05');
  assert.equal(parseTaskTitle('Ship today ', ctx()).patches.date, '2026-07-04');
});

test('time token 9:30a -> 09:30, 2p -> 14:00', () => {
  assert.equal(parseTaskTitle('Call 9:30a ', ctx()).patches.time, '09:30');
  assert.equal(parseTaskTitle('Call 2p ', ctx()).patches.time, '14:00');
});

test('combined: tmrw 9:30a !high @alkeith #drafting', () => {
  const r = parseTaskTitle('Reroof tmrw 9:30a !high @alkeith #drafting ', ctx());
  assert.equal(r.patches.date, '2026-07-05');
  assert.equal(r.patches.time, '09:30');
  assert.equal(r.patches.pri, 'high');
  assert.deepEqual(r.patches.addWhos, ['alkeith']);
  assert.equal(r.patches.company, 'drafting');
  assert.equal(r.cleanTitle, 'Reroof');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/unit/tokenParser.test.mjs`
Expected: FAIL ("Cannot find module tokenParser.js").

- [ ] **Step 3: Implement the parser**

```javascript
// js/views/newtask/tokenParser.js
// Pure title token parser for the New-Task screen. No DOM, no App globals — the
// caller injects team/companies/today so it is deterministic and unit-testable.
(function (root) {
  var PRI = { c: 'critical', u: 'urgent', h: 'high', m: 'medium', l: 'low' };
  var DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  function iso(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function addDays(todayIso, n) {
    var p = todayIso.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function nextDow(todayIso, dow) {
    var p = todayIso.split('-');
    var cur = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    var delta = (dow - cur + 7) % 7; if (delta === 0) delta = 7; // strictly next
    return addDays(todayIso, delta);
  }
  // Exactly one match across id + display name (prefix, case-insensitive). Else null.
  function uniquePrefix(list, frag, keyName) {
    var f = frag.toLowerCase();
    var hits = list.filter(function (x) {
      return x.id.toLowerCase().indexOf(f) === 0 || String(x[keyName]).toLowerCase().indexOf(f) === 0;
    });
    return hits.length === 1 ? hits[0] : null;
  }

  function parseTaskTitle(text, ctx) {
    ctx = ctx || {};
    var team = ctx.team || [], companies = ctx.companies || [], today = ctx.today, atEnd = !!ctx.atEnd;
    var patches = {}, hits = [], addWhos = [];
    // Walk tokens. A token resolves only when a trailing boundary follows it:
    // whitespace anywhere, or end-of-string when atEnd. We rebuild the title
    // from the survivors so resolved tokens are removed.
    // Split on spaces but keep track of whether each token had a trailing space.
    var out = [];
    var re = /(\S+)(\s+|$)/g, m;
    while ((m = re.exec(text)) !== null) {
      var tok = m[1], trailing = m[2];
      var boundary = /\s/.test(trailing) || (trailing === '' && atEnd);
      var resolved = false;
      if (boundary) {
        resolved = tryToken(tok);
      }
      if (!resolved) out.push(tok + (trailing || ''));
    }
    function tryToken(tok) {
      var c0 = tok[0], rest = tok.slice(1);
      if (c0 === '@' && rest) {
        var p = uniquePrefix(team, rest, 'name');
        if (p && addWhos.indexOf(p.id) === -1) { addWhos.push(p.id); hits.push({ kind: 'assignee', label: p.name }); return true; }
        return false;
      }
      if (c0 === '#' && rest) {
        var co = uniquePrefix(companies, rest, 'label');
        if (co) { patches.company = co.id; hits.push({ kind: 'company', label: co.label }); return true; }
        return false;
      }
      if (c0 === '!' && rest) {
        var pk = PRI[rest[0].toLowerCase()];
        if (pk) { patches.pri = pk; hits.push({ kind: 'pri', label: pk }); return true; }
        return false;
      }
      var low = tok.toLowerCase();
      if (low === 'tmrw' || low === 'tomorrow') { patches.date = addDays(today, 1); hits.push({ kind: 'date', label: 'tomorrow' }); return true; }
      if (low === 'today') { patches.date = today; hits.push({ kind: 'date', label: 'today' }); return true; }
      var dm = low.match(/^(sun|mon|tue|wed|thu|fri|sat)(day|nesday|rsday|urday)?$/);
      if (dm && DOW[dm[1]] !== undefined) { patches.date = nextDow(today, DOW[dm[1]]); hits.push({ kind: 'date', label: dm[1] }); return true; }
      var tm = low.match(/^(\d{1,2})(:(\d{2}))?(a|am|p|pm)$/);
      if (tm) {
        var h = parseInt(tm[1], 10), min = tm[3] ? parseInt(tm[3], 10) : 0, ap = tm[4][0];
        if (h >= 1 && h <= 12 && min <= 59) {
          if (ap === 'p' && h !== 12) h += 12;
          if (ap === 'a' && h === 12) h = 0;
          patches.time = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
          hits.push({ kind: 'time', label: patches.time }); return true;
        }
      }
      return false;
    }
    if (addWhos.length) patches.addWhos = addWhos;
    var cleanTitle = out.join('').replace(/\s+/g, ' ').trim();
    return { cleanTitle: cleanTitle, patches: patches, hits: hits };
  }

  var api = { parseTaskTitle: parseTaskTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.App = root.App || {};
  root.App.parseTaskTitle = parseTaskTitle;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/unit/tokenParser.test.mjs`
Expected: PASS (7/7).

- [ ] **Step 5: Register the script in `app.html`**

Add before `js/app.js` (and before `js/views/NewTaskPageView.js`):
```html
<script src="js/views/newtask/tokenParser.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/newtask/tokenParser.js tests/unit/tokenParser.test.mjs app.html
git commit -m "feat(newtask): pure title token parser + unit suite"
```

---

### Task 8: `WorkOrderRail.js` — live ticket render (TDD-lite)

**Files:**
- Create: `js/views/newtask/WorkOrderRail.js`
- Create: `tests/unit/workOrderRail.test.mjs`
- Modify: `app.html`

**Interfaces:**
- Produces: `App.WorkOrderRail.render(model) → htmlString` and `App.WorkOrderRail.tickKeys` (the set of `data-k` line keys). `model` is a plain object the view builds each `sync()`: `{ woNumber, title, company:{label,color}, assignees:[{name,color,init}], priority:{key,label}, due, time, reminderText, label, project, subtaskCount, watchers:[name], channels:{email,inapp,watchers,wa}, ready:{title,who,due}, dispatched:bool }`. Consumed by Task 9/12.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/workOrderRail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { render } = require('../../js/views/newtask/WorkOrderRail.js');

const base = () => ({
  woNumber: null, title: '', company: { label: 'Quest Roofing', color: '#ED4E0D' },
  assignees: [], priority: { key: 'medium', label: 'Medium' }, due: '', time: '',
  reminderText: 'AT DUE TIME', label: null, project: null, subtaskCount: 0,
  watchers: [], channels: { email: true, inapp: true, watchers: false, wa: false },
  ready: { title: false, who: false, due: false }, dispatched: false,
});

test('empty state shows placeholder title and no ready ticks', () => {
  const html = render(base());
  assert.match(html, /Untitled task/);
  assert.doesNotMatch(html, /wo-number-QH/); // no number yet
});

test('renders assignees, priority, and QH number when present', () => {
  const html = render({ ...base(), woNumber: 42, title: 'Reroof',
    assignees: [{ name: 'Alkeith', init: 'AL', color: '#0E7C86' }, { name: 'Andres', init: 'AN', color: '#5B6472' }],
    priority: { key: 'high', label: 'High' }, ready: { title: true, who: true, due: true } });
  assert.match(html, /QH-0042/);
  assert.match(html, /Alkeith/);
  assert.match(html, /Andres/);
  assert.match(html, /HIGH/i);
});

test('dispatched adds the DISPATCHED stamp marker', () => {
  assert.match(render({ ...base(), dispatched: true }), /DISPATCHED/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/unit/workOrderRail.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the rail**

Port the ticket markup from the prototype's `.wo` block and `sync()` line-setting logic. Full module (dual-export, escapes text, zero-pads the number, uses `data-k` line keys for the tick animation):

```javascript
// js/views/newtask/WorkOrderRail.js
// Pure render of the dark work-order ticket. No DOM reads; the view passes a
// plain model and swaps innerHTML. Styling is all class-driven (see the
// #newTaskWrap.wo-mode CSS); this only emits structure + text.
(function (root) {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var TICK_KEYS = ['co', 'who', 'pri', 'due', 'rem', 'lab', 'proj', 'sub', 'wat'];

  function qh(n) { return (n === null || n === undefined) ? '—' : 'QH-' + String(n).padStart(4, '0'); }

  function line(k, label, valueHtml, show) {
    return '<div class="wo-line" data-k="' + k + '"' + (show ? '' : ' style="display:none"') +
      '><span class="k">' + label + '</span><span class="v">' + valueHtml + '</span></div>';
  }

  function render(m) {
    m = m || {};
    var a = m.assignees || [];
    var avatars = a.map(function (p) {
      return '<span class="wo-mini" style="--sw:' + esc(p.color) + '">' + esc(p.init) + '</span>';
    }).join('');
    var names = a.map(function (p) { return esc(p.name); }).join(', ');
    var due = m.due ? (m.due + (m.time ? ' · ' + m.time : '')) : '<span class="dim">—</span>';
    var ready = m.ready || {};
    var rline = function (r, label) {
      return '<div class="rline' + (ready[r] ? ' ok' : '') + '" data-r="' + r + '">' +
        '<span class="rdot">' + (ready[r] ? '✓' : '') + '</span>' + label + '</div>';
    };
    var dtag = function (ch, label, on, locked) {
      return '<span class="dtag' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-ch="' + ch + '">' + label + '</span>';
    };
    var ch = m.channels || {};
    var titleEmpty = !m.title;
    return '' +
      '<div class="wo' + (m.dispatched ? ' dispatched' : '') + '">' +
        '<div class="wo-stamp"><span>DISPATCHED</span></div>' +
        '<div class="wo-top"><div class="wo-brand"><div class="wo-mark">Q</div>' +
          '<div><b>Quest HQ</b><small>WORK ORDER</small></div></div>' +
          '<div class="wo-no"><div class="lbl">NO.</div><div class="v">' + qh(m.woNumber) + '</div></div></div>' +
        '<div class="wo-title' + (titleEmpty ? ' empty' : '') + '">' + (titleEmpty ? 'Untitled task' : esc(m.title)) + '</div>' +
        '<hr class="wo-rule">' +
        line('co', 'COMPANY', '<span class="wo-sw" style="--sw:' + esc(m.company && m.company.color) + '"></span>' + esc(m.company && m.company.label), true) +
        line('who', 'ASSIGNED', a.length ? (avatars + names) : '<span class="dim">—</span>', true) +
        line('pri', 'PRIORITY', '<span class="' + (m.priority && m.priority.key === 'high' ? 'hi' : '') + '">' + esc((m.priority && m.priority.label || '').toUpperCase()) + '</span>', true) +
        line('due', 'DUE', due, true) +
        line('rem', 'REMINDER', esc((m.reminderText || '').toUpperCase()), true) +
        line('lab', 'LABEL', esc(m.label || ''), !!m.label) +
        line('proj', 'PROJECT', esc(m.project || ''), !!m.project) +
        line('sub', 'CHECKLIST', (m.subtaskCount || 0) + ' STEPS', (m.subtaskCount || 0) > 0) +
        line('wat', 'WATCHERS', (m.watchers || []).map(esc).join(', ').toUpperCase(), (m.watchers || []).length > 0) +
        '<hr class="wo-rule">' +
        '<div class="wo-dispatch"><div class="dh">DISPATCH VIA</div><div class="dtags">' +
          dtag('email', 'EMAIL', ch.email, false) +
          dtag('inapp', 'IN-APP', ch.inapp, false) +
          dtag('watchers', 'CC WATCHERS', ch.watchers, false) +
          dtag('wa', m.priority && m.priority.key === 'high' ? 'WHATSAPP' : 'WHATSAPP · HIGH ONLY', ch.wa, !(m.priority && m.priority.key === 'high')) +
        '</div></div>' +
        '<div class="wo-ready">' + rline('title', 'Title') + rline('who', 'Assignee') + rline('due', 'Due date') + '</div>' +
      '</div>';
  }

  var api = { render: render, tickKeys: TICK_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.App = root.App || {};
  root.App.WorkOrderRail = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/unit/workOrderRail.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Register in `app.html`** (before `NewTaskPageView.js`):
```html
<script src="js/views/newtask/WorkOrderRail.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/newtask/WorkOrderRail.js tests/unit/workOrderRail.test.mjs app.html
git commit -m "feat(newtask): pure work-order rail render + unit suite"
```

---

### Task 9: NewTaskPageView shell — `S` state + custom pickers

**Files:**
- Rewrite: `js/views/NewTaskPageView.js`

**Interfaces:**
- Consumes: `App.parseTaskTitle`, `App.WorkOrderRail`, `App.taxonomy`, `App.PEOPLE`, `App.COMPANIES`, `App.PRIORITIES`, `App.utils.*`, `controller.createTask/closeNewTaskPage`.
- Produces: the rewritten view class (same constructor `{ controller, currentUser }`, same `render(prefill)`/`teardown()` lifecycle bound to `newtask:changed`). Internal `sync(changedKey)` recomputes derived state, re-renders pickers + calls `App.WorkOrderRail.render`.

This task is large; it establishes the shell and the menu pickers. Calendar/time (T10), parser wiring (T11), and readiness/create (T12) build on it. Keep the constructor + `newtask:changed` binding from the current file (`:11-23`).

- [ ] **Step 1: Establish the state object and two-column layout**

Replace `template()` with the two-column premium layout: left column = boxed title input + parse-flash line + hint line + four `.sec` cards (01 Routing / 02 Schedule / 03 Detail / 04 Watchers); right column = `<div class="rail" id="nt-rail"></div>` (filled by `App.WorkOrderRail.render`); sticky footer with keyboard legend + Cancel + Create. Port the section/card structure from the prototype's `.cols` markup, but:
- Wrap everything in `<div id="nt-root" class="wo-mode">` so the scoped CSS applies.
- Keep the title input id `nt-title`.
- Each picker is a `<button class="nt-pick" id="nt-pick-<field>">` + `<div class="nt-menu" id="nt-menu-<field>">` pair (the prototype's `.pick`/`.menu`).

Initialize state in `render()`:

```javascript
  render(prefill = {}) {
    if (!this.wrap) this.wrap = document.getElementById('newTaskWrap');
    if (!this.wrap) return;
    const { selected: co } = this._companyChoices();
    const company = (prefill && prefill.company) || co;
    const type = (App.taxonomy.activeTypes(company)[0] || { key: 'admin' }).key;
    this.S = {
      company,
      whos: [this.currentUser],
      pri: 'medium',
      type,
      status: App.taxonomy.defaultStatus(company, type),
      label: null,
      project: (prefill && prefill.project) || null,
      remind: 'at', customN: 2, customU: 'hours',
      date: (prefill && prefill.due) || App.utils.todayISO(1),
      time: '',
      channels: { email: true, inapp: true, watchers: false, wa: false },
    };
    this.watchers = [];
    this.subtasks = [];
    this.woNumber = null; // stays a preview '—' until create
    this.wrap.innerHTML = this.template();
    this.bindEvents();
    this.sync();
    setTimeout(() => { const el = document.getElementById('nt-title'); if (el) el.focus(); }, 30);
  }
```

- [ ] **Step 2: Implement the generic picker binder**

Port the prototype's `bindPick(btnId, menuId, itemsFn, onPick, keepOpen)` and `closeMenus()` into methods. Single open at a time; outside-click + Esc close; menu clicks `stopPropagation`; multi-select menus (`keepOpen=true`) re-render in place. Reuse it for Company, Assignee (multi), Type, Status, Label, Project, Reminder, custom-unit. Each `itemsFn` builds `<button class="nt-mitem" data-v="...">` rows from the taxonomy/people, marking the current selection with a ✓.

Menu content sources (mirror the existing view's helpers, now rendering menu rows instead of `<option>`s):
- Company → `this._companyChoices().ids` → `App.COMPANIES[id].label`.
- Type → `App.taxonomy.activeTypes(S.company)`.
- Status → `App.taxonomy.activeStatuses(S.company, S.type)`.
- Label → `App.taxonomy.activeLabels(S.company)` + a "None" head + an inline create row.
- Assignee (multi) → `App.utils.peopleInCompany(S.company, this.currentUser)`; row toggles membership in `S.whos`.
- Project → `App.projects` filtered to `S.company` + inline create row.

- [ ] **Step 3: Implement `sync(changedKey)` — the single source of truth**

`sync()` enforces the invariants and repaints. It:
1. Purges watchers of any assignee: `this.watchers = this.watchers.filter(w => !this.S.whos.includes(w));`
2. If `changedKey === 'type' || changedKey === 'company'`: re-scope status — `const list = App.taxonomy.activeStatuses(this.S.company, this.S.type); if (!list.some(s => s.key === this.S.status)) this.S.status = App.taxonomy.defaultStatus(this.S.company, this.S.type);` (and on company change, first re-scope type if the current type vanished).
3. WhatsApp gate: `const armed = App.PRIORITIES[this.S.pri].order <= App.PRIORITIES.high.order; if (!armed) this.S.channels.wa = false;`
4. Sets the CSS accent var from the company color: `document.getElementById('nt-root').style.setProperty('--accent', this._companyColor(this.S.company));`
5. Rebuilds each picker button's label (stacked avatars for assignees, etc.).
6. Builds the rail model and sets `document.getElementById('nt-rail').innerHTML = App.WorkOrderRail.render(model);`
7. Recomputes readiness + Create disabled (Task 12 finishes this).
8. If `changedKey` is a rail line key, re-add the `.tick` class to that `[data-k]` line for the flash.

`_companyColor(id)` reads the company's taxonomy/token color (fall back to `getComputedStyle(document.documentElement).getPropertyValue('--amber')`).

- [ ] **Step 4: Inline label/project create**

Label menu create row → `App.taxonomy` create path. There is no client taxonomy-insert helper yet; wire the create to the existing admin path if present, else persist through the datastore. **Minimum viable, matching the spec's "tenant-scoped, dedupe case-insensitive":** on create, (a) call the same Supabase insert the `TaskSetupAdminView` uses for a new label (read that view to reuse its method — do not invent a second write path), (b) optimistically add the new key to the in-memory taxonomy so it appears immediately, (c) select it, (d) show the parse-flash confirmation "✓ label created → Name". Project create reuses `App.projectPicker`/`dataStore.createProject` (already used by the current view at `:251`).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the app, open New Task. Confirm: every picker opens/closes, one at a time; company switch re-scopes type/status/label/assignee and re-themes the accent; assignee is multi-select with stacked avatars; the rail mirrors each change. `node --check js/views/NewTaskPageView.js` passes.

- [ ] **Step 6: Commit**

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(newtask): premium view shell + custom taxonomy pickers + live rail"
```

---

### Task 10: Custom calendar + time menus

**Files:**
- Modify: `js/views/NewTaskPageView.js`

**Interfaces:**
- Consumes: `S.date`, `S.time`, `App.timezone()`, `App.utils.todayISO`.
- Produces: `_renderCalendar()`, `_renderTimeMenu()` populating the Due and Time picker menus; selecting updates `S.date`/`S.time` and calls `sync('due')`.

- [ ] **Step 1: Port the calendar menu**

Port the prototype's `.cal-menu` (month header with ‹ › nav, S–S row, day grid, quick chips TODAY/TMRW/MON/FRI). Adaptations:
- "Today" = `App.utils.todayISO(0)` (derives from the real clock/AZ), not the prototype's hardcoded constant. Ring today's cell; the selected `S.date` cell gets the ink pill.
- Quick chips compute from `App.utils.todayISO(0/1)` and next Mon/Fri.
- Selecting a day sets `S.date` and calls `this.sync('due')`, then closes the menu.
- Month nav state (`this._calY`, `this._calM`) initialized from `S.date`.

- [ ] **Step 2: Port the time menu**

Port `.time-menu`: "No time" + 30-min slots 06:00–19:30, 12-hour labels, scroll-to-selection on open. Selecting sets `S.time` (24h `HH:MM`, `''` for No time) and calls `this.sync('due')`.

- [ ] **Step 3: Reminder offset picker + custom unit**

Replace the reminder field with the offset menu: None / At due time / 1 hour before / 1 day before / Morning of (7 AM) / Custom…. Custom reveals a number input (`S.customN`) + unit menu (`S.customU` ∈ minutes|hours|days). Store the choice in `S.remind`. Add `_reminderText()` → the ticket string ("AT DUE TIME", "1 DAY BEFORE", "3 DAYS BEFORE" with singular handling) and `_computeReminderAt()` → absolute `YYYY-MM-DDTHH:MM` from `S.date`+`S.time`+offset (Task 12 uses it in the payload). For 'none' → null; 'morn' → `S.date`T07:00; 'at' → `S.date`T`S.time||'09:00'`; '1h'/'1d'/custom → subtract from due datetime.

- [ ] **Step 4: Manual verification**

`npm run dev`: calendar nav + chips work, today is the real date, selected day pills; time list scrolls to selection and "No time" clears; custom reminder shows N + unit and the ticket prints "3 DAYS BEFORE"/"1 DAY BEFORE". `node --check` passes.

- [ ] **Step 5: Commit**

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(newtask): custom themed calendar, time, and reminder-offset menus"
```

---

### Task 11: Title token parser wiring (flash / glow / tick)

**Files:**
- Modify: `js/views/NewTaskPageView.js`

**Interfaces:**
- Consumes: `App.parseTaskTitle`.
- Produces: `_onTitleInput()` bound to the title field's `input` event; applies patches to `S`, strips resolved tokens from the field, and drives the flash/glow/tick feedback.

- [ ] **Step 1: Build the parser context + apply patches**

```javascript
  _parseCtx(atEnd) {
    return {
      atEnd: !!atEnd,
      today: App.utils.todayISO(0),
      team: App.utils.peopleInCompany(this.S.company, this.currentUser).map(p => ({ id: p.id, name: p.name })),
      companies: this._companyChoices().ids.map(id => ({ id, label: (App.COMPANIES[id] || { label: id }).label })),
    };
  }
  _applyParse(atEnd) {
    const el = document.getElementById('nt-title');
    if (!el) return;
    const r = App.parseTaskTitle(el.value, this._parseCtx(atEnd));
    if (!r.hits.length) return;
    if (r.patches.addWhos) r.patches.addWhos.forEach(id => { if (!this.S.whos.includes(id)) this.S.whos.push(id); });
    if (r.patches.company) this.S.company = r.patches.company;
    if (r.patches.pri) this.S.pri = r.patches.pri;
    if (r.patches.date) this.S.date = r.patches.date;
    if (r.patches.time) this.S.time = r.patches.time;
    el.value = r.cleanTitle + (atEnd ? '' : ' '); // keep a trailing space mid-type
    this._flash('✓ ' + r.hits.map(h => h.kind + ' → ' + h.label).join(' · '));
    this.sync(r.hits[0] ? this._hitToKey(r.hits[0].kind) : undefined);
    r.hits.forEach(h => this._glow(this._hitToPickId(h.kind)));
  }
```

Add `_hitToKey` (assignee→'who', company→'co', pri→'pri', date/time→'due') and `_hitToPickId` (→ the picker button id) and `_flash(msg)` (writes to the parse-flash line, fades after ~1.3s) and `_glow(id)` (adds `.glow` class ~1.3s).

- [ ] **Step 2: Bind it**

In `bindEvents()`: `titleEl.addEventListener('input', () => { this._applyParse(false); this.sync(); });` and resolve end-of-string tokens on blur and at create (`this._applyParse(true)`). Guard against infinite loops: only rewrite `el.value` when `r.hits.length`.

- [ ] **Step 3: Manual verification**

`npm run dev`: type `Reroof tmrw 9:30a !high @alkeith #drafting ` → date/time/priority/assignee/company fill, tokens vanish from the title, flash line shows, controls glow, rail ticks, WhatsApp auto-arms on `!high`. `@a ` does nothing. `node --check` passes.

- [ ] **Step 4: Commit**

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(newtask): wire title token parser with flash/glow/tick feedback"
```

---

### Task 12: Readiness gating, dispatch tags, WhatsApp gate, create + Create-another, keyboard map

**Files:**
- Modify: `js/views/NewTaskPageView.js`

**Interfaces:**
- Consumes: everything above; `controller.createTask`.
- Produces: `submit()` (builds the `whos`-based payload), readiness computation in `sync()`, the DISPATCHED stamp + toast, Create-another reset, and the C/A/P/L/D/⌘↵ keyboard map.

- [ ] **Step 1: Priority segmented control + WhatsApp gate**

Render a segmented control over `App.PRIORITIES` (5 cells: Low/Medium/High/Urgent/Critical). Clicking sets `S.pri` and calls `sync('pri')`. In `sync()`, the dispatch tag rebuild (via the rail model) already locks/arms WhatsApp; also bind clicks on the rail's `.dtag` elements to toggle `S.channels[ch]` (ignore clicks on `wa` when not high-or-above).

- [ ] **Step 2: Readiness + Create-arm**

In `sync()`, finish readiness:
```javascript
    const title = (document.getElementById('nt-title').value || '').trim();
    const ready = { title: !!title, who: this.S.whos.length > 0, due: !!this.S.date };
    const btn = document.getElementById('nt-create');
    if (btn) btn.disabled = !(ready.title && ready.who && ready.due);
```
Pass `ready` into the rail model so the three dots track live. No popup validation.

- [ ] **Step 3: `submit()` — build the whos payload**

```javascript
  submit() {
    const el = document.getElementById('nt-title');
    if (!el) return;
    this._applyParse(true); // resolve end-of-string tokens first
    const title = (document.getElementById('nt-title').value || '').trim();
    const raw = {
      title,
      description: document.getElementById('nt-desc').value,
      whos: this.S.whos.slice(),
      type: this.S.type, label: this.S.label || 'none', company: this.S.company,
      due: this.S.date, dueTime: this.S.time || null,
      priority: this.S.pri, status: this.S.status,
      watchers: this.watchers.slice(), subtasks: this.subtasks.slice(),
    };
    let clean;
    try { clean = App.validate.newTask(raw); }
    catch (err) { this._showFieldError(err); return; }
    const payload = Object.assign({}, clean, {
      project: this.S.project || null,
      reminderAt: this._computeReminderAt(),
      reminderOffset: this.S.remind === 'custom' ? ('custom:' + this.S.customN + ':' + this.S.customU) : this.S.remind,
      notify: { email: this.S.channels.email, inapp: this.S.channels.inapp,
                watchers: this.S.channels.watchers, whatsapp: this.S.channels.wa },
    });
    this._dispatch(payload);
  }
```

`_dispatch(payload)`: stamp the rail (add `dispatched:true` to the model → the CSS stamp animates), then `this.controller.createTask(payload)`. Because `createTask` assigns the real `woNumber` server-side, show it in the toast; then swap the rail footer to Create-another / View. **Do not** immediately `closeNewTaskPage()` (the prototype stays on the stamped ticket) — instead show the after-actions; Create-another calls `this.render({ company: this.S.company })` (company sticky) and refocuses the title; View calls `controller.closeNewTaskPage()` then selects the task (the controller already selects it after create).

- [ ] **Step 4: `_showFieldError` — update the field map**

The custom pickers no longer have `nt-type`/`nt-status` etc. as focusable `<select>`s. Update the map to focus the picker button ids (`nt-pick-type`, `nt-pick-status`, …) and keep `title` → `nt-title`. Use the existing shake (`App.Motion.shake`) + toast.

- [ ] **Step 5: Keyboard map**

Bind on `this.wrap`: `C`→open company menu, `A`→assignee, `P`→cycle priority (low→medium→high→urgent→critical→low), `L`→label, `D`→calendar, `⌘/Ctrl+Enter`→submit, `Esc`→closeMenus (else nothing). Ignore all single-letter keys while focus is in an input/textarea (`if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;` except for the ⌘↵ handler).

- [ ] **Step 6: Manual verification (full QA §11)**

`npm run dev`, walk the entire §11 QA checklist from the spec, in both light and dark theme, and at ≤980px. `node --check` passes.

- [ ] **Step 7: Commit**

```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(newtask): readiness gating, dispatch tags, create/stamp/toast, keyboard map"
```

---

### Task 13: Scoped CSS

**Files:**
- Modify: `taskmanagement.css` (append a new block at end)

**Interfaces:**
- Produces: all `.wo-mode …` styles the view/rail markup references.

- [ ] **Step 1: Port the prototype CSS under the scope, swapping literals for tokens**

Append a block scoped to `#newTaskWrap .wo-mode` (and children). Port the prototype's `<style>` for: `.cols` grid, `.titlebox`/title input, `.sec`/spine/numbered nodes, `.nt-pick`/`.nt-menu`/`.nt-mitem`, segmented priority, `.cal-menu`/`.time-menu`, the `.wo` dark ticket, `.dtag`, `.rline`, the DISPATCHED `.wo-stamp`, footer. **Swap every literal:**
- Fonts → `var(--font-body)` / `var(--font-mono)`.
- Page/cards → `var(--surface)`, `var(--border)`, `var(--shadow-md)`, `var(--radius-md)`, `var(--space-*)`.
- Accent → `var(--accent, var(--amber))` (the view sets `--accent` per company).
- Priority text → `var(--u-high)` etc.
- Green flash/ready → `var(--green)`.
- Motion → `var(--ease-out)` / `var(--dur-*)`.
- **Dark ticket** → use the dark charcoal token values. Since the ticket is dark regardless of app theme, hardcode it to the dark scale by referencing the same oklch values `tokens.css` uses for dark `--bg`/`--surface`/`--ink`, defined as local vars at the top of the `.wo` rule (e.g. `--paper: oklch(18% 0.006 70); --paper-txt: oklch(94% 0.013 85);`). This keeps it on the app's palette without a hex.
- Armed-button pulse + accent threading as in the prototype's v2 block, but `--accent`-based.
- Do NOT re-add a reduced-motion block — `tokens.css` already covers it.

- [ ] **Step 2: Verify both themes + reduced-motion + mobile**

`npm run dev`: toggle `[data-theme]` light/dark — the whole screen (except the intentionally-dark ticket) recolors; enable OS reduce-motion — animations flatten; resize ≤980px — the rail stacks on top, form single column, footer sticky.

- [ ] **Step 3: Commit**

```bash
git add taskmanagement.css
git commit -m "feat(newtask): scoped premium work-order styles on app tokens (light+dark)"
```

---

### Task 14: Playwright critical-path e2e

**Files:**
- Create: `tests/newtask-premium.spec.js`
- Reference: `tests/tasks.spec.js`, `tests/_fixtures.js` (reuse their auth/seed setup)

**Interfaces:**
- Consumes: the whole screen. Runs under `npm run test:local`.

- [ ] **Step 1: Write the spec**

Model it on `tests/tasks.spec.js` (reuse `_fixtures.js` for login/seed). Cover:

```javascript
// tests/newtask-premium.spec.js
const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./_fixtures'); // reuse the existing helper name; adjust to actual export

test.describe('premium new-task screen', () => {
  test('token parse fills fields, readiness arms, create persists multi-assignee + wo_number', async ({ page }) => {
    await gotoApp(page);
    // open New Task (match how tasks.spec.js triggers it — button/route)
    await page.getByRole('button', { name: /new task/i }).first().click();
    const title = page.locator('#nt-title');
    await title.fill('Reroof tmrw 9:30a !high @alkeith ');
    // token stripped from title
    await expect(title).toHaveValue(/^Reroof\s*$/);
    // readiness: create enabled once title + assignee + due present
    const create = page.locator('#nt-create');
    await expect(create).toBeEnabled();
    // WhatsApp armed by !high
    await expect(page.locator('.dtag[data-ch="wa"]')).not.toHaveClass(/locked/);
    await create.click();
    // dispatched stamp + toast
    await expect(page.locator('.wo.dispatched, .wo-stamp')).toBeVisible();
  });

  test('ambiguous @a does not resolve', async ({ page }) => {
    await gotoApp(page);
    await page.getByRole('button', { name: /new task/i }).first().click();
    await page.locator('#nt-title').fill('Job @a ');
    await expect(page.locator('#nt-title')).toHaveValue(/@a/);
  });
});
```

Adjust selectors/trigger to the real DOM once T9–T12 land (open the app and read the actual ids). If the e2e Supabase project isn't wired for writes, assert up to the stamp (UI-level) and leave the row-assertion (`assignee_ids`, `wo_number`) as a documented manual check per the e2e notes.

- [ ] **Step 2: Run it**

Run: `npm run test:local -- tests/newtask-premium.spec.js`
Expected: PASS. If the run needs the local dev server/test Supabase project, follow the setup in `playwright.config.js` / `tests/_fixtures.js`.

- [ ] **Step 3: Commit**

```bash
git add tests/newtask-premium.spec.js
git commit -m "test(newtask): playwright critical-path for the premium new-task screen"
```

---

## Self-Review

**Spec coverage:**
- §4 architecture / file split → Tasks 7, 8, 9 (modules) + file table. ✓
- §5 state + invariants (status-follows-type, watcher exclusivity, WhatsApp gate, readiness) → T9 Step 3, T12 Steps 1–2. ✓
- §6.1 two-tier taxonomy + per-type status + inline create (Label/Project only) → T9 Steps 2, 4. ✓
- §6.2 custom calendar/time, real-clock today → T10. ✓
- §6.3 token parser rules → T7 (pure + tests) + T11 (wiring). ✓
- §6.4 rail → T8. §6.5 dispatch/WhatsApp → T12 Step 1. §6.6 keyboard → T12 Step 5. §6.7 create/Create-another → T12 Step 3. ✓
- §7 styling on tokens, both themes, dark rail → T13. ✓
- §8.1 multi-assignee migration + RLS → T1; §8.2 wo_number → T2; §8.3 reminder_offset → T3; §8.4 notify fan-out → T6; §8.5 payload/_taskRow → T4, T6. ✓
- §9 data flow → T4–T6, T12. §10 testing (parser TDD, e2e, advisors) → T5, T7, T8, T14 + advisor steps in T1/T2. ✓
- §11 QA checklist → T12 Step 6 (manual) + T14 (automated subset). ✓
- §12 risks (additive RLS policy not editing existing, atomic counter, worktree/branch) → T1 (additive policy), T2 (single-statement upsert), Global Constraints. ✓

**Placeholder scan:** The only intentional placeholder is `<CALLER_MEMBER_ID_EXPR>` in T1, which the step explicitly instructs to fill from `051_watchers_read_tasks.sql` (its value can't be known without reading that file at execution). No other TBDs.

**Type consistency:** `assigneeIds` (camel) used consistently across T4/T5/T6; row column `assignee_ids` in T1/T4; `woNumber`↔`wo_number`, `reminderOffset`↔`reminder_offset` consistent. `parseTaskTitle(text, ctx)` signature matches between T7 impl, T7 test, and T11 caller. `App.WorkOrderRail.render(model)` matches T8 impl/test and T9/T12 callers. Priority keys `critical|urgent|high|medium|low` consistent across constants, parser (`PRI` map), gate, and segmented control.

**Note on TDD boundaries:** the pure modules (parser, rail, validate) get real `node --test` cycles. The view, CSS, migrations, and controller wiring are verified by `node --check` + manual walkthroughs + the Playwright e2e, because they bind to the browser DOM / live Supabase and have no cheap unit harness — this is called out per task rather than faked with hollow tests.
