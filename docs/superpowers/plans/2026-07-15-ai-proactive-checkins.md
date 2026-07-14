# AI Proactive Check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled `checkins` edge function that sends AI-written, one-way check-in messages (morning recap, end-of-day recap, weekly-capped stalled-task nudge) to the in-app bell + email, controlled by a boss-only settings page.

**Architecture:** A new cron-driven edge function running under the service-role key (like `due-reminders`), with its own pure `.mjs` helpers for scheduling, stalled-detection, and content shaping. Delivery reuses the `due-reminders` pattern (Resend + `notifications` insert + a `checkin_log` dedupe table). A boss-only admin view writes a single `checkin_settings` row that the cron reads.

**Tech Stack:** Deno edge function (TypeScript), pure ESM `.mjs` modules, `node --test` unit tests, Groq (Llama 3.3 70B) for wording, Resend for email, Supabase Postgres + pg_cron/pg_net, vanilla-JS zero-build SPA client.

## Global Constraints

- **Design reference:** `docs/superpowers/specs/2026-07-15-ai-proactive-checkins-design.md`.
- **Timezone:** HQ = America/Phoenix, fixed UTC-7, no DST. An HQ wall-clock HH:MM is UTC (HH+7):MM. Reuse the `hqMs` math from `supabase/functions/due-reminders/index.ts`.
- **Multi-assignee seam:** "is this task theirs?" MUST use the `assignee_ids` array (migration 060) with fallback to the single `assignee_id`, never `assignee_id ===` alone. Mirror `App.utils.taskAssignees`/`isAssignee`.
- **One-way only:** no reply capture in v1.
- **Ships dark:** all three mode toggles default `false`; nothing sends until the function is deployed, `CHECKINS_SECRET` is set, the cron job exists, and a mode is enabled.
- **Deploy edge functions from repo source** via the Supabase MCP `deploy_edge_function` (files = index.ts + lib/*.mjs), never a hand-pasted single-file bundle.
- **Git:** stage explicit paths only (never `git add -A`/`.` in this checkout). Commit messages via `git commit -F <file>`; end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Migrations:** number sequentially. A concurrent session is using `069_task_label_sops.sql`; **verify the next free number** (`ls supabase/sql`) before creating files — this plan assumes `070`/`071` but bump if taken.
- **Unit tests:** `npm run test:unit` (`node --test "tests/unit/*.test.mjs"`).
- **PROD project id:** `qqvmcsvdxhgjooirznrj`. Reused secrets already set: `GROQ_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`. New secret: `CHECKINS_SECRET`.

---

## File Structure

**Backend (new edge function `checkins`):**
- `supabase/functions/checkins/index.ts` — HTTP handler, secret gate, per-mode orchestration loop, Groq calls, delivery (Resend + `notifications` insert), dedupe claim.
- `supabase/functions/checkins/lib/schedule.mjs` — pure: HQ-time parts, per-mode firing-window test, period-key builders (`dateKey`, `weekKey`).
- `supabase/functions/checkins/lib/stalled.mjs` — pure: stalled-task filter + grouping by person via the multi-assignee seam.
- `supabase/functions/checkins/lib/content.mjs` — pure: prompt/context builders + `shape*`/`fallback*` for the three modes.

**Migrations:**
- `supabase/sql/070_checkin_settings.sql` — config table + admin RLS.
- `supabase/sql/071_checkin_log.sql` — dedupe table + cron scheduling comment.
- (No `notifications` migration — `task_id` is already nullable, confirmed.)

**Client:**
- `js/views/CheckinSettingsView.js` — boss-only settings page (view id `admin:checkins`).
- `js/services/SupabaseDataStore.js` — add `getCheckinSettings()` + `saveCheckinSettings(patch)`.
- `js/constants.js` — add `checkins.manage` capability to `admin` + `developer` roles.
- `js/controllers/AppController.js` — add `admin:checkins` → `checkins.manage` gate.
- `js/views/SidebarView.js` — add the nav entry (gated).
- `js/views/PermissionsAdminView.js` — add `checkins.manage` row to the matrix.
- `js/app.js` — instantiate `App.CheckinSettingsView`.
- `app.html` — script tag for the new view.

**Tests:**
- `tests/unit/checkin-schedule.test.mjs`
- `tests/unit/checkin-stalled.test.mjs`
- `tests/unit/checkin-content.test.mjs`

---

## Task 1: Schedule helpers (pure)

**Files:**
- Create: `supabase/functions/checkins/lib/schedule.mjs`
- Test: `tests/unit/checkin-schedule.test.mjs`

**Interfaces:**
- Produces:
  - `hqParts(nowMs) -> { y, m, d, hour, minute, dateKey }` — HQ (UTC-7) calendar parts; `dateKey` is `YYYY-MM-DD`.
  - `weekKey(dateKey) -> 'YYYY-MM-DD'` — HQ-Monday of that date (UTC math).
  - `firesNow(mode, nowMs) -> boolean` — true when `nowMs` falls in the mode's HQ hour band. `mode ∈ {'morning','eod','stalled'}`; bands: morning 8, eod 16, stalled 9.
  - `MODE_HOUR = { morning: 8, eod: 16, stalled: 9 }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/checkin-schedule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hqParts, weekKey, firesNow, MODE_HOUR } from '../../supabase/functions/checkins/lib/schedule.mjs';

// 2026-07-15 is a Wednesday. 15:00 UTC = 08:00 HQ (UTC-7).
const AUG_MORNING = Date.UTC(2026, 6, 15, 15, 30); // 08:30 HQ
const AUG_EOD = Date.UTC(2026, 6, 15, 23, 5);      // 16:05 HQ
const AUG_NOON = Date.UTC(2026, 6, 15, 19, 0);     // 12:00 HQ

test('hqParts converts UTC to HQ wall clock and date', () => {
  const p = hqParts(AUG_MORNING);
  assert.equal(p.hour, 8);
  assert.equal(p.minute, 30);
  assert.equal(p.dateKey, '2026-07-15');
});

test('hqParts rolls the date back across the UTC-7 midnight boundary', () => {
  // 2026-07-15 03:00 UTC = 2026-07-14 20:00 HQ.
  const p = hqParts(Date.UTC(2026, 6, 15, 3, 0));
  assert.equal(p.dateKey, '2026-07-14');
  assert.equal(p.hour, 20);
});

test('weekKey returns the HQ-Monday of the week', () => {
  // Wed 2026-07-15 -> Monday 2026-07-13.
  assert.equal(weekKey('2026-07-15'), '2026-07-13');
  // Sunday 2026-07-19 -> Monday 2026-07-13 (Sunday belongs to the week that started Mon 13).
  assert.equal(weekKey('2026-07-19'), '2026-07-13');
});

test('firesNow matches each mode to its HQ hour band', () => {
  assert.equal(firesNow('morning', AUG_MORNING), true);
  assert.equal(firesNow('eod', AUG_MORNING), false);
  assert.equal(firesNow('eod', AUG_EOD), true);
  assert.equal(firesNow('morning', AUG_NOON), false);
  assert.equal(MODE_HOUR.stalled, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/checkin-schedule.test.mjs`
Expected: FAIL — cannot find module `schedule.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// supabase/functions/checkins/lib/schedule.mjs
// Pure HQ-time scheduling helpers for the checkins engine. HQ = America/Phoenix,
// fixed UTC-7 (no DST): HQ wall-clock = UTC shifted back 7 hours. No I/O.

export const MODE_HOUR = { morning: 8, eod: 16, stalled: 9 };

// UTC instant -> HQ calendar parts. Subtract 7h, then read UTC fields.
export function hqParts(nowMs) {
  const d = new Date(nowMs - 7 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { y, m, d: day, hour: d.getUTCHours(), minute: d.getUTCMinutes(),
    dateKey: `${y}-${pad(m)}-${pad(day)}` };
}

// HQ-Monday of the week containing dateKey (YYYY-MM-DD), via UTC math.
export function weekKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay();             // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;  // shift back to Monday
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

export function firesNow(mode, nowMs) {
  const hour = MODE_HOUR[mode];
  if (hour == null) return false;
  return hqParts(nowMs).hour === hour;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/checkin-schedule.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkins/lib/schedule.mjs tests/unit/checkin-schedule.test.mjs
git commit -F <msg-file>   # "feat(checkins): pure HQ-time schedule helpers"
```

---

## Task 2: Stalled-task detection (pure)

**Files:**
- Create: `supabase/functions/checkins/lib/stalled.mjs`
- Test: `tests/unit/checkin-stalled.test.mjs`

**Interfaces:**
- Consumes: task rows shaped `{ id, title, status, updated_at, assignee_id, assignee_ids }`.
- Produces:
  - `taskAssignees(task) -> string[]` — `assignee_ids` if non-empty, else `[assignee_id]`, else `[]`.
  - `stalledByPerson(tasks, { nowMs, stalledDays }) -> Map<personId, Array<{id,title}>>` — open tasks (`status !== 'done'`) whose `updated_at` is older than `stalledDays`, grouped by every assignee (lead + co-assignees).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/checkin-stalled.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskAssignees, stalledByPerson } from '../../supabase/functions/checkins/lib/stalled.mjs';

const NOW = Date.UTC(2026, 6, 15, 18, 0);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

test('taskAssignees prefers assignee_ids, falls back to the single lead', () => {
  assert.deepEqual(taskAssignees({ assignee_id: 'abe', assignee_ids: ['abe', 'shan'] }), ['abe', 'shan']);
  assert.deepEqual(taskAssignees({ assignee_id: 'abe', assignee_ids: [] }), ['abe']);
  assert.deepEqual(taskAssignees({ assignee_id: null, assignee_ids: null }), []);
});

test('stalledByPerson groups open, old tasks by every assignee', () => {
  const tasks = [
    { id: 't1', title: 'Old shared', status: 'todo', updated_at: daysAgo(5), assignee_id: 'abe', assignee_ids: ['abe', 'shan'] },
    { id: 't2', title: 'Fresh',      status: 'todo', updated_at: daysAgo(1), assignee_id: 'abe', assignee_ids: ['abe'] },
    { id: 't3', title: 'Old done',   status: 'done', updated_at: daysAgo(9), assignee_id: 'abe', assignee_ids: ['abe'] },
  ];
  const map = stalledByPerson(tasks, { nowMs: NOW, stalledDays: 3 });
  assert.deepEqual(map.get('abe'), [{ id: 't1', title: 'Old shared' }]); // t2 fresh, t3 done
  assert.deepEqual(map.get('shan'), [{ id: 't1', title: 'Old shared' }]); // co-assignee sees it too
});

test('nobody stalled yields an empty map', () => {
  const tasks = [{ id: 't1', title: 'Fresh', status: 'todo', updated_at: daysAgo(1), assignee_id: 'abe', assignee_ids: ['abe'] }];
  assert.equal(stalledByPerson(tasks, { nowMs: NOW, stalledDays: 3 }).size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/checkin-stalled.test.mjs`
Expected: FAIL — cannot find module `stalled.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// supabase/functions/checkins/lib/stalled.mjs
// Pure stalled-task detection. A task is stalled if it is open and its
// updated_at is older than stalledDays. Grouped by EVERY assignee (lead +
// co-assignees, migration 060) so a co-assignee's stalled task counts. No I/O.
const DONE = new Set(['done', 'complete', 'completed']);

export function taskAssignees(task) {
  if (!task) return [];
  if (Array.isArray(task.assignee_ids) && task.assignee_ids.length) return task.assignee_ids;
  return task.assignee_id ? [task.assignee_id] : [];
}

export function stalledByPerson(tasks, { nowMs, stalledDays }) {
  const cutoff = nowMs - stalledDays * 24 * 60 * 60 * 1000;
  const out = new Map();
  for (const t of tasks || []) {
    if (!t) continue;
    if (DONE.has(String(t.status || '').toLowerCase())) continue;
    const ts = Date.parse(t.updated_at || '');
    if (Number.isNaN(ts) || ts >= cutoff) continue;
    const entry = { id: t.id, title: t.title };
    for (const person of taskAssignees(t)) {
      if (!out.has(person)) out.set(person, []);
      out.get(person).push(entry);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/checkin-stalled.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkins/lib/stalled.mjs tests/unit/checkin-stalled.test.mjs
git commit -F <msg-file>   # "feat(checkins): pure stalled-task detection"
```

---

## Task 3: Content builders + fallbacks (pure)

**Files:**
- Create: `supabase/functions/checkins/lib/content.mjs`
- Test: `tests/unit/checkin-content.test.mjs`

**Interfaces:**
- Consumes: for recaps, task rows `{ id, title, company_id, due, status, completed_at }` already filtered to one person; for stalled, the `Array<{id,title}>` from `stalledByPerson`.
- Produces:
  - `morningContext(tasks, { today }) -> { counts, lines }` — open/overdue/due-today summary lines.
  - `eodContext(tasks, { today }) -> { counts, lines }` — done-today / still-open / slipped lines.
  - `shapeMessage(modelText, fallbackText) -> { text, source }` — trims model text, else the deterministic fallback.
  - `fallbackMorning(ctx) -> string`, `fallbackEod(ctx) -> string`, `stalledText(items) -> string`.
  - `MODE_SUBJECT = { morning: 'Your morning check-in', eod: 'Your end-of-day check-in', stalled: 'Tasks that have gone quiet' }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/checkin-content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningContext, eodContext, shapeMessage, fallbackMorning, fallbackEod, stalledText } from '../../supabase/functions/checkins/lib/content.mjs';

const T = (o) => ({ id: o.id, title: o.title, company_id: o.company_id || 'roofing',
  due: o.due ?? null, status: o.status || 'todo', completed_at: o.completed_at ?? null });

test('morningContext counts overdue and due-today', () => {
  const ctx = morningContext([
    T({ id: 'a', title: 'Late', due: '2026-07-10' }),
    T({ id: 'b', title: 'Today', due: '2026-07-15' }),
  ], { today: '2026-07-15' });
  assert.equal(ctx.counts.overdue, 1);
  assert.equal(ctx.counts.dueToday, 1);
});

test('eodContext counts done-today and slipped', () => {
  const ctx = eodContext([
    T({ id: 'a', title: 'Finished', status: 'done', completed_at: '2026-07-15T18:00:00Z' }),
    T({ id: 'b', title: 'Missed', due: '2026-07-14' }),
  ], { today: '2026-07-15' });
  assert.equal(ctx.counts.done, 1);
  assert.equal(ctx.counts.slipped, 1);
});

test('shapeMessage uses model text when present, else fallback', () => {
  assert.deepEqual(shapeMessage('  Real text ', 'FB'), { text: 'Real text', source: 'model' });
  assert.deepEqual(shapeMessage('', 'FB'), { text: 'FB', source: 'fallback' });
  assert.deepEqual(shapeMessage(null, 'FB'), { text: 'FB', source: 'fallback' });
});

test('fallbacks and stalledText produce non-empty plain strings', () => {
  assert.match(fallbackMorning({ counts: { overdue: 2, dueToday: 1, total: 5 } }), /2/);
  assert.match(fallbackEod({ counts: { done: 3, slipped: 0, open: 4 } }), /3/);
  const s = stalledText([{ id: 't1', title: 'Alpha' }, { id: 't2', title: 'Beta' }]);
  assert.match(s, /Alpha/);
  assert.match(s, /Beta/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/checkin-content.test.mjs`
Expected: FAIL — cannot find module `content.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// supabase/functions/checkins/lib/content.mjs
// Pure content builders + deterministic fallbacks for the three check-in modes.
// The engine feeds *Context output to Groq for wording; if Groq is unusable the
// fallback string ships instead. No I/O, no globals.
const DONE = new Set(['done', 'complete', 'completed']);
const isDone = (t) => !!t.completed_at || DONE.has(String(t.status || '').toLowerCase());
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const MODE_SUBJECT = {
  morning: 'Your morning check-in',
  eod: 'Your end-of-day check-in',
  stalled: 'Tasks that have gone quiet',
};

export function morningContext(tasks, { today }) {
  const list = (tasks || []).filter((t) => t && !isDone(t));
  const overdue = list.filter((t) => t.due && t.due < today);
  const dueToday = list.filter((t) => t.due === today);
  const counts = { overdue: overdue.length, dueToday: dueToday.length, total: list.length };
  const lines = [...overdue, ...dueToday].slice(0, 10).map((t) =>
    `${t.due < today ? 'OVERDUE' : 'DUE TODAY'} · ${trunc(t.title, 80)}`);
  return { counts, lines };
}

export function eodContext(tasks, { today }) {
  const list = (tasks || []).filter(Boolean);
  const done = list.filter((t) => isDone(t) && String(t.completed_at || '').slice(0, 10) === today);
  const open = list.filter((t) => !isDone(t));
  const slipped = open.filter((t) => t.due && t.due < today);
  const counts = { done: done.length, slipped: slipped.length, open: open.length };
  const lines = [
    ...done.slice(0, 5).map((t) => `DONE · ${trunc(t.title, 80)}`),
    ...slipped.slice(0, 5).map((t) => `SLIPPED · ${trunc(t.title, 80)}`),
  ];
  return { counts, lines };
}

export function shapeMessage(modelText, fallbackText) {
  if (typeof modelText === 'string' && modelText.trim()) return { text: modelText.trim(), source: 'model' };
  return { text: fallbackText, source: 'fallback' };
}

export function fallbackMorning(ctx) {
  const c = (ctx && ctx.counts) || { overdue: 0, dueToday: 0, total: 0 };
  const parts = [];
  if (c.overdue) parts.push(`${plural(c.overdue, 'task')} overdue`);
  if (c.dueToday) parts.push(`${c.dueToday} due today`);
  const head = parts.length ? parts.join(', ') + '.' : 'Nothing overdue or due today.';
  return `${head} You have ${plural(c.total, 'open task')}. What are you tackling today?`;
}

export function fallbackEod(ctx) {
  const c = (ctx && ctx.counts) || { done: 0, slipped: 0, open: 0 };
  const parts = [];
  if (c.done) parts.push(`${plural(c.done, 'task')} done today`);
  if (c.slipped) parts.push(`${c.slipped} slipped past due`);
  const head = parts.length ? parts.join(', ') + '.' : 'No completions logged today.';
  return `${head} ${plural(c.open, 'task')} still open. Confirm what you finished.`;
}

export function stalledText(items) {
  const names = (items || []).slice(0, 8).map((x) => `- ${trunc(x.title, 80)}`).join('\n');
  const n = (items || []).length;
  return `${plural(n, 'task')} of yours ${n === 1 ? 'has' : 'have'} gone quiet — still moving?\n${names}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/checkin-content.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkins/lib/content.mjs tests/unit/checkin-content.test.mjs
git commit -F <msg-file>   # "feat(checkins): pure content builders + fallbacks"
```

---

## Task 4: Migrations — settings + dedupe tables

**Files:**
- Create: `supabase/sql/070_checkin_settings.sql`
- Create: `supabase/sql/071_checkin_log.sql`

**Interfaces:**
- Produces: `public.checkin_settings` (single config row), `public.checkin_log` (dedupe ledger). Read the exact column names below — Task 5 (function) and Task 6 (datastore) depend on them.

- [ ] **Step 1: Verify the next free migration number**

Run: `ls supabase/sql | tail -5`
If `070`/`071` are taken, use the next free pair and adjust filenames + the cron comment accordingly.

- [ ] **Step 2: Write `070_checkin_settings.sql`**

```sql
-- 070: checkin_settings — single-row config for AI proactive check-ins.
-- The boss (admin/developer) toggles each mode from the Check-ins settings page;
-- the scheduled `checkins` Edge Function reads this row via the service role.
-- All modes default OFF so the feature ships dark.

create table if not exists public.checkin_settings (
  id               integer primary key default 1,
  morning_enabled  boolean not null default false,
  eod_enabled      boolean not null default false,
  stalled_enabled  boolean not null default false,
  stalled_days     integer not null default 3,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  constraint checkin_settings_singleton check (id = 1)
);

-- Seed the single row so the client always has something to read/update.
insert into public.checkin_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.checkin_settings enable row level security;

-- Admins/developers may read and update the one row. The service role (cron)
-- bypasses RLS entirely.
create policy checkin_settings_admin_select on public.checkin_settings
  for select using (public.current_profile_role() in ('admin', 'developer'));
create policy checkin_settings_admin_update on public.checkin_settings
  for update using (public.current_profile_role() in ('admin', 'developer'))
             with check (public.current_profile_role() in ('admin', 'developer'));
```

- [ ] **Step 3: Write `071_checkin_log.sql`**

```sql
-- 071: checkin_log — dedupe ledger for AI proactive check-ins. The `checkins`
-- Edge Function claims a (kind, subject, period) row before sending so each
-- check-in fires exactly once per period even if the cron overlaps or retries.
-- Only the service role writes here (RLS on, no policies = deny all).
--
-- kind    ∈ { 'morning', 'eod', 'stalled' }
-- subject = member id (the recipient)
-- period  = 'YYYY-MM-DD' (HQ date) for morning/eod; HQ-Monday week key for stalled.

create table if not exists public.checkin_log (
  kind     text not null,
  subject  text not null,
  period   text not null,
  sent_at  timestamptz not null default now(),
  primary key (kind, subject, period)
);

alter table public.checkin_log enable row level security;

-- Cron scheduling lives outside this migration (needs the deployed function URL
-- + CHECKINS_SECRET). After deploying `checkins` and setting the secret, run in
-- the SQL editor:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'checkins', '*/30 * * * *',
--     $$ select net.http_post(
--          url := 'https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/checkins',
--          headers := jsonb_build_object(
--            'Content-Type','application/json',
--            'x-checkins-secret','<THE_CHECKINS_SECRET_YOU_SET>'),
--          body := '{}'::jsonb
--        ); $$
--   );
--
-- To change/stop later: select cron.unschedule('checkins');
```

- [ ] **Step 4: Apply both migrations to PROD via MCP**

Apply `070` then `071` using the Supabase MCP `apply_migration` tool (name = the filename without extension, query = the file contents).

- [ ] **Step 5: Verify the tables exist and the settings row is seeded**

Run via MCP `execute_sql`:
```sql
select (select count(*) from public.checkin_settings) as settings_rows,
       to_regclass('public.checkin_log') is not null   as log_exists;
```
Expected: `settings_rows = 1`, `log_exists = true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/sql/070_checkin_settings.sql supabase/sql/071_checkin_log.sql
git commit -F <msg-file>   # "feat(checkins): settings + dedupe-log migrations"
```

---

## Task 5: The `checkins` edge function

**Files:**
- Create: `supabase/functions/checkins/index.ts`
- (Uses `lib/schedule.mjs`, `lib/stalled.mjs`, `lib/content.mjs` from Tasks 1–3.)

**Interfaces:**
- Consumes: `firesNow`, `hqParts`, `weekKey` (schedule.mjs); `stalledByPerson`, `taskAssignees` (stalled.mjs); `morningContext`, `eodContext`, `shapeMessage`, `fallbackMorning`, `fallbackEod`, `stalledText`, `MODE_SUBJECT` (content.mjs).
- Produces: HTTP `POST` returning `{ ok, scanned, sent, errors[:20] }`; secret-gated, service-role, no JWT.

- [ ] **Step 1: Write `index.ts`**

```typescript
// supabase/functions/checkins/index.ts
// checkins — scheduled (pg_cron) Edge Function that sends AI-written, one-way
// check-ins (morning recap, end-of-day recap, weekly-capped stalled nudge) to
// the in-app bell + email. Runs under the service role; gated by a shared
// secret (x-checkins-secret; Verify JWT must be OFF). Deployed from repo source
// (index.ts + lib/*.mjs) via the Supabase MCP — never a paste bundle.
//
// Secrets: CHECKINS_SECRET, GROQ_API_KEY, RESEND_API_KEY, EMAIL_FROM
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firesNow, hqParts, weekKey } from "./lib/schedule.mjs";
import { stalledByPerson, taskAssignees } from "./lib/stalled.mjs";
import {
  morningContext, eodContext, shapeMessage,
  fallbackMorning, fallbackEod, stalledText, MODE_SUBJECT,
} from "./lib/content.mjs";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_TASKS = 2000;

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Ask Groq to reword `fallback` around `contextLines`; return {} shape via shapeMessage.
async function wording(groqKey: string | undefined, sys: string, contextLines: string[], fallback: string): Promise<string> {
  if (!groqKey) return fallback;
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.4, max_tokens: 220,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: contextLines.join("\n") || "(no items)" },
        ],
      }),
    });
    if (!res.ok) { console.error("[checkins] groq rejected", res.status); return fallback; }
    const data = await res.json().catch(() => ({}));
    return shapeMessage(data?.choices?.[0]?.message?.content ?? "", fallback).text;
  } catch (e) {
    console.error("[checkins] groq threw", e);
    return fallback;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });

  const secret = Deno.env.get("CHECKINS_SECRET");
  if (!secret || req.headers.get("x-checkins-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500 });

  const db = createClient(supabaseUrl, serviceKey);
  const groqKey = Deno.env.get("GROQ_API_KEY");
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";
  const now = Date.now();
  const { dateKey } = hqParts(now);

  // Settings gate.
  const setRes = await db.from("checkin_settings").select("*").eq("id", 1).single();
  const cfg = setRes.data ?? { morning_enabled: false, eod_enabled: false, stalled_enabled: false, stalled_days: 3 };
  const active: string[] = [];
  if (cfg.morning_enabled && firesNow("morning", now)) active.push("morning");
  if (cfg.eod_enabled && firesNow("eod", now)) active.push("eod");
  if (cfg.stalled_enabled && firesNow("stalled", now)) active.push("stalled");
  if (!active.length) return new Response(JSON.stringify({ ok: true, scanned: 0, sent: 0, errors: [] }), { headers: { "Content-Type": "application/json" } });

  // Recipients: approved, active members with an email/id.
  const memRes = await db.from("team_members").select("id, email");
  const emailById = new Map<string, string>();
  const memberIds: string[] = [];
  (memRes.data ?? []).forEach((m: any) => { memberIds.push(m.id); if (m.email) emailById.set(m.id, String(m.email).trim()); });

  // All open + recently-completed tasks (RLS bypassed; we filter per person).
  const taskRes = await db.from("tasks")
    .select("id, title, company_id, due, status, completed_at, updated_at, assignee_id, assignee_ids")
    .limit(MAX_TASKS);
  if (taskRes.error) { console.error("[checkins] task load failed", taskRes.error); return new Response(JSON.stringify({ error: "task load failed" }), { status: 500 }); }
  const tasks = taskRes.data ?? [];

  const errors: string[] = [];
  let sent = 0;

  // Deliver one message: claim dedupe row, then bell + email (best-effort).
  async function deliver(kind: string, person: string, period: string, subject: string, body: string, taskId: string | null) {
    const claim = await db.from("checkin_log")
      .upsert({ kind, subject: person, period }, { onConflict: "kind,subject,period", ignoreDuplicates: true })
      .select();
    if (claim.error) { errors.push(`log ${kind}/${person}: ${claim.error.message}`); return; }
    if (!claim.data || claim.data.length === 0) return; // already sent this period

    const html = String(body).split("\n").map((l) => `<p>${esc(l)}</p>`).join("");
    const notif = await db.from("notifications").insert({
      id: crypto.randomUUID(), member_id: person, task_id: taskId,
      meta: `Check-in · ${subject}`, html, read: false,
    });
    if (notif.error) errors.push(`notif ${kind}/${person}: ${notif.error.message}`);

    if (apiKey && emailById.has(person)) {
      try {
        const r = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [emailById.get(person)], subject, html: `${html}<p style="color:#888;font-size:12px">Quest HQ check-in</p>` }),
        });
        if (!r.ok) errors.push(`email ${kind}/${person}: ${r.status}`);
      } catch (e) { errors.push(`email ${kind}/${person}: ${String(e)}`); }
    }
    sent++;
  }

  // --- Recap modes (morning / eod): one message per person per day. ---
  for (const mode of active.filter((m) => m === "morning" || m === "eod")) {
    for (const person of memberIds) {
      const mine = tasks.filter((t: any) => taskAssignees(t).includes(person));
      const ctx = mode === "morning" ? morningContext(mine, { today: dateKey }) : eodContext(mine, { today: dateKey });
      // Skip a person with nothing to say (no open work / no activity).
      if (!ctx.lines.length && (mode === "morning" ? ctx.counts.total === 0 : ctx.counts.done === 0 && ctx.counts.open === 0)) continue;
      const fallback = mode === "morning" ? fallbackMorning(ctx) : fallbackEod(ctx);
      const sys = mode === "morning"
        ? "You write a 2-sentence morning check-in for a worker from the task lines given. End by asking what they're tackling today. Plain text, no markdown, no emojis. Only reference the given tasks."
        : "You write a 2-sentence end-of-day check-in from the task lines given. Note what got done and what slipped, then ask them to confirm what they finished. Plain text, no markdown, no emojis.";
      const body = await wording(groqKey, sys, ctx.lines, fallback);
      await deliver(mode, person, dateKey, MODE_SUBJECT[mode], body, null);
    }
  }

  // --- Stalled mode: one grouped message per person per week. ---
  if (active.includes("stalled")) {
    const period = weekKey(dateKey);
    const byPerson = stalledByPerson(tasks, { nowMs: now, stalledDays: cfg.stalled_days ?? 3 });
    for (const [person, items] of byPerson) {
      const fallback = stalledText(items);
      const sys = "You write a short, friendly nudge listing a worker's stalled tasks (given as lines) and ask if they're still moving. Keep the task titles. Plain text, no markdown, no emojis.";
      const body = await wording(groqKey, sys, items.map((x) => `- ${x.title}`), fallback);
      await deliver("stalled", person, period, MODE_SUBJECT.stalled, body, items[0]?.id ?? null);
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: tasks.length, sent, errors: errors.slice(0, 20) }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Deploy from repo source via MCP**

Use the Supabase MCP `deploy_edge_function` with `project_id: qqvmcsvdxhgjooirznrj`, `name: checkins`, `entrypoint_path: index.ts`, `verify_jwt: false`, and `files` = the four files (`index.ts`, `lib/schedule.mjs`, `lib/stalled.mjs`, `lib/content.mjs`) read from disk.

- [ ] **Step 3: Set the secret**

The user sets `CHECKINS_SECRET` in the Supabase dashboard (Edge Functions → Secrets), or confirm it via `supabase secrets`. Pick a long random value; the same value goes in the cron header (Task 8).

- [ ] **Step 4: Smoke test the gate + a dry run**

With no secret header, expect 401:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/checkins -d '{}'
```
Expected: `401`.

With the correct header (all toggles still off, so it no-ops safely):
```bash
curl -s -X POST https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/checkins \
  -H "x-checkins-secret: <SECRET>" -H "Content-Type: application/json" -d '{}'
```
Expected: `{"ok":true,"scanned":0,"sent":0,"errors":[]}` (nothing enabled).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkins/index.ts
git commit -F <msg-file>   # "feat(checkins): scheduled check-in engine edge function"
```

---

## Task 6: Datastore settings read/write

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (add two methods near the other `from('...')` helpers)

**Interfaces:**
- Produces:
  - `getCheckinSettings() -> Promise<{ morning_enabled, eod_enabled, stalled_enabled, stalled_days }>`
  - `saveCheckinSettings(patch) -> Promise<row>` — updates the singleton row (id=1), stamping `updated_by`/`updated_at`.

- [ ] **Step 1: Add the two methods**

Find a datastore method that already reads a table under the user client (e.g. `loadTaxonomy`) and add alongside it:

```javascript
  async getCheckinSettings() {
    const { data, error } = await this.client
      .from('checkin_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    return data;
  }

  async saveCheckinSettings(patch) {
    const row = {
      morning_enabled: !!patch.morning_enabled,
      eod_enabled: !!patch.eod_enabled,
      stalled_enabled: !!patch.stalled_enabled,
      stalled_days: Math.max(1, Math.min(90, parseInt(patch.stalled_days, 10) || 3)),
      updated_by: this.currentMemberId || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from('checkin_settings').update(row).eq('id', 1).select().single();
    if (error) throw error;
    return data;
  }
```

Note: match the property used elsewhere in this file for the Supabase client handle (it may be `this.client` or `this.supabase`) and for the current member id. Grep the file first:
Run: `grep -nE "this\.(client|supabase)\b|currentMemberId|this\._member" js/services/SupabaseDataStore.js | head`

- [ ] **Step 2: Sanity check (no unit test — thin I/O wrapper)**

Run: `node -e "require('fs').readFileSync('js/services/SupabaseDataStore.js','utf8').includes('getCheckinSettings') || process.exit(1)"`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -F <msg-file>   # "feat(checkins): datastore read/write for checkin_settings"
```

---

## Task 7: Permissions plumbing

**Files:**
- Modify: `js/constants.js:111-112` (add `checkins.manage` to `admin` + `developer`)
- Modify: `js/controllers/AppController.js:~124` (view gate)
- Modify: `js/views/SidebarView.js:~265` (nav entry)
- Modify: `js/views/PermissionsAdminView.js:~75-79` (matrix row)

**Interfaces:**
- Produces: capability `checkins.manage`; navigable view id `admin:checkins` gated by it.

- [ ] **Step 1: Add the capability to admin + developer roles**

In `js/constants.js`, append `'checkins.manage'` to the `admin` and `developer` arrays (leave `supervisor`/`construction_supervisor` without it — boss-only):

```javascript
  admin: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view', 'home.view', 'reports.view', 'task-setup.manage', 'checkins.manage'],
  developer: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view', 'home.view', 'reports.view', 'debug.access', 'task-setup.manage', 'bug-reports.manage', 'checkins.manage'],
```

- [ ] **Step 2: Gate the view in AppController**

In `js/controllers/AppController.js`, next to the other `admin:` checks (~line 124–126):

```javascript
    if (view === 'admin:checkins') return App.can('checkins.manage');
```

- [ ] **Step 3: Add the sidebar entry**

In `js/views/SidebarView.js`, beside the `admin:task-setup` push (~line 265):

```javascript
    if (App.can('checkins.manage')) teamItems.push({ view: 'admin:checkins', label: 'Check-ins', icon: 'ti-bell' });
```
Verify `ti-bell` is in the subset: `grep -o '\.ti-bell\b' vendor/tabler-icons/tabler-icons-subset.css | head -1` (if absent, use `ti-clock-play` which is present).

- [ ] **Step 4: Add the permissions-matrix row**

In `js/views/PermissionsAdminView.js`, add to the `insights` group's `capabilities` array (~line 77):

```javascript
        { id: 'checkins.manage', label: 'Proactive check-ins', perm: 'checkins.manage' },
```

- [ ] **Step 5: Verify no syntax errors**

Run: `node -e "require('./js/constants.js')" 2>&1 | head` — note this file expects a browser `window`; instead just check it parses:
Run: `node --check js/constants.js && node --check js/controllers/AppController.js && node --check js/views/SidebarView.js && node --check js/views/PermissionsAdminView.js`
Expected: no output (all parse).

- [ ] **Step 6: Commit**

```bash
git add js/constants.js js/controllers/AppController.js js/views/SidebarView.js js/views/PermissionsAdminView.js
git commit -F <msg-file>   # "feat(checkins): checkins.manage capability + nav entry"
```

---

## Task 8: Settings view + wiring

**Files:**
- Create: `js/views/CheckinSettingsView.js`
- Modify: `js/app.js:~223` (instantiate)
- Modify: `app.html` (script tag)

**Interfaces:**
- Consumes: `dataStore.getCheckinSettings()` / `saveCheckinSettings(patch)` (Task 6); view id `admin:checkins`, capability `checkins.manage` (Task 7).
- Produces: `App.CheckinSettingsView` rendering into `#timeViewWrap`.

- [ ] **Step 1: Write the view**

```javascript
// js/views/CheckinSettingsView.js
window.App = window.App || {};

/* Settings → Check-ins. Boss-only (checkins.manage) page that toggles the three
   proactive check-in modes for the whole team and sets the stalled threshold.
   Renders into the shared #timeViewWrap like the other admin surfaces; activated
   on the 'admin:checkins' view. Writes the single checkin_settings row that the
   scheduled `checkins` Edge Function reads. */
App.CheckinSettingsView = class CheckinSettingsView {
  constructor({ controller }) {
    this.controller = controller;
    this.dataStore = controller.dataStore;
    this.wrap = document.getElementById('timeViewWrap');
    this.cfg = null;
    this._busy = false;
    App.EventBus.on('view:changed', (view) => { if (view === 'admin:checkins') this.refresh(); });
  }

  visible() {
    return this.controller.uiState.view === 'admin:checkins'
      && this.wrap && !this.wrap.classList.contains('hidden');
  }

  _esc(s) { return App.utils.escapeHtml(String(s ?? '')); }

  async refresh() {
    if (!this.wrap) this.wrap = document.getElementById('timeViewWrap');
    if (!this.wrap) return;
    if (!App.can('checkins.manage')) {
      this.wrap.innerHTML = `<div class="tsetup"><div class="empty"><i class="ti ti-lock"></i><p>Only admins can manage check-ins.</p></div></div>`;
      return;
    }
    try { this.cfg = await this.dataStore.getCheckinSettings(); }
    catch (e) { this.wrap.innerHTML = `<div class="tsetup"><div class="empty"><p>Couldn’t load check-in settings. ${this._esc((e && e.message) || '')}</p></div></div>`; return; }
    if (!this.visible()) return;
    this.render();
  }

  _row(key, title, desc) {
    const on = !!this.cfg[key];
    return `<label class="ci-row">
      <span class="ci-row-t"><span class="ci-row-title">${title}</span><span class="ci-row-desc">${desc}</span></span>
      <input type="checkbox" data-ci="${key}" ${on ? 'checked' : ''} />
    </label>`;
  }

  render() {
    this.wrap.innerHTML = `<div class="tsetup ci-wrap">
      <div class="tsetup-head"><h2 class="tsetup-title">Check-ins</h2></div>
      <p class="tsetup-sub">Proactive AI messages to your team, delivered to the notification bell and by email. Everything is off until you switch it on.</p>
      ${this._row('morning_enabled', 'Morning recap', 'Each morning: a summary of their day plus “what are you tackling today?”')}
      ${this._row('eod_enabled', 'End-of-day recap', 'Late afternoon: what they finished, what slipped, confirm the day.')}
      ${this._row('stalled_enabled', 'Stalled-task nudge', 'Weekly: a nudge listing tasks that have gone quiet.')}
      <label class="ci-days">Stalled after
        <input type="number" min="1" max="90" data-ci-days value="${this.cfg.stalled_days || 3}" /> days
      </label>
      <div class="ci-actions"><button class="btn btn-primary" data-ci-save type="button">Save</button><span class="ci-status" data-ci-status></span></div>
    </div>`;
    this.wrap.querySelector('[data-ci-save]').addEventListener('click', () => this._save());
  }

  async _save() {
    if (this._busy) return;
    this._busy = true;
    const status = this.wrap.querySelector('[data-ci-status]');
    status.textContent = 'Saving…';
    const patch = {
      morning_enabled: this.wrap.querySelector('[data-ci="morning_enabled"]').checked,
      eod_enabled: this.wrap.querySelector('[data-ci="eod_enabled"]').checked,
      stalled_enabled: this.wrap.querySelector('[data-ci="stalled_enabled"]').checked,
      stalled_days: this.wrap.querySelector('[data-ci-days]').value,
    };
    try { this.cfg = await this.dataStore.saveCheckinSettings(patch); status.textContent = 'Saved.'; }
    catch (e) { status.textContent = `Couldn’t save. ${this._esc((e && e.message) || '')}`; }
    this._busy = false;
  }
};
```

- [ ] **Step 2: Add minimal styles**

Append to `taskmanagement.css` (reuse existing tokens; no new hairline borders):

```css
/* Check-ins settings */
.ci-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.ci-row-t { display: flex; flex-direction: column; gap: 3px; }
.ci-row-title { font-weight: 700; color: var(--ink); }
.ci-row-desc { font-size: 12px; color: var(--ink-3); }
.ci-days { display: inline-flex; align-items: center; gap: 8px; margin: 16px 0; color: var(--ink-2); font-weight: 600; }
.ci-days input { width: 64px; }
.ci-actions { display: flex; align-items: center; gap: 12px; }
.ci-status { font-size: 12px; color: var(--ink-3); }
```

- [ ] **Step 3: Instantiate in app.js**

In `js/app.js`, beside `new App.TaskSetupAdminView({ controller });` (~line 223):

```javascript
  new App.CheckinSettingsView({ controller });
```

- [ ] **Step 4: Add the script tag**

In `app.html`, next to the `TaskSetupAdminView.js` script tag, add (before `app.js`):

```html
    <script src="js/views/CheckinSettingsView.js"></script>
```

- [ ] **Step 5: Verify it parses**

Run: `node --check js/views/CheckinSettingsView.js`
Expected: no output.

- [ ] **Step 6: Screenshot the settings page (preview harness)**

Build a throwaway harness in the project root that includes `taskmanagement.css` + `vendor/tabler-icons/tabler-icons-subset.css` under `<body class="ui-command-center panze-home">`, renders the `render()` output with a stub `cfg = { morning_enabled:true, eod_enabled:false, stalled_enabled:false, stalled_days:3 }`, and screenshot light + dark + 390px with the Playwright chromium-1223 path (see the screenshot-harness memory). Confirm: toggles aligned, no horizontal overflow at 390px. Delete the harness after.

- [ ] **Step 7: Commit**

```bash
git add js/views/CheckinSettingsView.js js/app.js app.html taskmanagement.css
git commit -F <msg-file>   # "feat(checkins): boss-only check-in settings page"
```

---

## Task 9: Cron rollout + live verification

**Files:** none (operational). This task turns the feature on.

- [ ] **Step 1: Push the client**

```bash
git push origin main   # Vercel auto-deploys the settings page (still dark: all toggles off)
```

- [ ] **Step 2: Create the pg_cron job**

Confirm `CHECKINS_SECRET` is set (Task 5 Step 3). Then run the SQL from `071_checkin_log.sql`'s comment block via MCP `execute_sql` (extensions + `cron.schedule('checkins', '*/30 * * * *', ...)`), substituting the real secret. Verify: `select jobname, schedule from cron.job where jobname = 'checkins';` → one row.

- [ ] **Step 3: Enable ONE mode and verify end-to-end**

In the app (as admin) open **Check-ins**, enable **Morning recap**, Save. Then force a single run without waiting for the 8am window by temporarily invoking during its HQ hour, OR verify the safe no-op outside the window first:
```bash
curl -s -X POST https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/checkins \
  -H "x-checkins-secret: <SECRET>" -H "Content-Type: application/json" -d '{}'
```
Outside 8am HQ: expect `sent: 0`. Inside the 8am HQ hour: expect `sent > 0`, a bell row for at least one member, and (if they have an email) a delivered email. Check the function logs via MCP `get_logs` for errors.

- [ ] **Step 4: Confirm dedupe**

Invoke the function a second time inside the same window. Expected: `sent: 0` (the `checkin_log` rows already claimed). This proves no double-send.

- [ ] **Step 5: Update project memory**

Update `memory/project_ai_assistant_program.md` + `MEMORY.md`: checkins engine shipped, function `checkins` deployed (verify_jwt off), cron live, which modes enabled, and that `due-reminders` is still separate/unshipped.

---

## Self-Review

**Spec coverage:**
- Engine + 30-min cron + service-role → Tasks 5, 9. ✔
- HQ-time windows, catch-up-by-hour-band, dedupe → Tasks 1, 5. ✔
- Three modes (morning/eod/stalled, grouped weekly-capped) → Tasks 1–3, 5. ✔
- Multi-assignee seam in stalled detection → Task 2 (`taskAssignees`), tested. ✔
- Delivery bell + email, best-effort, claim-before-send → Task 5 `deliver()`. ✔
- Deterministic fallbacks on Groq outage → Task 3 + Task 5 `wording()`. ✔
- `checkin_settings` + `checkin_log`; `notifications.task_id` already nullable → Task 4 (+ confirmed, no migration). ✔
- Boss-only settings page, per-type toggles + stalled days → Tasks 6–8. ✔
- Ships dark (defaults false) → Task 4 SQL defaults, Task 9 rollout. ✔
- New `CHECKINS_SECRET`, reused Groq/Resend/EMAIL_FROM → Tasks 4, 5, 9. ✔

**Placeholder scan:** No TBD/TODO; every code step carries full code; the two "grep to confirm the exact handle/icon" notes are verification steps, not placeholders.

**Type consistency:** `taskAssignees` defined in Task 2, reused in Task 5. `hqParts`/`weekKey`/`firesNow` defined Task 1, consumed Task 5. `morningContext`/`eodContext`/`shapeMessage`/`fallback*`/`stalledText`/`MODE_SUBJECT` defined Task 3, consumed Task 5. `checkin_settings` columns identical across Tasks 4/5/6. `checkin_log` `(kind, subject, period)` identical across Tasks 4/5. Settings method names `getCheckinSettings`/`saveCheckinSettings` identical across Tasks 6/8.
