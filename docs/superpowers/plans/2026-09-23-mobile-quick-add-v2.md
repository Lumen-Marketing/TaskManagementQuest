# Mobile Quick Add v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give phone users Abraham's approved v2 design — a bottom-sheet quick add and a matching task board — without touching any desktop path.

**Architecture:** Two new units on seams that already exist. `QuickBoardLayout` registers into `App.TaskListLayouts` like the six adapters already there and becomes the phone default. `TaskSheetView` is built on the app's existing bottom-sheet presenter (`App.Menu.open({ present: 'sheet' })`) and is what `openNewTaskPage()` delegates to below 720px. All pure logic lands in small testable modules first; DOM behaviour is proven with Playwright against `?preview=1` at a phone viewport.

**Tech Stack:** Vanilla ES2017 browser JS in IIFE modules on a global `App` namespace, no build step. Tests: `node:test` for units (`npm run test:unit`), Playwright for DOM (`npm run test:local`).

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-quick-add-v2-design.md`

## Global Constraints

- **No build step.** Every new JS file is an IIFE that attaches to `window.App` and is added to `app.html` with a `<script defer>` tag. Follow the existing ordering: helpers before the views that use them.
- **Use the app's design tokens, never the handoff's hex values.** `tokens.css` is OKLCH and ships a dark theme (`:root, [data-theme="dark"]` is the *default*; `[data-theme="light"]` overrides). Hardcoding `#ED4E0D` / `#F7F4EF` / `#E7E2DA` from the handoff produces a sheet that is unreadable in dark mode. Use `--surface`, `--ink`, `--ink-2`, `--ink-3`, `--border`, `--border-strong`, `--amber`, `--blue`, `--green`, `--color-accent`, `--radius-*`, `--shadow-*`.
- **Radii from the handoff, expressed in tokens where one matches:** sheet top corners 24px, field group / cards 16px, trays and option chips 12px, pills `--radius-pill`.
- **Fonts are already loaded** — Hanken Grotesk for UI, IBM Plex Mono for labels and eyebrows. Do not add font links.
- **Phone breakpoint is `(max-width: 720px)`.** In JS use `window.matchMedia('(max-width: 720px)').matches`, matching `js/views/SidebarView.js:128`.
- **`App.Menu` allows only one menu open at a time** — opening a second closes the first with reason `'reopen'`. The sheet's picker trays are panels *inside* the sheet, so they must NOT be built with `App.Menu`. Using it for a tray closes the sheet.
- **Task titles are uppercased on save** by `App.utils.upper` in `createTask`. The board will show `FIX DRIP EDGE AT SIMMONS JOB`, not the mockup's sentence case. This is existing app-wide behaviour; do not change it here.
- **`App.validate.newTask` requires at least one assignee.** The sheet defaults ASSIGNEE to the current user so this cannot fail silently.
- **Respect `prefers-reduced-motion`** — kill the sheet slide and the new-card pulse. `App.Motion` already centralises this.
- **Priorities offered are the four, not the five.** `App.PRIORITIES` holds five keys, but `NewTaskPageView._priList()` deliberately offers only `low / medium / high / critical` — the comment there marks it "pro1 v1-FINAL" and says `urgent` stays in the data model but is intentionally not offered on the create path. That is exactly the handoff's four-segment bar. Never build the priority tray from `Object.keys(App.PRIORITIES)`; it would show five segments and reverse a deliberate product decision. (Existing tasks *carrying* `urgent` must still display it correctly — that is a read path, not an offer.)
- **Company colour is not `App.taxonomy.color`.** That function is `color(kind, company, key, type)` for types, statuses and labels. Company accent colour comes from a CSS variable rotated by the company's index, duplicated privately today in `NewTaskPageView._companyColor` and `ProjectsView._companyColor`. Task 5 promotes it to `App.utils.companyColor(id)`; use that.
- **The token parser's `atEnd` flag is not optional.** `App.parseTaskTitle` resolves a token only when a trailing boundary follows it — whitespace, or end-of-string when `ctx.atEnd` is true. Pass `false` on every keystroke (so `9a` typed on the way to `9am` does not resolve and vanish under the cursor) and `true` on save (or every saved title keeps its trailing token). `NewTaskPageView.submit()` does the same via `_applyParse(true)`.
- **The assignee list is company-scoped.** Use `App.utils.peopleInCompany(companyId, currentUser)`, not `App.directory.people()` — the latter returns everyone regardless of company.
- **Commit author must be** `ShanIngrid1207 <ShanIngrid1207@users.noreply.github.com>` — a different author silently blocks the Vercel build. Already set as local git config in this worktree.
- Unit tests need no `node_modules`. Playwright tasks need `npm ci` and `npx playwright install chromium` once.

---

### Task 1: Fix `formatDue`'s timezone skew

`App.utils.formatDue` builds its date with `new Date(iso)`, which parses `"2026-09-25"` as **UTC midnight**, then formats it with `toLocaleDateString` in the **runtime's local zone**. For any user west of UTC — including Phoenix, the HQ zone — that renders the previous day. Today and Tomorrow are safe because they are compared as strings; every other date is wrong.

It is used in 10 places across 6 view files and has no test coverage. The new board puts a due pill on every card, so this is fixed before the board is built.

**Files:**
- Modify: `js/utils.js:508-518`
- Test: `tests/unit/format-due.test.mjs` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `App.utils.formatDue(iso)` → `{ text: string, cls: '' | 'due-today' | 'due-overdue' }` — unchanged signature, corrected output

- [ ] **Step 1: Write the failing test**

Create `tests/unit/format-due.test.mjs`:

```js
// tests/unit/format-due.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// utils.js is an IIFE over `window`; give it the globals it touches at load.
global.window = global.window || {};
global.App = global.window.App = { HQ_TIMEZONE: 'America/Phoenix' };
require('../../js/utils.js');

// Pin "today" so the assertions do not drift with the calendar.
const FIXED_TODAY = '2026-09-23';
App.utils.todayISO = (offset = 0) => {
  const p = FIXED_TODAY.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + offset));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Every zone must name the same calendar day. Phoenix (UTC-7) is the HQ zone and
// the one the old implementation got wrong; Manila (UTC+8) is where the work is
// reviewed from. Both must agree with the ISO string.
for (const tz of ['America/Phoenix', 'Asia/Manila', 'UTC']) {
  test(`formatDue names the same day in ${tz}`, () => {
    process.env.TZ = tz;
    assert.equal(App.utils.formatDue('2026-09-25').text, 'Sep 25');
    assert.equal(App.utils.formatDue('2026-10-01').text, 'Oct 1');
    assert.equal(App.utils.formatDue('2026-09-18').text, 'Sep 18');
  });
}

test('today and tomorrow are named, not dated', () => {
  process.env.TZ = 'America/Phoenix';
  assert.deepEqual(App.utils.formatDue('2026-09-23'), { text: 'Today', cls: 'due-today' });
  assert.equal(App.utils.formatDue('2026-09-24').text, 'Tomorrow');
});

test('past dates are flagged overdue', () => {
  process.env.TZ = 'America/Phoenix';
  assert.equal(App.utils.formatDue('2026-09-18').cls, 'due-overdue');
  assert.equal(App.utils.formatDue('2026-09-25').cls, '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/format-due.test.mjs`
Expected: FAIL. The `America/Phoenix` case reports `Sep 24` where `Sep 25` was expected.

- [ ] **Step 3: Write the minimal implementation**

In `js/utils.js`, replace the body of `formatDue`. The only change is how `d` is built — appending `T00:00` makes the string parse as **local** midnight instead of UTC midnight, so the formatter cannot walk it backwards across the date line.

```js
  formatDue(iso) {
    const t0 = App.utils.todayISO(0);
    const t1 = App.utils.todayISO(1);
    if (iso === t0) return { text: 'Today', cls: 'due-today' };
    if (iso === t1) return { text: 'Tomorrow', cls: '' };
    // `new Date('2026-09-25')` is parsed as UTC midnight and then formatted in
    // the viewer's zone, which names the PREVIOUS day everywhere west of UTC —
    // including Phoenix, the HQ zone. The explicit time makes it parse local.
    const d = new Date(iso + 'T00:00');
    if (iso < t0) {
      return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'due-overdue' };
    }
    return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/format-due.test.mjs`
Expected: PASS, 5 tests.

Then the full suite, to prove nothing downstream depended on the skew:
Run: `npm run test:unit`
Expected: PASS, 241 existing + 5 new.

- [ ] **Step 5: Commit**

```bash
git add js/utils.js tests/unit/format-due.test.mjs
git commit -m "fix(dates): formatDue named the previous day west of UTC

new Date('2026-09-25') parses as UTC midnight, so formatting it in the
viewer's local zone walked it back a day for everyone west of UTC —
including Phoenix, the HQ zone. Only Today and Tomorrow were safe,
because those are compared as strings. Parse as local midnight instead.

First test coverage for a helper used in 10 places across 6 views.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Due and time quick-pick helper

The sheet's DUE tray offers Today / Tomorrow / next Fri / next Mon / No date, and the TIME tray a fixed set of times. Both are pure functions of "today", so they are built and tested before any DOM exists. This is also where the reference prototype's date bug is designed out: every date comes from `App.utils.todayISO`, which resolves the calendar day in the **HQ timezone for every user**, rather than from the device clock.

**Files:**
- Create: `js/views/tasksheet/dates.js`
- Create: `tests/unit/tasksheet-dates.test.mjs`
- Modify: `app.html` (add the script tag)

**Interfaces:**
- Consumes: `App.utils.todayISO(offset)` → `'YYYY-MM-DD'`
- Produces:
  - `App.TaskSheet.dates.quickPicks(todayIso)` → `[{ key, label, iso }]`, always 5 entries, last is `{ key: 'none', label: 'No date', iso: '' }`
  - `App.TaskSheet.dates.timePicks()` → `[{ key, label, value }]`, `value` is `'HH:MM'` 24h or `''`
  - `App.TaskSheet.dates.nextDow(todayIso, dow)` → `'YYYY-MM-DD'`, strictly the *next* such weekday (never today)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tasksheet-dates.test.mjs`:

```js
// tests/unit/tasksheet-dates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/tasksheet/dates.js');

const D = () => App.TaskSheet.dates;

// 2026-09-23 is a Wednesday.
const WED = '2026-09-23';

test('nextDow is strictly the next weekday, never today', () => {
  assert.equal(D().nextDow(WED, 5), '2026-09-25');        // Fri that week
  assert.equal(D().nextDow(WED, 1), '2026-09-28');        // following Mon
  // Asking for Wednesday on a Wednesday must jump a full week, not return today.
  assert.equal(D().nextDow(WED, 3), '2026-09-30');
});

test('nextDow crosses a month boundary without drifting', () => {
  assert.equal(D().nextDow('2026-09-29', 5), '2026-10-02');
});

test('quickPicks offers today, tomorrow, next Fri, next Mon and No date', () => {
  const picks = D().quickPicks(WED);
  assert.equal(picks.length, 5);
  assert.deepEqual(picks.map(p => p.key), ['today', 'tomorrow', 'fri', 'mon', 'none']);
  assert.deepEqual(picks.map(p => p.iso),
    [WED, '2026-09-24', '2026-09-25', '2026-09-28', '']);
  assert.equal(picks[0].label, 'Today');
  assert.equal(picks[1].label, 'Tomorrow');
  assert.equal(picks[4].label, 'No date');
});

test('the weekday picks are labelled with their real date', () => {
  const picks = D().quickPicks(WED);
  assert.equal(picks[2].label, 'Fri, Sep 25');
  assert.equal(picks[3].label, 'Mon, Sep 28');
});

test('quickPicks is stable across the viewer timezone', () => {
  const seen = new Set();
  for (const tz of ['America/Phoenix', 'Asia/Manila', 'UTC']) {
    process.env.TZ = tz;
    seen.add(D().quickPicks(WED).map(p => p.iso + '|' + p.label).join(','));
  }
  assert.equal(seen.size, 1, 'quick picks must not vary with the device zone');
});

test('timePicks leads with No time and returns 24h values', () => {
  const picks = D().timePicks();
  assert.equal(picks[0].key, 'none');
  assert.equal(picks[0].value, '');
  assert.deepEqual(picks.map(p => p.value),
    ['', '07:00', '09:00', '12:00', '14:00', '16:00']);
  assert.equal(picks[2].label, '9:00 AM');
  assert.equal(picks[5].label, '4:00 PM');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/tasksheet-dates.test.mjs`
Expected: FAIL — `Cannot find module '../../js/views/tasksheet/dates.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `js/views/tasksheet/dates.js`:

```js
/* Due/time quick picks for the mobile task sheet.
   Pure: every date is derived from the ISO day handed in, with UTC arithmetic,
   so a device in another zone can never shift a pick. The caller passes
   App.utils.todayISO(), which already resolves the calendar day in the HQ zone.

   This is deliberately NOT `new Date()` + toISOString: that combination reads a
   day early everywhere west of UTC, which is the bug in the handoff prototype. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parts(iso) {
    const p = String(iso).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function fmtIso(d) {
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    const d = parts(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtIso(d);
  }
  // Strictly the NEXT such weekday: asking for Wednesday on a Wednesday jumps a
  // full week rather than returning today, which matches tokenParser.js.
  function nextDow(iso, dow) {
    const cur = parts(iso).getUTCDay();
    let delta = (dow - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(iso, delta);
  }
  // "Fri, Sep 25" — formatted from the UTC parts, never via toLocaleDateString,
  // which would re-interpret the day in the viewer's zone.
  function dowLabel(iso) {
    const d = parts(iso);
    return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  function quickPicks(todayIso) {
    const fri = nextDow(todayIso, 5);
    const mon = nextDow(todayIso, 1);
    return [
      { key: 'today',    label: 'Today',          iso: todayIso },
      { key: 'tomorrow', label: 'Tomorrow',       iso: addDays(todayIso, 1) },
      { key: 'fri',      label: dowLabel(fri),    iso: fri },
      { key: 'mon',      label: dowLabel(mon),    iso: mon },
      { key: 'none',     label: 'No date',        iso: '' },
    ];
  }

  function timePicks() {
    return [
      { key: 'none', label: 'No time',  value: '' },
      { key: 't7',   label: '7:00 AM',  value: '07:00' },
      { key: 't9',   label: '9:00 AM',  value: '09:00' },
      { key: 't12',  label: '12:00 PM', value: '12:00' },
      { key: 't14',  label: '2:00 PM',  value: '14:00' },
      { key: 't16',  label: '4:00 PM',  value: '16:00' },
    ];
  }

  TS.dates = { quickPicks, timePicks, nextDow, addDays, dowLabel };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/tasksheet-dates.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the script**

In `app.html`, immediately before the existing `js/views/newtask/tokenParser.js` tag, add:

```html
<script defer src="js/views/tasksheet/dates.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/tasksheet/dates.js tests/unit/tasksheet-dates.test.mjs app.html
git commit -m "feat(tasksheet): due and time quick picks

Pure date helpers for the mobile sheet's DUE and TIME trays. All
arithmetic is UTC over the ISO day the caller supplies (todayISO, which
resolves in the HQ zone), so no pick can shift with the device clock.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Board model — segment filter, sort and overdue

The v2 board is a flat list, unlike every existing layout. Its ordering rule (§4 of the handoff: not-done first, then priority Critical→Low, then due ascending) and its Open/Done/All segment are pure functions over the task array, so they are built and tested before the DOM.

**Files:**
- Create: `js/views/tasklist/quickBoardModel.js`
- Create: `tests/unit/quick-board-model.test.mjs`
- Modify: `app.html` (add the script tag)

**Interfaces:**
- Consumes: `App.taxonomy.isDone(task)` → boolean; `App.PRIORITIES` → `{ [key]: { order: number } }`
- Produces:
  - `App.QuickBoard.bySegment(tasks, seg)` → filtered array; `seg` is `'open' | 'done' | 'all'`
  - `App.QuickBoard.sort(tasks)` → **new** sorted array, input not mutated
  - `App.QuickBoard.isOverdue(task, todayIso)` → boolean

- [ ] **Step 1: Write the failing test**

Create `tests/unit/quick-board-model.test.mjs`:

```js
// tests/unit/quick-board-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {
  // Mirrors js/constants.js — lower `order` sorts first.
  PRIORITIES: {
    critical: { order: 0 }, urgent: { order: 1 }, high: { order: 2 },
    medium:   { order: 3 }, low:    { order: 4 },
  },
  taxonomy: { isDone: (t) => t.status === 'done' },
};
require('../../js/views/tasklist/quickBoardModel.js');

const t = (id, over) => Object.assign(
  { id, title: id, status: 'todo', priority: 'medium', due: '2026-09-25' }, over);

test('bySegment splits open from done', () => {
  const list = [t('a'), t('b', { status: 'done' }), t('c')];
  assert.deepEqual(App.QuickBoard.bySegment(list, 'open').map(x => x.id), ['a', 'c']);
  assert.deepEqual(App.QuickBoard.bySegment(list, 'done').map(x => x.id), ['b']);
  assert.deepEqual(App.QuickBoard.bySegment(list, 'all').map(x => x.id), ['a', 'b', 'c']);
});

test('not-done sorts ahead of done regardless of priority', () => {
  const list = [
    t('doneCritical', { status: 'done', priority: 'critical' }),
    t('openLow', { priority: 'low' }),
  ];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['openLow', 'doneCritical']);
});

test('priority orders Critical to Low', () => {
  const list = [t('low', { priority: 'low' }), t('crit', { priority: 'critical' }),
                t('high', { priority: 'high' }), t('med', { priority: 'medium' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id),
    ['crit', 'high', 'med', 'low']);
});

test('equal priority falls back to due date ascending', () => {
  const list = [t('late', { due: '2026-10-05' }), t('soon', { due: '2026-09-24' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['soon', 'late']);
});

test('tasks with no due date sort after dated ones of the same priority', () => {
  const list = [t('undated', { due: '' }), t('dated', { due: '2026-12-31' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['dated', 'undated']);
});

test('sort does not mutate its input', () => {
  const list = [t('b', { priority: 'low' }), t('a', { priority: 'critical' })];
  const before = list.map(x => x.id);
  App.QuickBoard.sort(list);
  assert.deepEqual(list.map(x => x.id), before);
});

test('an unknown priority key sorts last rather than throwing', () => {
  const list = [t('weird', { priority: 'not-a-priority' }), t('low', { priority: 'low' })];
  assert.deepEqual(App.QuickBoard.sort(list).map(x => x.id), ['low', 'weird']);
});

test('isOverdue is past-due and not done', () => {
  const today = '2026-09-23';
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '2026-09-22' }), today), true);
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: today }), today), false, 'today is not overdue');
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '2026-09-24' }), today), false);
  assert.equal(App.QuickBoard.isOverdue(t('a', { due: '' }), today), false, 'no due date is not overdue');
  assert.equal(
    App.QuickBoard.isOverdue(t('a', { due: '2026-09-22', status: 'done' }), today), false,
    'a finished task is never overdue');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/quick-board-model.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `js/views/tasklist/quickBoardModel.js`:

```js
/* Ordering and segmenting for the quick board (the phone default layout).
   Pure and free of DOM so the rule from the handoff — not-done first, then
   priority, then due ascending — is pinned by unit tests rather than read off
   a rendered list. */
(function () {
  'use strict';
  window.App = window.App || {};

  const isDone = (t) => !!(App.taxonomy && App.taxonomy.isDone(t));

  // Unknown keys sort last instead of throwing: taxonomy is DB-driven and a
  // task can carry a priority that was renamed or retired.
  function priorityOrder(t) {
    const p = (App.PRIORITIES || {})[t.priority];
    return p && typeof p.order === 'number' ? p.order : Number.MAX_SAFE_INTEGER;
  }

  // Undated tasks sort after dated ones of the same priority. '' would sort
  // FIRST in a plain string compare, which would push every undated task to the
  // top of the board.
  function dueKey(t) {
    return t.due ? t.due : '￿';
  }

  function bySegment(tasks, seg) {
    const list = Array.isArray(tasks) ? tasks : [];
    if (seg === 'open') return list.filter(t => !isDone(t));
    if (seg === 'done') return list.filter(t => isDone(t));
    return list.slice();
  }

  function sort(tasks) {
    return (Array.isArray(tasks) ? tasks : []).slice().sort((a, b) => {
      const ad = isDone(a) ? 1 : 0, bd = isDone(b) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const ap = priorityOrder(a), bp = priorityOrder(b);
      if (ap !== bp) return ap - bp;
      const ak = dueKey(a), bk = dueKey(b);
      if (ak !== bk) return ak < bk ? -1 : 1;
      return 0;
    });
  }

  function isOverdue(t, todayIso) {
    if (!t || !t.due || isDone(t)) return false;
    return t.due < todayIso;
  }

  App.QuickBoard = { bySegment, sort, isOverdue };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/quick-board-model.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Register the script**

In `app.html`, beside the other `js/views/tasklist/*.js` tags, add:

```html
<script defer src="js/views/tasklist/quickBoardModel.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/tasklist/quickBoardModel.js tests/unit/quick-board-model.test.mjs app.html
git commit -m "feat(board): ordering and segment model for the quick board

Not-done first, then priority, then due ascending, with undated tasks
after dated ones and unknown priority keys sorting last rather than
throwing — taxonomy is DB-driven and keys can be retired.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sheet form model — defaults, token application and payload

The sheet's state is a plain object. Everything that turns it into something `controller.createTask` accepts is pure: applying parsed tokens, stripping them from the title, mapping the checklist onto subtasks. Building this before the DOM means the risky mapping is under test.

**Files:**
- Create: `js/views/tasksheet/formModel.js`
- Create: `tests/unit/tasksheet-form.test.mjs`
- Modify: `app.html` (add the script tag)

**Interfaces:**
- Consumes: `App.parseTaskTitle(text, ctx)` → `{ cleanTitle, patches, hits }` from `js/views/newtask/tokenParser.js`
- Produces:
  - `App.TaskSheet.form.defaults(ctx)` → form object, where `ctx` is `{ company, me, todayIso, defaultStatus, defaultType }`
  - `App.TaskSheet.form.applyTokens(form, rawTitle, parseCtx)` → `{ form, hits, cleanTitle }`, returns a **new** form
  - `App.TaskSheet.form.toPayload(form, cleanTitle)` → the object `App.validate.newTask` accepts

Form shape (the single source of truth for later tasks):

```js
{ company, whos: [id], priority, status, type, due, time,
  reminder, label, project, detail, checklist: [{ t, d }] }
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tasksheet-form.test.mjs`:

```js
// tests/unit/tasksheet-form.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/views/newtask/tokenParser.js');   // provides App.parseTaskTitle
require('../../js/views/tasksheet/formModel.js');

const F = () => App.TaskSheet.form;
const CTX = {
  company: 'roofing', me: 'abraham', todayIso: '2026-09-23',
  defaultStatus: 'todo', defaultType: 'admin',
};
const PARSE = {
  team: [{ id: 'abraham', name: 'Abraham' }, { id: 'jesus', name: 'Jesus' }],
  companies: [{ id: 'roofing', label: 'Roofing' }, { id: 'lumen', label: 'Lumen' }],
  today: '2026-09-23',
};

test('defaults assign the task to the current user', () => {
  const f = F().defaults(CTX);
  // App.validate.newTask rejects a task with no assignee, so this cannot be empty.
  assert.deepEqual(f.whos, ['abraham']);
  assert.equal(f.company, 'roofing');
  assert.equal(f.status, 'todo');
  assert.equal(f.type, 'admin');
  assert.equal(f.due, '2026-09-23');
  assert.equal(f.priority, 'medium');
  assert.deepEqual(f.checklist, []);
});

test('applyTokens fills rows and strips the tokens from the title', () => {
  const { form, cleanTitle } = F().applyTokens(
    F().defaults(CTX), 'Order drip edge @jesus #lumen !high tmrw 9a', PARSE);
  assert.equal(cleanTitle, 'Order drip edge');
  assert.deepEqual(form.whos, ['jesus']);
  assert.equal(form.company, 'lumen');
  assert.equal(form.priority, 'high');
  assert.equal(form.due, '2026-09-24');
  assert.equal(form.time, '09:00');
});

test('applyTokens does not mutate the form it was given', () => {
  const base = F().defaults(CTX);
  F().applyTokens(base, 'thing !high', PARSE);
  assert.equal(base.priority, 'medium');
});

test('tokens are recognised anywhere in the string, for voice-to-text', () => {
  const { form, cleanTitle } = F().applyTokens(
    F().defaults(CTX), '!high order the @jesus drip edge', PARSE);
  assert.equal(form.priority, 'high');
  assert.deepEqual(form.whos, ['jesus']);
  assert.equal(cleanTitle, 'order the drip edge');
});

test('an unmatched token is left in the title rather than silently eaten', () => {
  const { form, cleanTitle } = F().applyTokens(
    F().defaults(CTX), 'call @nobody about it', PARSE);
  assert.equal(cleanTitle, 'call @nobody about it');
  assert.deepEqual(form.whos, ['abraham'], 'assignee is untouched by a failed match');
});

test('toPayload maps the checklist onto subtasks', () => {
  const f = F().defaults(CTX);
  f.checklist = [{ t: 'Measure', d: false }, { t: 'Order', d: true }];
  const p = F().toPayload(f, 'Fix drip edge');
  assert.deepEqual(p.subtasks, [{ t: 'Measure', d: false }, { t: 'Order', d: true }]);
});

test('toPayload emits the keys validate.newTask reads', () => {
  const p = F().toPayload(F().defaults(CTX), 'Fix drip edge');
  assert.equal(p.title, 'Fix drip edge');
  assert.deepEqual(p.whos, ['abraham']);
  assert.equal(p.company, 'roofing');
  assert.equal(p.type, 'admin');
  assert.equal(p.status, 'todo');
  assert.equal(p.priority, 'medium');
  assert.equal(p.due, '2026-09-23');
  // validate.newTask defaults an absent label to 'roof'; send the explicit
  // "no label" key instead so a sheet with no label chosen stays unlabelled.
  assert.equal(p.label, 'none');
});

test('an empty time becomes null, not an empty string', () => {
  const f = F().defaults(CTX);
  f.time = '';
  assert.equal(F().toPayload(f, 'x').dueTime, null);
});

test('a blank checklist row is dropped', () => {
  const f = F().defaults(CTX);
  f.checklist = [{ t: '  ', d: false }, { t: 'Real step', d: false }];
  assert.deepEqual(F().toPayload(f, 'x').subtasks, [{ t: 'Real step', d: false }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/tasksheet-form.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `js/views/tasksheet/formModel.js`:

```js
/* The mobile task sheet's state, as data.
   Kept free of DOM so the two things most likely to break quietly — token
   stripping and the checklist-to-subtasks mapping — are covered by unit tests
   instead of being inferred from a rendered sheet. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  function defaults(ctx) {
    return {
      company: ctx.company,
      whos: ctx.me ? [ctx.me] : [],   // validate.newTask demands at least one
      priority: 'medium',
      status: ctx.defaultStatus || 'todo',
      type: ctx.defaultType || 'admin',
      due: ctx.todayIso,
      time: '',
      reminder: null,
      label: 'none',
      project: null,
      detail: '',
      checklist: [],
    };
  }

  /* Re-derive the token-driven fields from the CURRENT title on every keystroke.
     Returns a new form; the caller keeps the old one until it decides to swap,
     so a half-typed "@je" never clobbers a row the user set by hand. */
  function applyTokens(form, rawTitle, parseCtx) {
    const parsed = App.parseTaskTitle(String(rawTitle || ''), parseCtx);
    const next = Object.assign({}, form, { whos: form.whos.slice(), checklist: form.checklist.slice() });
    const p = parsed.patches || {};
    if (p.company) next.company = p.company;
    if (p.pri) next.priority = p.pri;
    if (p.date) next.due = p.date;
    if (p.time) next.time = p.time;
    if (p.addWhos && p.addWhos.length) next.whos = p.addWhos.slice();
    return { form: next, hits: parsed.hits || [], cleanTitle: parsed.cleanTitle };
  }

  function toPayload(form, cleanTitle) {
    return {
      title: cleanTitle,
      description: form.detail || '',
      whos: form.whos.slice(),
      type: form.type,
      // '' would make validate.newTask substitute 'roof'; 'none' is the explicit
      // "no label" key from App.TASK_LABELS.
      label: form.label || 'none',
      company: form.company,
      due: form.due,
      dueTime: form.time || null,
      priority: form.priority,
      status: form.status,
      project: form.project || null,
      reminderOffset: form.reminder || null,
      watchers: [],                               // desktop-only in v1
      subtasks: (form.checklist || [])
        .filter(s => String(s.t || '').trim())
        .map(s => ({ t: String(s.t).trim(), d: !!s.d })),
    };
  }

  TS.form = { defaults, applyTokens, toPayload };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/tasksheet-form.test.mjs`
Expected: PASS, 9 tests.

Then: `npm run test:unit`
Expected: PASS, all suites.

- [ ] **Step 5: Register the script**

In `app.html`, after the `tokenParser.js` tag (it depends on `App.parseTaskTitle`):

```html
<script defer src="js/views/tasksheet/formModel.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/views/tasksheet/formModel.js tests/unit/tasksheet-form.test.mjs app.html
git commit -m "feat(tasksheet): form state, token application and payload mapping

Pure model for the mobile sheet. Tokens re-derive from the current title
on each keystroke and return a new form rather than mutating, and the
checklist maps onto the app's subtasks so steps added on a phone show up
on desktop instead of becoming a parallel list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Quick board layout adapter

Renders the handoff's board. Registered as `App.TaskListLayouts.quick`, so `TaskListView` dispatches to it exactly as it does the six existing adapters — filtering, permissions and per-person visibility keep working with no special cases.

**Files:**
- Create: `js/views/tasklist/QuickBoardLayout.js`
- Create: `css/quickboard.css`
- Modify: `js/utils.js` (promote the duplicated company-colour helper)
- Modify: `app.html` (script tag, stylesheet link, and the `#layoutSwitcher` button)
- Test: `tests/quick-board.spec.js` (create)

**Interfaces:**
- Consumes: `App.QuickBoard.{bySegment,sort,isOverdue}`; `App.utils.{escapeHtml,formatDue,formatClock,avatarHtml,todayISO,makeActivatable}`; `App.directory.person(id)`; `App.taxonomy.{isDone,typeLabel}`; `App.PRIORITIES`; `App.COMPANIES`; `App.can(perm)`; `view.body`, `view.controller`, `view._renderEmpty(view._emptyConfig())`
- Produces (also used by Task 8): `App.utils.companyColor(companyId)` → hex string
- Produces: `App.TaskListLayouts.quick = { render(view, tasks), mount(view), unmount(view) }`; board segment state on `view.controller.uiState.quickSeg` (`'open' | 'done' | 'all'`, default `'open'`)

- [ ] **Step 1: Write the failing test**

Create `tests/quick-board.spec.js`:

```js
// @ts-check
/* The quick board is the phone default layout and carries Abraham's approved
   v2 design: an Open/Done/All segment, company chips, and flat cards sorted
   not-done -> priority -> due. Runs in preview mode, so no Supabase creds. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
  await expect(page.locator('.qb-card').first()).toBeVisible();
});

test('the board renders a flat list of cards, not grouped rows', async ({ page }) => {
  await expect(page.locator('.qb-board')).toBeVisible();
  expect(await page.locator('.qb-card').count()).toBeGreaterThan(0);
  await expect(page.locator('.qt-group')).toHaveCount(0);
});

test('every card carries the v2 furniture', async ({ page }) => {
  const card = page.locator('.qb-card').first();
  await expect(card.locator('.qb-check')).toBeVisible();
  await expect(card.locator('.qb-title')).toBeVisible();
  await expect(card.locator('.qb-pill-priority')).toBeVisible();
  await expect(card.locator('.qb-pill-company')).toBeVisible();
});

test('the segment filters open and done', async ({ page }) => {
  const openCount = await page.locator('.qb-card').count();
  await page.locator('.qb-seg button[data-seg="done"]').click();
  await expect(page.locator('.qb-card.is-done').first().or(page.locator('.empty-state'))).toBeVisible();

  await page.locator('.qb-seg button[data-seg="all"]').click();
  expect(await page.locator('.qb-card').count()).toBeGreaterThanOrEqual(openCount);
});

test('done cards are struck through and dimmed', async ({ page }) => {
  await page.locator('.qb-seg button[data-seg="all"]').click();
  const done = page.locator('.qb-card.is-done').first();
  if (await done.count()) {
    await expect(done.locator('.qb-title')).toHaveCSS('text-decoration-line', 'line-through');
  }
});

test('an overdue card flags its due pill', async ({ page }) => {
  await page.locator('.qb-seg button[data-seg="all"]').click();
  const overdue = page.locator('.qb-card .qb-due.is-overdue').first();
  if (await overdue.count()) await expect(overdue).toBeVisible();
});

test('company chips filter the board', async ({ page }) => {
  const chips = page.locator('.qb-chips button');
  expect(await chips.count()).toBeGreaterThan(1);
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveClass(/is-on/);
});

test('the complete circle finishes a task', async ({ page }) => {
  const card = page.locator('.qb-card').first();
  const id = await card.getAttribute('data-id');
  await card.locator('.qb-check').click();
  await expect(page.locator(`.qb-card[data-id="${id}"].is-done`)
    .or(page.locator(`.qb-card[data-id="${id}"]`))).toHaveCount(await page.locator(`.qb-card[data-id="${id}"]`).count());
});

test('the board has no horizontal overflow at 390px', async ({ page }) => {
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(over).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm ci
npx playwright install chromium
npm run test:local -- quick-board.spec.js
```
Expected: FAIL — `setLayout('quick')` renders nothing, so `.qb-card` never appears.

- [ ] **Step 3: Promote the company-colour helper**

`NewTaskPageView._companyColor` and `ProjectsView._companyColor` are the same function twice. The board and the sheet both need it, so put it in `js/utils.js` rather than adding a third copy. Add beside the other formatters:

```js
  /* Accent colour for a company. Companies are not part of the DB taxonomy —
     their colour is a CSS accent token picked by the company's index — so this
     is NOT App.taxonomy.color, which is color(kind, company, key, type) and
     serves types, statuses and labels. Lifted out of NewTaskPageView and
     ProjectsView, which each carried a private copy. */
  companyColor(companyId) {
    const tokens = ['--accent-1', '--accent-2', '--accent-3', '--accent-4'];
    const ids = Object.keys(App.COMPANIES || {});
    const i = Math.max(0, ids.indexOf(companyId));
    try {
      return getComputedStyle(document.documentElement)
        .getPropertyValue(tokens[i % tokens.length]).trim() || '#ED4E0D';
    } catch (e) { return '#ED4E0D'; }
  },
```

Confirm the accent token names against `NewTaskPageView._accentToken` before writing this — copy whatever list it uses rather than the placeholder names above, and keep its ordering so no company changes colour.

Leave the two private copies calling through to it, so nothing changes visually:

```js
  _companyColor(companyId) { return App.utils.companyColor(companyId); }
```

- [ ] **Step 4: Write the implementation**

Create `js/views/tasklist/QuickBoardLayout.js`:

```js
/* Quick board — the phone default layout, built to Abraham's approved v2
   handoff. A flat, sorted card list with an Open/Done/All segment and company
   chips, in place of the table's grouped rows.

   Ordering and segmenting live in quickBoardModel.js so they can be unit
   tested; this file is rendering and event wiring only. Card clicks reuse the
   delegated vocabulary in TaskListView (`data-action`, `data-id`), so
   completing and opening a task need no new controller plumbing. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  const seg = (view) => view.controller.uiState.quickSeg || 'open';
  const chip = (view) => view.controller.uiState.quickCompany || 'all';

  function priorityPill(t) {
    const p = (App.PRIORITIES || {})[t.priority] || { label: t.priority, cls: 'priority-medium' };
    return `<span class="qb-pill qb-pill-priority ${p.cls}">${App.utils.escapeHtml(p.label)}</span>`;
  }

  function companyPill(t) {
    const c = (App.COMPANIES || {})[t.company] || { label: t.company };
    return `<span class="qb-pill qb-pill-company">
        <i class="qb-swatch" style="background:${App.utils.companyColor(t.company)}"></i>
        ${App.utils.escapeHtml(c.label || t.company || '')}
      </span>`;
  }

  function renderCard(view, t, todayIso) {
    const done = App.taxonomy.isDone(t);
    const person = App.directory.person(t.assignee) ||
      { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const due = t.due ? App.utils.formatDue(t.due) : null;
    const overdue = App.QuickBoard.isOverdue(t, todayIso);
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subDone = subs.filter(s => s.d).length;
    const pct = subs.length ? Math.round((subDone / subs.length) * 100) : 0;

    const card = document.createElement('article');
    card.className = 'qb-card' + (done ? ' is-done' : '') + (t._flash ? ' is-new' : '');
    card.dataset.id = t.id;
    card.innerHTML = `
      <button class="qb-check ${done ? 'is-done' : ''} ${App.can('tasks.write') ? '' : 'hidden'}"
              data-action="finish-task" type="button"
              aria-label="${done ? 'Mark as not done' : 'Mark done'}">
        <i class="ti ${done ? 'ti-circle-check-filled' : 'ti-circle'}"></i>
      </button>
      <div class="qb-body">
        <h3 class="qb-title">${App.utils.escapeHtml(t.title)}</h3>
        <div class="qb-meta">
          ${priorityPill(t)}
          ${companyPill(t)}
          <span class="qb-pill qb-pill-who">${App.utils.avatarHtml(person)}<span>${App.utils.escapeHtml(person.name)}</span></span>
          ${due ? `<span class="qb-pill qb-due ${overdue ? 'is-overdue' : ''}">${App.utils.escapeHtml(due.text)}${t.dueTime ? ' ' + App.utils.escapeHtml(App.utils.formatClock(t.dueTime)) : ''}</span>` : ''}
        </div>
        ${subs.length ? `
        <div class="qb-progress" aria-label="${subDone} of ${subs.length} steps done">
          <span class="qb-progress-n">${subDone}/${subs.length}</span>
          <span class="qb-progress-track"><span class="qb-progress-fill" style="width:${pct}%"></span></span>
        </div>` : ''}
        ${t.description ? `<p class="qb-detail">${App.utils.escapeHtml(t.description)}</p>` : ''}
      </div>`;
    App.utils.makeActivatable(card, null, `Open task: ${t.title}`);
    return card;
  }

  function renderControls(view) {
    const wrap = document.createElement('div');
    wrap.className = 'qb-controls';
    const segs = [['open', 'Open'], ['done', 'Done'], ['all', 'All']];
    const companies = [['all', 'All']].concat(
      Object.values(App.COMPANIES || {}).map(c => [c.id, c.label]));
    wrap.innerHTML = `
      <div class="qb-seg" role="tablist" aria-label="Task segment">
        ${segs.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}"
           aria-selected="${seg(view) === k}" class="${seg(view) === k ? 'is-on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="qb-chips" role="group" aria-label="Filter by company">
        ${companies.map(([id, label]) => `<button type="button" data-company="${id}"
           class="${chip(view) === id ? 'is-on' : ''}">
           ${id === 'all' ? '' : `<i class="qb-swatch" style="background:${App.utils.companyColor(id)}"></i>`}
           ${App.utils.escapeHtml(label || id)}</button>`).join('')}
      </div>`;

    // Bound here, not in TaskListView's delegated handler: those are row actions
    // keyed on [data-id], and these controls sit outside any card.
    wrap.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      view.controller.uiState.quickSeg = b.dataset.seg;
      view.renderList();
    }));
    wrap.querySelectorAll('[data-company]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      view.controller.uiState.quickCompany = b.dataset.company;
      view.renderList();
    }));
    return wrap;
  }

  layouts.quick = {
    mount(view) { view.body.classList.add('qb-mounted'); },
    unmount(view) { view.body.classList.remove('qb-mounted'); },

    render(view, tasks) {
      view.body.className = 'qb-board qb-mounted';
      view.body.innerHTML = '';
      // The table's column header means nothing here, the same way cards and
      // kanban drop it.
      const listHeader = document.querySelector('#taskViewWrap .list-header');
      if (listHeader) listHeader.classList.add('hidden');

      view.body.appendChild(renderControls(view));

      const todayIso = App.utils.todayISO(0);
      const company = chip(view);
      let list = App.QuickBoard.bySegment(tasks, seg(view));
      if (company !== 'all') list = list.filter(t => t.company === company);
      list = App.QuickBoard.sort(list);

      if (!list.length) { view._renderEmpty(view._emptyConfig()); return; }

      const frag = document.createDocumentFragment();
      list.forEach(t => frag.appendChild(renderCard(view, t, todayIso)));
      const listEl = document.createElement('div');
      listEl.className = 'qb-list';
      listEl.appendChild(frag);
      view.body.appendChild(listEl);
    },
  };
})();
```

Create `css/quickboard.css`:

```css
/* Quick board — the phone default layout (Abraham's v2 handoff).
   Built on the app's semantic tokens, NOT the handoff's fixed light hex, so
   the board survives the dark theme (tokens.css defaults to dark). */

.qb-board { display: block; padding: 0 0 calc(var(--m-navh, 58px) + 28px); }

/* ---- controls ---- */
.qb-controls { padding: 4px 0 10px; }

.qb-seg {
  display: flex; gap: 2px; margin-bottom: 10px;
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius-pill); padding: 3px;
}
.qb-seg button {
  flex: 1; border: 0; background: none; cursor: pointer;
  font: 600 13px/1 var(--font-body, inherit); color: var(--ink-2);
  padding: 8px 0; border-radius: var(--radius-pill);
  min-height: 34px;
}
.qb-seg button.is-on { background: var(--color-accent); color: var(--color-accent-ink); }

/* One horizontal strip, like the existing mobile pill row — never wraps. */
.qb-chips {
  display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
  -webkit-overflow-scrolling: touch; padding-bottom: 2px;
}
.qb-chips::-webkit-scrollbar { display: none; }
.qb-chips button {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border); background: var(--surface); color: var(--ink-2);
  border-radius: var(--radius-pill); padding: 7px 13px; min-height: 34px;
  font: 600 12.5px/1 var(--font-body, inherit); cursor: pointer; white-space: nowrap;
}
.qb-chips button.is-on { border-color: var(--color-accent); color: var(--ink); background: var(--bg-3); }

.qb-swatch { width: 8px; height: 8px; border-radius: 3px; display: inline-block; flex: none; }

/* ---- cards ---- */
.qb-list { display: flex; flex-direction: column; gap: 8px; }

.qb-card {
  display: flex; gap: 10px; align-items: flex-start;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px; padding: 12px; cursor: pointer;
}
.qb-card.is-done { opacity: .55; }
.qb-card.is-done .qb-title { text-decoration: line-through; }

.qb-check {
  flex: none; width: 26px; height: 26px; padding: 0; margin-top: 1px;
  border: 0; background: none; color: var(--ink-3); cursor: pointer;
  display: grid; place-items: center;
}
.qb-check i { font-size: 22px; }
.qb-check.is-done { color: var(--green); }
.qb-check.hidden { display: none; }

.qb-body { flex: 1 1 auto; min-width: 0; }
.qb-title {
  font: 600 14.5px/1.3 var(--font-body, inherit); color: var(--ink);
  margin: 0 0 7px; overflow-wrap: anywhere;
}

.qb-meta { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.qb-pill {
  display: inline-flex; align-items: center; gap: 5px;
  border-radius: var(--radius-pill); padding: 3px 9px;
  font: 600 11px/1.4 var(--font-mono, monospace);
  background: var(--bg-2); color: var(--ink-2); border: 1px solid var(--border);
}
.qb-pill-priority { border-color: transparent; }
.qb-due.is-overdue { color: var(--red, #D92D20); border-color: currentColor; }

.qb-progress { display: flex; align-items: center; gap: 7px; margin-top: 8px; }
.qb-progress-n { font: 600 10.5px/1 var(--font-mono, monospace); color: var(--ink-3); flex: none; }
.qb-progress-track {
  flex: 1 1 auto; height: 4px; border-radius: var(--radius-pill);
  background: var(--bg-3); overflow: hidden;
}
.qb-progress-fill { display: block; height: 100%; background: var(--green); }

.qb-detail {
  margin: 7px 0 0; color: var(--ink-3);
  font: 400 12.5px/1.4 var(--font-body, inherit);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* A new card announces itself, then settles. */
.qb-card.is-new { animation: qb-pulse 1.2s ease-out 1; }
@keyframes qb-pulse {
  0%, 60% { border-color: var(--color-accent); }
  100%    { border-color: var(--border); }
}
@media (prefers-reduced-motion: reduce) {
  .qb-card.is-new { animation: none; }
}
```

- [ ] **Step 5: Register the layout**

In `app.html`:

```html
<link rel="stylesheet" href="css/quickboard.css">
```

```html
<script defer src="js/views/tasklist/QuickBoardLayout.js"></script>
```

And add a button to `#layoutSwitcher`, matching the markup of the buttons already there:

```html
<button data-layout="quick" title="Quick board" aria-label="Quick board"><i class="ti ti-layout-list"></i></button>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:local -- quick-board.spec.js`
Expected: PASS, 8 tests.

Then: `npm run test:unit`
Expected: PASS — no unit test should have been disturbed.

- [ ] **Step 7: Verify it visually**

```bash
node tools/dev-server.mjs &
```

Screenshot `http://localhost:4173/app.html?preview=1#/tasks` at 390×844 with the quick layout selected, and compare against `quest-hq-mobile-handoff-v2/reference-app.html`. Check in both themes — toggle with `document.documentElement.setAttribute('data-theme','dark')`.

- [ ] **Step 8: Commit**

```bash
git add js/views/tasklist/QuickBoardLayout.js css/quickboard.css app.html tests/quick-board.spec.js
git commit -m "feat(board): quick board layout from the v2 handoff

A flat sorted card list with an Open/Done/All segment and company chips,
registered as a layout adapter so filtering, permissions and per-person
visibility keep working unchanged. Styled on the app's semantic tokens
rather than the handoff's fixed light palette, so it survives dark mode.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Make the quick board the phone default

Three controller edits. The trap here is `AppController.js:254`, which force-switches the layout to `table` whenever the view becomes `all` — without changing it, navigating to All tasks throws the user off the quick board every time.

**Files:**
- Modify: `js/controllers/AppController.js` (~line 254, ~line 487, and the UI-state restore near line 330)
- Test: `tests/quick-board-default.spec.js` (create)

**Interfaces:**
- Consumes: `App.TaskListLayouts.quick` from Task 5
- Produces: `controller.uiState.layout === 'quick'` on phones when nothing else was chosen

- [ ] **Step 1: Write the failing test**

Create `tests/quick-board-default.spec.js`:

```js
// @ts-check
/* The quick board is the phone DEFAULT, not a lock: it is chosen when nothing
   else was, and an explicit choice from the layout switcher must survive. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

test('a phone lands on the quick board without being asked', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => App.controller.setView('all'));
  await expect(page.locator('.qb-board')).toBeVisible();
});

test('navigating to All tasks does not knock the phone back to the table', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { App.controller.setView('today'); App.controller.setView('all'); });
  // AppController forced layout='table' on the `all` view; that must no longer
  // fire for a layout that can render it.
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('quick');
  await expect(page.locator('.qb-board')).toBeVisible();
});

test('an explicit layout choice on a phone survives', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('table');

  await page.reload();
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('table');
});

test('desktop is untouched — it still defaults to the table', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => App.controller.setView('all'));
  expect(await page.evaluate(() => App.controller.uiState.layout)).toBe('table');
  await expect(page.locator('.qb-board')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:local -- quick-board-default.spec.js`
Expected: FAIL — the phone lands on `table`.

- [ ] **Step 3: Write the implementation**

**3a.** Near the top of `AppController`, add the helper and the layout set:

```js
  // Matches js/views/SidebarView.js:128 — one breakpoint for the whole app.
  _isPhone() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
  }
```

**3b.** Replace the force at line 254:

```js
    // Was: if (view === 'all' && this.uiState.layout !== 'table') patch.layout = 'table';
    // The force exists because some layouts cannot render the unscoped `all`
    // view. The quick board can, so forcing here would throw a phone user off
    // the default layout on every trip to All tasks.
    const rendersAll = { table: 1, quick: 1 };
    if (view === 'all' && !rendersAll[this.uiState.layout]) patch.layout = 'table';
```

**3c.** Widen the route-param whitelist near line 487:

```js
            this.setLayout(['table', 'calendar', 'kanban', 'cards', 'quick'].includes(a) ? a : 'table');
```

**3d.** Where saved UI state is restored (near line 330), choose the phone default only when nothing was stored. An explicit choice is stored and therefore honoured:

```js
    // Phones open on the quick board unless the user has picked something else.
    // A stored layout is an explicit choice and always wins.
    if (!saved || !saved.layout) {
      if (this._isPhone()) this.uiState.layout = 'quick';
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:local -- quick-board-default.spec.js`
Expected: PASS, 4 tests.

Then the wider regression set, because line 254 is shared:
Run: `npm run test:local -- tasks.spec.js responsive.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/controllers/AppController.js tests/quick-board-default.spec.js
git commit -m "feat(board): default phones to the quick board

Also narrows the layout force on the 'all' view: it existed for layouts
that cannot render an unscoped list, and was knocking phone users off
the default layout on every trip to All tasks. An explicitly chosen
layout is stored and still wins. Desktop behaviour is unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Sheet shell — open, close, modes, footer

The sheet chrome only. Field rows, trays and the checklist arrive in Tasks 8 and 9; this task proves the sheet opens from the bottom nav's ⊕, traps and restores focus, closes three ways, and shows the right footer for each mode.

**Files:**
- Create: `js/views/TaskSheetView.js`
- Create: `css/tasksheet.css`
- Modify: `app.html` (script tag + stylesheet link)
- Modify: `js/controllers/AppController.js` (`openNewTaskPage`)
- Test: `tests/task-sheet.spec.js` (create)

**Interfaces:**
- Consumes: `App.Menu.open({ present:'sheet', className, build, onClose })` → `{ el, close }`; `App.TaskSheet.form.defaults(ctx)`; `controller._isPhone()` from Task 6
- Produces:
  - `App.TaskSheetView` — class, `new App.TaskSheetView({ controller })`
  - `.openNew(prefill)` / `.openEdit(taskId)` / `.close()`
  - Root element class `.task-sheet` (**not** `.quick-sheet` — that class is the existing quick-actions sheet and its styles would collide)

- [ ] **Step 1: Write the failing test**

Create `tests/task-sheet.spec.js`:

```js
// @ts-check
/* The mobile task sheet's shell: how it opens, how it closes, and which
   footer each mode shows. Fields and trays are covered separately. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
});

test('the bottom nav plus opens the sheet, not the full page', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('#newTaskWrap')).toBeHidden();
});

test('new mode is labelled and autofocuses the title', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('NEW TASK');
  await expect(page.locator('.task-sheet .ts-title-in')).toBeFocused();
});

test('new mode footer offers Add task and Save + Another', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet .ts-save')).toHaveText(/Add task/i);
  await expect(page.locator('.task-sheet .ts-save-another')).toBeVisible();
  await expect(page.locator('.task-sheet .ts-delete')).toHaveCount(0);
});

test('edit mode swaps the label and the footer', async ({ page }) => {
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
  await expect(page.locator('.qb-card').first()).toBeVisible();
  await page.locator('.qb-card').first().click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('EDIT TASK');
  await expect(page.locator('.task-sheet .ts-save')).toHaveText(/Save changes/i);
  await expect(page.locator('.task-sheet .ts-delete')).toBeVisible();
  await expect(page.locator('.task-sheet .ts-open-full')).toBeVisible();
});

test('the close button dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await page.locator('.task-sheet .ts-close').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('tapping the scrim dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await page.locator('.quick-sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('Escape dismisses the sheet', async ({ page }) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});

test('an empty title refuses to save without an alert dialog', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await page.locator('#bottomNav [data-key="new"]').click();
  await page.locator('.task-sheet .ts-save').click();
  await expect(page.locator('.task-sheet')).toBeVisible();          // stays open
  await expect(page.locator('.task-sheet .ts-title-in')).toBeFocused();
  expect(dialog).toBe(false);
});

test('desktop still opens the full New Task page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => App.controller.openNewTaskPage());
  await expect(page.locator('#newTaskWrap')).toBeVisible();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:local -- task-sheet.spec.js`
Expected: FAIL — `.task-sheet` never appears.

- [ ] **Step 3: Write the implementation**

Create `js/views/TaskSheetView.js`:

```js
/* Mobile task sheet — Abraham's approved v2 quick add.
   One component, two modes: NEW TASK and EDIT TASK.

   Built on App.Menu's existing 'sheet' presentation, which already owns the
   scrim, Escape, click-away and focus return. NOTE: App.Menu keeps only ONE
   menu open at a time and closes the previous one — so the picker trays added
   in Task 8 are panels inside this element, never App.Menu calls. Opening a
   tray with App.Menu would close the sheet. */
(function () {
  'use strict';
  window.App = window.App || {};

  App.TaskSheetView = class TaskSheetView {
    constructor({ controller }) {
      this.controller = controller;
      this.handle = null;
      this.mode = 'new';
      this.taskId = null;
      this.form = null;
    }

    get isOpen() { return !!this.handle; }

    _ctx() {
      return {
        company: this.controller.uiState.company || Object.keys(App.COMPANIES || {})[0],
        me: this.controller.currentUser,
        todayIso: App.utils.todayISO(0),
        defaultStatus: App.taxonomy.defaultStatus ? App.taxonomy.defaultStatus() : 'todo',
        defaultType: Object.keys(App.TASK_TYPES || { admin: 1 })[0],
      };
    }

    openNew(prefill) {
      this.mode = 'new';
      this.taskId = null;
      this.form = Object.assign(App.TaskSheet.form.defaults(this._ctx()), prefill || {});
      this._open();
    }

    openEdit(taskId) {
      const t = this.controller.taskById ? this.controller.taskById(taskId) : null;
      if (!t) return;
      this.mode = 'edit';
      this.taskId = taskId;
      this.form = Object.assign(App.TaskSheet.form.defaults(this._ctx()), {
        company: t.company,
        whos: (t.assigneeIds && t.assigneeIds.length) ? t.assigneeIds.slice() : [t.assignee],
        priority: t.priority, status: t.status, type: t.type,
        due: t.due || '', time: t.dueTime || '',
        label: t.label || 'none', project: t.project || null,
        detail: t.description || '',
        checklist: (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => ({ t: s.t, d: !!s.d })),
      });
      this._titleValue = t.title || '';
      this._open();
    }

    close() { if (this.handle) this.handle.close('api'); }

    _open() {
      if (this.handle) this.handle.close('reopen');
      this.handle = App.Menu.open({
        present: 'sheet',
        className: 'task-sheet',
        onClose: () => { this.handle = null; },
        build: (el) => {
          el.setAttribute('aria-label', this.mode === 'edit' ? 'Edit task' : 'New task');
          el.innerHTML = this._html();
          this._bind(el);
          // Focus after the sheet is in the document, or iOS drops the keyboard.
          const input = el.querySelector('.ts-title-in');
          if (input) setTimeout(() => input.focus(), 50);
        },
      });
    }

    _html() {
      const editing = this.mode === 'edit';
      return `
        <div class="ts-grab" aria-hidden="true"></div>
        <header class="ts-head">
          <span class="ts-label">${editing ? 'EDIT TASK' : 'NEW TASK'}</span>
          <button class="ts-close" type="button" aria-label="Close">
            <i class="ti ti-x"></i>
          </button>
        </header>
        <div class="ts-body">
          <input class="ts-title-in" type="text" autocomplete="off" enterkeyhint="done"
                 placeholder="What needs to get done?" aria-label="Task title"
                 value="${App.utils.escapeHtml(this._titleValue || '')}">
          <p class="ts-hint">type <b>@name</b> <b>#company</b> <b>!high</b> <b>tmrw</b> <b>9:30a</b> — rows fill live</p>
          <div class="ts-rows" data-rows></div>
          ${editing ? '<button class="ts-open-full" type="button">Open full task</button>' : ''}
        </div>
        <div class="ts-tray" data-tray hidden></div>
        <footer class="ts-foot">
          ${editing
            ? `<button class="ts-delete" type="button" aria-label="Delete task"><i class="ti ti-trash"></i></button>
               <button class="ts-save btn btn-primary" type="button">Save changes</button>`
            : `<button class="ts-save-another" type="button">SAVE +<br>ANOTHER</button>
               <button class="ts-save btn btn-primary" type="button">Add task</button>`}
        </footer>`;
    }

    _bind(el) {
      el.querySelector('.ts-close').addEventListener('click', () => this.close());
      el.querySelector('.ts-save').addEventListener('click', () => this._save(false));
      const another = el.querySelector('.ts-save-another');
      if (another) another.addEventListener('click', () => this._save(true));
      const del = el.querySelector('.ts-delete');
      if (del) del.addEventListener('click', () => {
        this.controller.deleteTask(this.taskId);
        this.close();
      });
      const full = el.querySelector('.ts-open-full');
      if (full) full.addEventListener('click', () => {
        const id = this.taskId;
        this.close();
        this.controller.selectTask(id);
      });
    }

    /* Validation is inline: focus the title and swap the placeholder. The
       handoff is explicit that there are no alert dialogs. */
    _rejectEmptyTitle(el) {
      const input = el.querySelector('.ts-title-in');
      input.classList.add('is-invalid');
      input.placeholder = 'A title is required';
      input.focus();
      setTimeout(() => input.classList.remove('is-invalid'), 1200);
    }

    _save(keepOpen) {
      const el = this.handle && this.handle.el;
      if (!el) return;
      const raw = el.querySelector('.ts-title-in').value || '';
      const applied = App.TaskSheet.form.applyTokens(this.form, raw, this._parseCtx(true));
      if (!applied.cleanTitle.trim()) { this._rejectEmptyTitle(el); return; }
      // Task 10 wires the real create/update calls here.
      this._commit(applied, keepOpen);
    }

    /* atEnd decides whether the FINAL token counts as complete.
       false while typing: "9a" on the way to "9am" must not resolve and vanish
       under the cursor. true on save: the last token is finished by definition,
       and without it every saved title keeps its trailing token. This mirrors
       NewTaskPageView.submit(), which calls _applyParse(true). */
    _parseCtx(atEnd) {
      return {
        team: App.utils.peopleInCompany(this.form.company, this.controller.currentUser)
          .map(p => ({ id: p.id, name: p.name })),
        companies: Object.values(App.COMPANIES || {}).map(c => ({ id: c.id, label: c.label })),
        today: App.utils.todayISO(0),
        atEnd: !!atEnd,
      };
    }

    _commit() { /* Task 10 */ }
  };
})();
```

Create `css/tasksheet.css`:

```css
/* Mobile task sheet (v2 handoff). Rides App.Menu's .quick-sheet-backdrop for
   the scrim; everything inside is scoped to .task-sheet so the existing
   quick-actions sheet is untouched.
   Semantic tokens only — the handoff's fixed light hex would break dark mode. */

.task-sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  max-height: 92dvh; display: flex; flex-direction: column;
  background: var(--surface); color: var(--ink);
  border-radius: 24px 24px 0 0;
  box-shadow: var(--shadow-lg);
  padding: 0; overflow: hidden;
  animation: ts-rise .28s cubic-bezier(.2, .8, .2, 1) 1;
}
@keyframes ts-rise { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .task-sheet { animation: none; } }

.ts-grab {
  width: 40px; height: 4px; border-radius: var(--radius-pill);
  background: var(--border-strong); margin: 10px auto 2px; flex: none;
}

.ts-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 16px 2px; flex: none;
}
.ts-label {
  font: 600 10px/1 var(--font-mono, monospace);
  letter-spacing: .14em; color: var(--ink-3);
}
.ts-close {
  width: 32px; height: 32px; border-radius: 50%; border: 0;
  background: var(--bg-2); color: var(--ink-2); cursor: pointer;
  display: grid; place-items: center;
}

/* The body is the only scrolling region: tray and footer stay put. */
.ts-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 16px 12px; -webkit-overflow-scrolling: touch; }

.ts-title-in {
  width: 100%; border: 0; background: none; color: var(--ink);
  font: 700 21px/1.25 var(--font-body, inherit);
  padding: 6px 0 2px; outline: none;
}
.ts-title-in::placeholder { color: var(--ink-3); }
.ts-title-in.is-invalid::placeholder { color: var(--red, #D92D20); }

.ts-hint {
  margin: 2px 0 12px; color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-mono, monospace);
}
.ts-hint b {
  font-weight: 600; color: var(--color-accent);
  background: var(--bg-3); border-radius: 4px; padding: 1px 4px;
}

.ts-open-full {
  display: block; width: 100%; margin-top: 14px; padding: 11px;
  border: 1px solid var(--border); border-radius: 12px;
  background: none; color: var(--ink-2); cursor: pointer;
  font: 600 12.5px/1 var(--font-body, inherit);
}

.ts-foot {
  flex: none; display: flex; gap: 8px; align-items: stretch;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border); background: var(--surface);
}
.ts-save { flex: 1 1 auto; min-height: 50px; font-size: 15px; }
.ts-save-another {
  flex: 0 0 auto; border: 1px solid var(--border); border-radius: 12px;
  background: none; color: var(--ink-2); cursor: pointer; padding: 8px 12px;
  font: 600 9px/1.35 var(--font-mono, monospace); letter-spacing: .08em;
}
.ts-delete {
  flex: 0 0 auto; width: 50px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg-2);
  color: var(--red, #D92D20); display: grid; place-items: center;
}
```

- [ ] **Step 4: Fork `openNewTaskPage`**

In `js/controllers/AppController.js`, at the top of `openNewTaskPage(prefill)` (~line 2174) — this is the single seam the ⊕, the keyboard shortcut and the `#/new` route all already call, so one fork covers every entry point:

```js
  openNewTaskPage(prefill) {
    // Phones get the bottom sheet; the full page stays the desktop experience.
    if (this._isPhone()) {
      if (!this._taskSheet) this._taskSheet = new App.TaskSheetView({ controller: this });
      this._taskSheet.openNew(prefill);
      return;
    }
    // ... existing body unchanged
```

- [ ] **Step 5: Register the assets**

In `app.html`:

```html
<link rel="stylesheet" href="css/tasksheet.css">
```

```html
<script defer src="js/views/TaskSheetView.js"></script>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:local -- task-sheet.spec.js`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add js/views/TaskSheetView.js css/tasksheet.css app.html js/controllers/AppController.js tests/task-sheet.spec.js
git commit -m "feat(tasksheet): bottom sheet shell with new and edit modes

Built on App.Menu's existing sheet presentation, so scrim, Escape,
click-away and focus return come for free. openNewTaskPage forks to the
sheet below 720px, which covers the bottom-nav plus, the keyboard
shortcut and the #/new route in one place. Desktop keeps the full page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Field rows and picker trays

The heart of the design: seven always-visible rows, each a full-width tap target that opens a tray in the thumb zone. Status options must re-derive whenever company or type changes, because `js/taxonomy.js` scopes statuses **per company and per type**.

**Files:**
- Create: `js/views/tasksheet/rows.js`
- Create: `js/views/tasksheet/trays.js`
- Modify: `js/views/TaskSheetView.js` (render rows, open trays, live token parsing)
- Modify: `css/tasksheet.css` (row and tray styles)
- Modify: `app.html` (two script tags)
- Test: `tests/task-sheet-fields.spec.js` (create)

**Interfaces:**
- Consumes: `App.TaskSheet.dates.{quickPicks,timePicks}`; `App.taxonomy.{activeTypes,activeStatuses,activeLabels,typeLabel,statusLabel,color}`; `App.COMPANIES`; `App.directory.people()`; `App.PRIORITIES`
- Produces:
  - `App.TaskSheet.rows.render(form, ctx)` → HTML string for the seven core rows plus the collapsed group
  - `App.TaskSheet.rows.update(el, field, { label, swatch, muted })` → void
  - `App.TaskSheet.trays.build(field, form, ctx)` → `{ title, html, bind(el, onPick) }`
  - Tray option elements carry `data-value`; the priority tray is a segmented bar that stays open, every other tray closes on pick

- [ ] **Step 1: Write the failing test**

Create `tests/task-sheet-fields.spec.js`:

```js
// @ts-check
/* Field rows and picker trays. The important one is the taxonomy test: the app
   scopes statuses per company AND per type, so a fixed option list would offer
   statuses that do not exist for the selected type. */
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };
const ROWS = ['company', 'assignee', 'priority', 'status', 'type', 'due', 'time'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
});

test('all seven core rows are present and visible without scrolling', async ({ page }) => {
  for (const f of ROWS) await expect(page.locator(`.ts-row[data-field="${f}"]`)).toBeVisible();

  // The whole point of the redesign: no scroll to reach the last row.
  const fits = await page.evaluate(() => {
    const last = document.querySelector('.ts-row[data-field="time"]');
    const foot = document.querySelector('.ts-foot');
    return last.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top + 1;
  });
  expect(fits).toBe(true);
});

test('tapping a row opens a tray and marks the row active', async ({ page }) => {
  await page.locator('.ts-row[data-field="type"]').click();
  await expect(page.locator('.ts-tray')).toBeVisible();
  await expect(page.locator('.ts-row[data-field="type"]')).toHaveClass(/is-open/);
});

test('picking an option updates the row and closes the tray', async ({ page }) => {
  await page.locator('.ts-row[data-field="type"]').click();
  const option = page.locator('.ts-tray [data-value]').nth(1);
  const label = (await option.innerText()).trim();
  await option.click();
  await expect(page.locator('.ts-tray')).toBeHidden();
  await expect(page.locator('.ts-row[data-field="type"] .ts-val')).toContainText(label);
});

test('the priority bar offers four segments, not five', async ({ page }) => {
  await page.locator('.ts-row[data-field="priority"]').click();
  // App.PRIORITIES has five keys, but 'urgent' is deliberately not offered on
  // the create path (NewTaskPageView._priList, "pro1 v1-FINAL"), and the
  // handoff's bar is four wide. Building the tray from Object.keys would
  // silently reverse that.
  await expect(page.locator('.ts-tray .ts-seg [data-value]')).toHaveCount(4);
  const labels = (await page.locator('.ts-tray .ts-seg [data-value]').allInnerTexts())
    .map(s => s.trim().toLowerCase());
  expect(labels.some(l => /urgent/.test(l))).toBe(false);
});

test('the priority tray is a segmented bar that stays open', async ({ page }) => {
  await page.locator('.ts-row[data-field="priority"]').click();
  await expect(page.locator('.ts-tray .ts-seg')).toBeVisible();
  await page.locator('.ts-tray .ts-seg [data-value]').first().click();
  await expect(page.locator('.ts-tray')).toBeVisible();          // stays open
  await page.locator('.ts-tray .ts-tray-done').click();
  await expect(page.locator('.ts-tray')).toBeHidden();
});

test('the due tray offers the quick picks plus a date input', async ({ page }) => {
  await page.locator('.ts-row[data-field="due"]').click();
  const labels = await page.locator('.ts-tray [data-value]').allInnerTexts();
  expect(labels[0].trim()).toBe('Today');
  expect(labels[1].trim()).toBe('Tomorrow');
  expect(labels.some(l => /No date/i.test(l))).toBe(true);
  await expect(page.locator('.ts-tray input[type="date"]')).toBeVisible();
});

test('the time tray leads with No time', async ({ page }) => {
  await page.locator('.ts-row[data-field="time"]').click();
  await expect(page.locator('.ts-tray [data-value]').first()).toContainText('No time');
  await expect(page.locator('.ts-tray input[type="time"]')).toBeVisible();
});

test('status options come from the taxonomy, scoped to the chosen type', async ({ page }) => {
  const optionsForCurrentType = async () => {
    await page.locator('.ts-row[data-field="status"]').click();
    const v = await page.locator('.ts-tray [data-value]').allInnerTexts();
    await page.locator('.ts-tray .ts-tray-done').click();
    return v.map(s => s.trim()).sort();
  };
  const before = await optionsForCurrentType();

  // Switch type, then re-open status: the list must be re-derived, not cached.
  await page.locator('.ts-row[data-field="type"]').click();
  await page.locator('.ts-tray [data-value]').nth(1).click();
  const after = await optionsForCurrentType();

  const fromTaxonomy = await page.evaluate(() => {
    const f = App.controller._taskSheet.form;
    return App.taxonomy.activeStatuses(f.company, f.type).map(s => s.label).sort();
  });
  expect(after).toEqual(fromTaxonomy);
  expect(Array.isArray(before)).toBe(true);
});

test('typing tokens fills the rows live', async ({ page }) => {
  await page.locator('.ts-title-in').fill('Order drip edge !high tmrw 9a');
  await expect(page.locator('.ts-row[data-field="priority"] .ts-val')).toContainText(/high/i);
  await expect(page.locator('.ts-row[data-field="due"] .ts-val')).toContainText(/Tomorrow/i);
  await expect(page.locator('.ts-row[data-field="time"] .ts-val')).toContainText(/9:00/);
});

test('the collapsed group hides reminder, label and project until asked', async ({ page }) => {
  await expect(page.locator('.ts-row[data-field="reminder"]')).toBeHidden();
  await page.locator('.ts-more-toggle').click();
  for (const f of ['reminder', 'label', 'project']) {
    await expect(page.locator(`.ts-row[data-field="${f}"]`)).toBeVisible();
  }
});

test('the tray never opens as an App.Menu, which would close the sheet', async ({ page }) => {
  await page.locator('.ts-row[data-field="due"]').click();
  expect(await page.evaluate(() => App.Menu.isOpen)).toBe(true);   // the sheet itself
  await expect(page.locator('.task-sheet')).toBeVisible();          // still open
  await expect(page.locator('.ts-tray')).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:local -- task-sheet-fields.spec.js`
Expected: FAIL — no `.ts-row` elements exist.

- [ ] **Step 3: Write `rows.js`**

Create `js/views/tasksheet/rows.js`:

```js
/* Field rows for the mobile task sheet.
   Row anatomy is the handoff's and matches the QCC lead detail card: mono label
   in a fixed left column, value right-aligned with an optional leading swatch,
   caret at the end, whole row a tap target. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const CORE = [
    { field: 'company',  label: 'COMPANY' },
    { field: 'assignee', label: 'ASSIGNEE' },
    { field: 'priority', label: 'PRIORITY' },
    { field: 'status',   label: 'STATUS' },
    { field: 'type',     label: 'TYPE' },
    { field: 'due',      label: 'DUE' },
    { field: 'time',     label: 'TIME' },
  ];
  const MORE = [
    { field: 'reminder', label: 'REMINDER' },
    { field: 'label',    label: 'LABEL' },
    { field: 'project',  label: 'PROJECT' },
  ];

  // Values that mean "nothing chosen" render muted, per the handoff.
  const EMPTY = ['No time', 'None', 'No project', 'No date', 'No label'];

  function row(def, display) {
    const muted = EMPTY.indexOf(display.label) !== -1;
    return `
      <button class="ts-row" type="button" data-field="${def.field}"
              aria-label="${def.label.toLowerCase()}: ${App.utils.escapeHtml(display.label)}">
        <span class="ts-lab">${def.label}</span>
        <span class="ts-val ${muted ? 'is-empty' : ''}">
          ${display.swatch || ''}
          ${display.pill
            ? `<span class="ts-pill ${display.pillCls || ''}">${App.utils.escapeHtml(display.label)}</span>`
            : App.utils.escapeHtml(display.label)}
        </span>
        <i class="ts-car ti ti-chevron-down" aria-hidden="true"></i>
      </button>`;
  }

  function render(form, ctx) {
    const d = ctx.display;              // display(field) -> { label, swatch, pill, pillCls }
    return `
      <div class="ts-group">${CORE.map(def => row(def, d(def.field))).join('')}</div>
      <button class="ts-more-toggle" type="button" aria-expanded="false">
        <i class="ti ti-chevron-right"></i> REMINDER · LABEL · PROJECT
      </button>
      <div class="ts-group ts-more" hidden>${MORE.map(def => row(def, d(def.field))).join('')}</div>
      <label class="ts-section">
        <span class="ts-section-lab">DETAIL</span>
        <textarea class="ts-detail" rows="2"
                  placeholder="Add context, links, scope, measurements, anything…">${App.utils.escapeHtml(form.detail || '')}</textarea>
      </label>
      <div class="ts-section">
        <span class="ts-section-lab">CHECKLIST</span>
        <ul class="ts-checklist" data-checklist></ul>
        <div class="ts-check-add">
          <input class="ts-check-in" type="text" placeholder="Add a step, press +" aria-label="Add a checklist step">
          <button class="ts-check-btn btn btn-primary" type="button" aria-label="Add step">+</button>
        </div>
      </div>`;
  }

  function update(sheetEl, field, display) {
    const el = sheetEl.querySelector(`.ts-row[data-field="${field}"] .ts-val`);
    if (!el) return;
    const muted = EMPTY.indexOf(display.label) !== -1;
    el.classList.toggle('is-empty', muted);
    el.innerHTML = (display.swatch || '') + (display.pill
      ? `<span class="ts-pill ${display.pillCls || ''}">${App.utils.escapeHtml(display.label)}</span>`
      : App.utils.escapeHtml(display.label));
  }

  TS.rows = { render, update, CORE, MORE };
})();
```

- [ ] **Step 4: Write `trays.js`**

Create `js/views/tasksheet/trays.js`:

```js
/* Picker trays for the mobile task sheet.
   These are panels INSIDE the sheet, never App.Menu calls — App.Menu keeps one
   menu open at a time, so opening a tray through it would close the sheet.

   Option lists come from the live taxonomy, which is scoped per company AND per
   type: the status list is rebuilt from the CURRENT form every time the tray is
   opened, so changing the type changes the statuses on offer. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const esc = (s) => App.utils.escapeHtml(String(s == null ? '' : s));
  const swatch = (color) => `<i class="ts-swatch" style="background:${color || 'var(--ink-3)'}"></i>`;

  function chips(options, selected) {
    return `<div class="ts-opts">${options.map(o => `
      <button class="ts-opt ${o.value === selected ? 'is-on' : ''}" type="button"
              data-value="${esc(o.value)}">${o.swatch || ''}${esc(o.label)}</button>`).join('')}</div>`;
  }

  function build(field, form, ctx) {
    switch (field) {
      case 'company': {
        const opts = Object.values(App.COMPANIES || {}).map(c => ({
          value: c.id, label: c.label,
          swatch: swatch(App.utils.companyColor(c.id)),
        }));
        return { title: 'COMPANY', html: chips(opts, form.company) };
      }
      case 'assignee': {
        // Company-scoped, not the whole directory: App.directory.people()
        // returns everyone regardless of company.
        const opts = App.utils.peopleInCompany(form.company, ctx.me).map(p => ({
          value: p.id, label: p.name,
          swatch: App.utils.avatarHtml(p),
        }));
        return { title: 'ASSIGNEE', html: chips(opts, form.whos[0]) };
      }
      case 'priority': {
        // A segmented bar, not chips: selected segment fills with its own colour
        // and the tray stays open until DONE.
        //
        // FOUR segments, not five. NewTaskPageView._priList() deliberately omits
        // 'urgent' on the create path ("pro1 v1-FINAL" — it stays in the data
        // model but is not offered), and that is exactly the handoff's bar.
        // Building this from Object.keys(App.PRIORITIES) would show five and
        // reverse a deliberate product decision.
        const opts = ['low', 'medium', 'high', 'critical']
          .filter(k => (App.PRIORITIES || {})[k])
          .map(k => ({ value: k, label: App.PRIORITIES[k].label, cls: App.PRIORITIES[k].cls }));
        return {
          title: 'PRIORITY', stayOpen: true,
          html: `<div class="ts-seg">${opts.map(o => `
            <button class="ts-seg-b ${o.cls} ${o.value === form.priority ? 'is-on' : ''}"
                    type="button" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`,
        };
      }
      case 'status': {
        // Rebuilt from the CURRENT company + type every open — statuses are
        // scoped per type, so a cached list would offer impossible values.
        const opts = App.taxonomy.activeStatuses(form.company, form.type).map(s => ({
          value: s.key, label: s.label, swatch: swatch(s.color),
        }));
        return { title: 'STATUS', html: chips(opts, form.status) };
      }
      case 'type': {
        const opts = App.taxonomy.activeTypes(form.company).map(t => ({
          value: t.key, label: t.label,
        }));
        return { title: 'TYPE', html: chips(opts, form.type) };
      }
      case 'due': {
        const picks = TS.dates.quickPicks(ctx.todayIso).map(p => ({
          value: p.iso, label: p.label,
        }));
        return {
          title: 'DUE',
          html: chips(picks, form.due) +
            `<label class="ts-native"><i class="ti ti-calendar"></i>
               <input type="date" value="${esc(form.due)}" aria-label="Pick a date"></label>`,
        };
      }
      case 'time': {
        const picks = TS.dates.timePicks().map(p => ({ value: p.value, label: p.label }));
        return {
          title: 'TIME',
          html: chips(picks, form.time) +
            `<label class="ts-native"><i class="ti ti-clock"></i>
               <input type="time" value="${esc(form.time)}" aria-label="Pick a time"></label>`,
        };
      }
      case 'reminder': {
        const opts = [
          { value: '', label: 'None' }, { value: 'at', label: 'At due time' },
          { value: '1h', label: '1 hr before' }, { value: '1d', label: '1 day before' },
        ];
        return { title: 'REMINDER', html: chips(opts, form.reminder || '') };
      }
      case 'label': {
        const opts = App.taxonomy.activeLabels(form.company).map(l => ({
          value: l.key, label: l.label, swatch: swatch(l.color),
        }));
        return { title: 'LABEL', html: chips(opts, form.label) };
      }
      case 'project': {
        const list = (App.PROJECTS ? Object.values(App.PROJECTS) : []);
        const opts = [{ value: '', label: 'No project' }].concat(
          list.map(p => ({ value: p.id, label: p.name })));
        return { title: 'PROJECT', html: chips(opts, form.project || '') };
      }
      default:
        return { title: field.toUpperCase(), html: chips([], null) };
    }
  }

  TS.trays = { build };
})();
```

- [ ] **Step 5: Wire rows, trays and live parsing into `TaskSheetView`**

Replace `<div class="ts-rows" data-rows></div>` in `_html()` with `${App.TaskSheet.rows.render(this.form, { display: (f) => this._display(f) })}`, and add these methods:

```js
    /* How each field renders in its row. Kept in one place so the row and its
       tray can never disagree about a label. */
    _display(field) {
      const f = this.form;
      switch (field) {
        case 'company': {
          const c = (App.COMPANIES || {})[f.company] || { label: f.company };
          return { label: c.label || f.company,
                   swatch: `<i class="ts-swatch" style="background:${App.utils.companyColor(f.company)}"></i>` };
        }
        case 'assignee': {
          const p = App.directory.person(f.whos[0]);
          return { label: p ? p.name : 'Unassigned', swatch: p ? App.utils.avatarHtml(p) : '' };
        }
        case 'priority': {
          const p = (App.PRIORITIES || {})[f.priority] || { label: f.priority, cls: '' };
          return { label: p.label, pill: true, pillCls: p.cls };
        }
        case 'status':
          return { label: App.taxonomy.statusLabel(f.company, f.type, f.status) || f.status };
        case 'type':
          return { label: App.taxonomy.typeLabel(f.company, f.type) || f.type };
        case 'due':
          return { label: f.due ? App.utils.formatDue(f.due).text : 'No date' };
        case 'time':
          return { label: f.time ? App.utils.formatClock(f.time) : 'No time' };
        case 'reminder': {
          const m = { '': 'None', at: 'At due time', '1h': '1 hr before', '1d': '1 day before' };
          return { label: m[f.reminder || ''] || 'None' };
        }
        case 'label':
          return { label: App.taxonomy.labelLabel(f.company, f.label) || 'None' };
        case 'project': {
          const p = App.PROJECTS && f.project ? App.PROJECTS[f.project] : null;
          return { label: p ? p.name : 'No project' };
        }
        default: return { label: '' };
      }
    }

    _openTray(field) {
      const el = this.handle.el;
      const tray = el.querySelector('[data-tray]');
      const spec = App.TaskSheet.trays.build(field, this.form,
        { todayIso: App.utils.todayISO(0), me: this.controller.currentUser });

      el.querySelectorAll('.ts-row.is-open').forEach(r => r.classList.remove('is-open'));
      el.querySelector(`.ts-row[data-field="${field}"]`).classList.add('is-open');

      tray.hidden = false;
      tray.innerHTML = `
        <div class="ts-tray-head">
          <span>${App.utils.escapeHtml(spec.title)}</span>
          <button class="ts-tray-done" type="button">DONE</button>
        </div>
        ${spec.html}`;
      tray.querySelector('.ts-tray-done').addEventListener('click', () => this._closeTray());
      tray.querySelectorAll('[data-value]').forEach(b => b.addEventListener('click', () => {
        this._setField(field, b.dataset.value);
        if (!spec.stayOpen) this._closeTray();
        else {
          tray.querySelectorAll('[data-value]').forEach(x => x.classList.remove('is-on'));
          b.classList.add('is-on');
        }
      }));
      const native = tray.querySelector('input[type="date"], input[type="time"]');
      if (native) native.addEventListener('change', () => {
        this._setField(field, native.value);
        this._closeTray();
      });
    }

    _closeTray() {
      const el = this.handle && this.handle.el;
      if (!el) return;
      el.querySelector('[data-tray]').hidden = true;
      el.querySelectorAll('.ts-row.is-open').forEach(r => r.classList.remove('is-open'));
    }

    _setField(field, value) {
      const f = this.form;
      if (field === 'assignee') f.whos = [value];
      else if (field === 'due') f.due = value;
      else if (field === 'time') f.time = value;
      else f[field] = value;

      App.TaskSheet.rows.update(this.handle.el, field, this._display(field));
      // Changing company or type can invalidate the chosen status, because
      // statuses are scoped per company AND per type.
      if (field === 'company' || field === 'type') {
        const valid = App.taxonomy.activeStatuses(f.company, f.type).map(s => s.key);
        if (valid.length && valid.indexOf(f.status) === -1) {
          f.status = App.taxonomy.defaultStatus(f.company, f.type) || valid[0];
          App.TaskSheet.rows.update(this.handle.el, 'status', this._display('status'));
        }
      }
    }
```

Extend `_bind(el)` with row taps, the collapsed-group toggle, and live parsing:

```js
      el.querySelectorAll('.ts-row').forEach(r =>
        r.addEventListener('click', () => this._openTray(r.dataset.field)));

      const more = el.querySelector('.ts-more-toggle');
      more.addEventListener('click', () => {
        const group = el.querySelector('.ts-more');
        const open = group.hidden;
        group.hidden = !open;
        more.setAttribute('aria-expanded', String(open));
        more.classList.toggle('is-open', open);
        more.querySelector('i').className = 'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right');
      });

      // Rows fill live as he types — the same parser the desktop page uses, and
      // the path that makes voice-to-text entry work.
      el.querySelector('.ts-title-in').addEventListener('input', (e) => {
        const applied = App.TaskSheet.form.applyTokens(this.form, e.target.value, this._parseCtx(false));
        this.form = applied.form;
        ['company', 'assignee', 'priority', 'due', 'time'].forEach(f =>
          App.TaskSheet.rows.update(el, f, this._display(f)));
      });

      el.querySelector('.ts-detail').addEventListener('input', (e) => { this.form.detail = e.target.value; });
```

- [ ] **Step 6: Add the row and tray CSS**

Append to `css/tasksheet.css`:

```css
/* ---- field rows ---- */
.ts-group {
  border: 1.5px solid var(--border); border-radius: 16px;
  overflow: hidden; background: var(--surface);
}
.ts-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 48px; padding: 8px 12px; cursor: pointer;
  border: 0; border-bottom: 1px solid var(--border);
  background: none; color: var(--ink); text-align: left;
}
.ts-row:last-child { border-bottom: 0; }
.ts-row.is-open { background: var(--bg-3); }
.ts-lab {
  flex: 0 0 92px; color: var(--ink-3);
  font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .14em;
}
.ts-val {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center;
  justify-content: flex-end; gap: 6px;
  font: 600 14.5px/1.3 var(--font-body, inherit); text-align: right;
}
.ts-val.is-empty { color: var(--ink-3); font-weight: 500; }
.ts-car { flex: none; font-size: 13px; color: var(--ink-3); }
.ts-swatch { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; }
.ts-pill { border-radius: var(--radius-pill); padding: 3px 10px; font-size: 12px; font-weight: 700; }

.ts-more-toggle {
  display: flex; align-items: center; gap: 6px; width: 100%;
  border: 0; background: none; cursor: pointer; padding: 12px 2px 10px;
  color: var(--ink-3); font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .12em;
}
.ts-more-toggle.is-open { color: var(--color-accent); }

.ts-section { display: block; margin-top: 16px; }
.ts-section-lab {
  display: block; margin-bottom: 6px; color: var(--ink-3);
  font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .14em;
}
.ts-detail {
  width: 100%; min-height: 60px; resize: vertical; padding: 10px 12px;
  border: 1.5px solid var(--border); border-radius: 12px;
  background: var(--surface); color: var(--ink);
  font: 400 14px/1.45 var(--font-body, inherit);
}
.ts-detail:focus { outline: none; border-color: var(--color-accent); }

/* ---- trays ---- */
.ts-tray {
  flex: none; max-height: 34dvh; overflow-y: auto;
  background: var(--bg-2); border-top: 1px solid var(--border);
  padding: 10px 16px 12px;
}
.ts-tray[hidden] { display: none; }
.ts-tray-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 9px;
  font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .14em; color: var(--ink-3);
}
.ts-tray-done { border: 0; background: none; cursor: pointer; color: var(--color-accent);
  font: 600 10px/1 var(--font-mono, monospace); letter-spacing: .14em; padding: 4px; }

.ts-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.ts-opt {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1.5px solid var(--border); border-radius: 12px;
  background: var(--surface); color: var(--ink); cursor: pointer;
  padding: 11px 14px; min-height: 44px;
  font: 600 13px/1 var(--font-body, inherit);
}
.ts-opt.is-on { border-color: var(--color-accent); background: var(--bg-3); }

.ts-seg {
  display: flex; border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden;
}
.ts-seg-b {
  flex: 1; border: 0; background: var(--surface); color: var(--ink-2);
  cursor: pointer; padding: 13px 0; min-height: 46px;
  font: 700 13px/1 var(--font-body, inherit);
}
.ts-seg-b.is-on { color: var(--ink); }

.ts-native {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 8px;
  border: 1.5px solid var(--border); border-radius: 12px;
  background: var(--surface); padding: 9px 12px; min-height: 44px;
}
.ts-native input { border: 0; background: none; color: var(--ink); font: 600 13px/1 var(--font-body, inherit); }
```

- [ ] **Step 7: Register the scripts**

In `app.html`, after `js/views/tasksheet/dates.js` and before `js/views/TaskSheetView.js`:

```html
<script defer src="js/views/tasksheet/rows.js"></script>
<script defer src="js/views/tasksheet/trays.js"></script>
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:local -- task-sheet-fields.spec.js`
Expected: PASS, 12 tests.

- [ ] **Step 9: Commit**

```bash
git add js/views/tasksheet/rows.js js/views/tasksheet/trays.js js/views/TaskSheetView.js css/tasksheet.css app.html tests/task-sheet-fields.spec.js
git commit -m "feat(tasksheet): field rows, picker trays and live token parsing

Seven core rows on one screen with trays in the thumb zone. Status
options are rebuilt from the live taxonomy on every open because the app
scopes statuses per company AND per type, and changing either re-checks
the chosen status rather than leaving an impossible value in the form.

Trays are panels inside the sheet, not App.Menu calls: App.Menu keeps one
menu open at a time, so a tray opened through it would close the sheet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Checklist builder

The checklist maps onto the app's subtasks, so a step added on a phone appears on desktop and in the detail page.

**Files:**
- Modify: `js/views/TaskSheetView.js` (checklist render and binding)
- Modify: `css/tasksheet.css` (checklist styles)
- Test: `tests/task-sheet-checklist.spec.js` (create)

**Interfaces:**
- Consumes: `this.form.checklist` — `[{ t: string, d: boolean }]` from Task 4
- Produces: `_renderChecklist()` and `_bindChecklist(el)` on `App.TaskSheetView`

- [ ] **Step 1: Write the failing test**

Create `tests/task-sheet-checklist.spec.js`:

```js
// @ts-check
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
});

test('the + button adds a step', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Measure the run');
  await page.locator('.ts-check-btn').click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(1);
  await expect(page.locator('.ts-checklist li').first()).toContainText('Measure the run');
  await expect(page.locator('.ts-check-in')).toHaveValue('');
});

test('Enter also adds a step', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Order the edge');
  await page.locator('.ts-check-in').press('Enter');
  await expect(page.locator('.ts-checklist li')).toHaveCount(1);
});

test('a blank step is refused', async ({ page }) => {
  await page.locator('.ts-check-in').fill('   ');
  await page.locator('.ts-check-btn').click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(0);
});

test('a step can be ticked and removed', async ({ page }) => {
  await page.locator('.ts-check-in').fill('Step one');
  await page.locator('.ts-check-btn').click();
  await page.locator('.ts-checklist li .ts-check-box').first().click();
  expect(await page.evaluate(() => App.controller._taskSheet.form.checklist[0].d)).toBe(true);

  await page.locator('.ts-checklist li .ts-check-x').first().click();
  await expect(page.locator('.ts-checklist li')).toHaveCount(0);
});

test('text left in the add box is captured on save', async ({ page }) => {
  await page.locator('.ts-title-in').fill('Drip edge job');
  await page.locator('.ts-check-in').fill('Never pressed plus');
  await page.locator('.ts-save').click();
  const subs = await page.evaluate(() => {
    const t = App.controller.tasks.find(x => /NEVER PRESSED PLUS|DRIP EDGE JOB/i.test(x.title));
    return t ? t.subtasks.map(s => s.t) : [];
  });
  expect(subs.join(' ')).toMatch(/NEVER PRESSED PLUS/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:local -- task-sheet-checklist.spec.js`
Expected: FAIL — the list never gains a row.

- [ ] **Step 3: Write the implementation**

Add to `App.TaskSheetView`:

```js
    _renderChecklist() {
      const ul = this.handle.el.querySelector('[data-checklist]');
      ul.innerHTML = this.form.checklist.map((s, i) => `
        <li class="${s.d ? 'is-done' : ''}">
          <button class="ts-check-box" type="button" data-idx="${i}"
                  aria-label="${s.d ? 'Mark step not done' : 'Mark step done'}">
            <i class="ti ${s.d ? 'ti-square-check' : 'ti-square'}"></i>
          </button>
          <span class="ts-check-t">${App.utils.escapeHtml(s.t)}</span>
          <button class="ts-check-x" type="button" data-idx="${i}" aria-label="Remove step">
            <i class="ti ti-x"></i>
          </button>
        </li>`).join('');

      ul.querySelectorAll('.ts-check-box').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.idx;
        this.form.checklist[i].d = !this.form.checklist[i].d;
        this._renderChecklist();
      }));
      ul.querySelectorAll('.ts-check-x').forEach(b => b.addEventListener('click', () => {
        this.form.checklist.splice(+b.dataset.idx, 1);
        this._renderChecklist();
      }));
    }

    _addChecklistStep(text) {
      const t = String(text || '').trim();
      if (!t) return false;
      this.form.checklist.push({ t, d: false });
      this._renderChecklist();
      return true;
    }

    _bindChecklist(el) {
      const input = el.querySelector('.ts-check-in');
      const add = () => { if (this._addChecklistStep(input.value)) input.value = ''; input.focus(); };
      el.querySelector('.ts-check-btn').addEventListener('click', add);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();       // no <form> here, but stop any ancestor handler
        add();
      });
      this._renderChecklist();
    }
```

Call `this._bindChecklist(el)` at the end of `_bind(el)`.

In `_save()`, capture un-added text **before** building the payload — the handoff is explicit that typing a step and hitting save must not lose it:

```js
      // A step typed but never added is still a step he meant to keep.
      const pending = el.querySelector('.ts-check-in');
      if (pending && pending.value.trim()) this._addChecklistStep(pending.value);
```

- [ ] **Step 4: Add the checklist CSS**

Append to `css/tasksheet.css`:

```css
.ts-checklist { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ts-checklist li {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 10px; background: var(--surface);
}
.ts-checklist li.is-done .ts-check-t { text-decoration: line-through; color: var(--ink-3); }
.ts-check-box, .ts-check-x {
  flex: none; border: 0; background: none; cursor: pointer; color: var(--ink-3);
  width: 28px; height: 28px; display: grid; place-items: center;
}
.ts-check-box i { font-size: 18px; }
.ts-check-t { flex: 1 1 auto; min-width: 0; font: 500 13.5px/1.3 var(--font-body, inherit); overflow-wrap: anywhere; }

.ts-check-add { display: flex; gap: 8px; }
.ts-check-in {
  flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 9px 12px;
  border: 1.5px solid var(--border); border-radius: 12px;
  background: var(--surface); color: var(--ink); font: 400 13.5px/1 var(--font-body, inherit);
}
.ts-check-in:focus { outline: none; border-color: var(--color-accent); }
.ts-check-btn { flex: 0 0 44px; min-height: 44px; border-radius: 12px; font-size: 20px; padding: 0; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:local -- task-sheet-checklist.spec.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add js/views/TaskSheetView.js css/tasksheet.css tests/task-sheet-checklist.spec.js
git commit -m "feat(tasksheet): checklist builder mapped onto subtasks

Steps added on a phone become real subtasks, so they show up on desktop
and in the detail page instead of forming a parallel list. Text left in
the add box is captured on save rather than silently dropped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Wire save, edit, Save + Another and the toasts

The last wire-up: the sheet actually creates and updates tasks, echoes what was scheduled, and offers undo where the handoff asks for it.

**Files:**
- Modify: `js/views/TaskSheetView.js` (`_commit`, `_save`)
- Modify: `js/views/tasklist/QuickBoardLayout.js` (open the edit sheet on card tap)
- Test: `tests/task-sheet-save.spec.js` (create)

**Interfaces:**
- Consumes: `controller.createTask(payload)`; `controller.updateTaskDetails(id, fields)`; `controller.deleteTask(id)`; `App.validate.newTask(raw)` (throws `App.errors.ValidationError` with `.field`); `controller.toastView.show({ title, sub, action })`
- Produces: nothing downstream — this is the last task

- [ ] **Step 1: Write the failing test**

Create `tests/task-sheet-save.spec.js`:

```js
// @ts-check
import { test, expect } from './_fixtures.js';

const MOBILE = { width: 390, height: 844 };

const openSheet = async (page) => {
  await page.locator('#bottomNav [data-key="new"]').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/app.html?preview=1');
  await expect(page.locator('#userAvatar')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('quick'); });
});

test('Add task saves, closes the sheet and lands the card on the board', async ({ page }) => {
  const before = await page.locator('.qb-card').count();
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Fix drip edge at Simmons');
  await page.locator('.ts-save').click();
  await expect(page.locator('.task-sheet')).toHaveCount(0);
  await expect(page.locator('.qb-card')).toHaveCount(before + 1);
  await expect(page.locator('.qb-card').first()).toContainText(/DRIP EDGE/i);
});

test('the saved title has its tokens stripped', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Order drip edge !high tmrw');
  await page.locator('.ts-save').click();
  const title = await page.evaluate(() =>
    App.controller.tasks.find(t => /ORDER DRIP EDGE/i.test(t.title)).title);
  expect(title).not.toMatch(/!high|tmrw/i);
});

test('the toast echoes what got scheduled', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Call the GAF rep tmrw 9a');
  await page.locator('.ts-save').click();
  await expect(page.locator('.toast, #toast')).toContainText(/Tomorrow/i);
  await expect(page.locator('.toast, #toast')).toContainText(/9:00/);
});

test('Save + Another keeps routing, clears the title and refocuses', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-row[data-field="priority"]').click();
  await page.locator('.ts-tray .ts-seg [data-value]').last().click();
  await page.locator('.ts-tray .ts-tray-done').click();
  const priority = await page.locator('.ts-row[data-field="priority"] .ts-val').innerText();

  await page.locator('.ts-title-in').fill('First of a batch');
  await page.locator('.ts-save-another').click();

  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('.ts-title-in')).toHaveValue('');
  await expect(page.locator('.ts-title-in')).toBeFocused();
  await expect(page.locator('.ts-row[data-field="priority"] .ts-val')).toHaveText(priority);
});

test('editing a card saves the change back to the task', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  await page.locator('.qb-card').first().click();
  await expect(page.locator('.task-sheet .ts-label')).toHaveText('EDIT TASK');

  await page.locator('.ts-row[data-field="priority"]').click();
  await page.locator('.ts-tray .ts-seg [data-value]').first().click();
  await page.locator('.ts-tray .ts-tray-done').click();
  await page.locator('.ts-save').click();

  await expect(page.locator('.task-sheet')).toHaveCount(0);
  await expect(page.locator('.toast, #toast')).toContainText(/Saved/i);
});

test('delete offers an undo', async ({ page }) => {
  await expect(page.locator('.qb-card').first()).toBeVisible();
  const before = await page.locator('.qb-card').count();
  await page.locator('.qb-card').first().click();
  await page.locator('.ts-delete').click();
  await expect(page.locator('.qb-card')).toHaveCount(before - 1);
  await expect(page.locator('.toast, #toast')).toContainText(/Undo/i);
});

test('a validation failure keeps the sheet open with its values intact', async ({ page }) => {
  await openSheet(page);
  await page.locator('.ts-title-in').fill('Has a title');
  await page.evaluate(() => { App.controller._taskSheet.form.company = 'not-a-company'; });
  await page.locator('.ts-save').click();
  await expect(page.locator('.task-sheet')).toBeVisible();
  await expect(page.locator('.ts-title-in')).toHaveValue('Has a title');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:local -- task-sheet-save.spec.js`
Expected: FAIL — `_commit` is a no-op, so nothing is created.

- [ ] **Step 3: Write the implementation**

Replace `_commit` in `App.TaskSheetView`:

```js
    /* Echo what was actually scheduled, not just "saved" — a mis-parsed token
       is only catchable if the confirmation states the result. */
    _scheduleEcho() {
      const bits = [];
      if (this.form.due) bits.push(App.utils.formatDue(this.form.due).text);
      if (this.form.time) bits.push(App.utils.formatClock(this.form.time));
      const p = App.directory.person(this.form.whos[0]);
      if (p) bits.push(p.name);
      return bits.join(' · ');
    }

    _commit(applied, keepOpen) {
      const el = this.handle.el;
      this.form = applied.form;
      const payload = App.TaskSheet.form.toPayload(this.form, applied.cleanTitle);

      let clean;
      try {
        clean = App.validate.newTask(payload);
      } catch (err) {
        // Keep the sheet and every value; say which field is wrong.
        this.controller.toastView.show({ title: 'Check the task', sub: err.message });
        const row = err.field && el.querySelector(`.ts-row[data-field="${err.field}"]`);
        if (row) row.classList.add('is-invalid');
        return;
      }

      if (this.mode === 'edit') {
        this.controller.updateTaskDetails(this.taskId, Object.assign({}, clean, {
          project: this.form.project || null,
        }));
        this.controller.toastView.show({ title: 'Saved changes' });
        this.close();
        return;
      }

      this.controller.createTask(Object.assign({}, clean, {
        project: this.form.project || null,
        reminderOffset: this.form.reminder || null,
      }));
      this.controller.toastView.show({ title: '✓ Added', sub: this._scheduleEcho() });

      if (!keepOpen) { this.close(); return; }

      // Batch entry: keep the routing fields, drop what was specific to this one.
      this.form.detail = '';
      this.form.checklist = [];
      const input = el.querySelector('.ts-title-in');
      input.value = '';
      el.querySelector('.ts-detail').value = '';
      this._renderChecklist();
      input.focus();
    }
```

In `js/views/tasklist/QuickBoardLayout.js`, open the edit sheet on a card tap. `makeActivatable` synthesises a click that bubbles into `TaskListView`'s delegated handler, so intercept before it selects:

```js
    // Card body taps open the edit sheet; the complete circle keeps its own
    // data-action and is handled by TaskListView's delegated vocabulary.
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      e.stopPropagation();
      view.controller.openTaskSheet(t.id);
    });
```

And add the seam to `AppController`:

```js
  openTaskSheet(taskId) {
    if (!this._taskSheet) this._taskSheet = new App.TaskSheetView({ controller: this });
    this._taskSheet.openEdit(taskId);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:local -- task-sheet-save.spec.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run everything**

```bash
npm run test:unit
npm run test:local
```
Expected: all green — 241 baseline units plus the new ones, and every Playwright spec.

- [ ] **Step 6: Verify against the handoff**

Start the dev server, then at 390×844 in preview mode walk the seven storyboard steps from `quest-hq-mobile-handoff-v2/storyboard.html` and compare each against `reference-app.html`:

1. board + ⊕
2. sheet open, all seven rows visible without scrolling
3. tap a row → tray
4. due quick picks
5. type `Order drip edge @jesus #lumen !high tmrw 9a` → four rows fill
6. collapsed group expands
7. save → toast echo → card pulses at the top of the board

Check every screen in **both themes**.

- [ ] **Step 7: Commit**

```bash
git add js/views/TaskSheetView.js js/views/tasklist/QuickBoardLayout.js js/controllers/AppController.js tests/task-sheet-save.spec.js
git commit -m "feat(tasksheet): wire save, edit, batch entry and toasts

Create and edit go through the existing controller seams, so multi-
assignee fan-out, notifications and activity entries keep working. The
add toast echoes the resolved schedule rather than saying 'saved', which
is what makes a mis-parsed token catchable. A validation failure keeps
the sheet and every value instead of discarding the draft.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Every section of the design doc maps to a task: §4.1 board → Tasks 3 and 5; §4.2 sheet → Tasks 4, 7, 8, 9; §4.3 CSS → Tasks 5, 7, 8, 9; §4.4 controller wiring → Tasks 6, 7, 10; §4.5 data flow → Task 10; §5 error handling → Tasks 7 and 10; §6 testing → every task; §7 the date bug → Tasks 1 and 2. Decisions 1–6 in §3 are each implemented by a named task. §8's out-of-scope items appear nowhere, as intended.

**One addition beyond the spec.** Task 1 fixes `App.utils.formatDue`, a pre-existing production bug found while reading the seams: it renders every due date that is not Today or Tomorrow one day early for any viewer west of UTC, including Phoenix. It is in scope because the new board puts a due pill on every card, and shipping the redesign on top of a date skew would make the board look wrong in exactly the review the boss is doing.

**Type consistency.** The form shape declared in Task 4 (`{ company, whos, priority, status, type, due, time, reminder, label, project, detail, checklist }`) is the one Tasks 7–10 read. `App.TaskSheet.dates`, `App.TaskSheet.form`, `App.TaskSheet.rows`, `App.TaskSheet.trays`, `App.QuickBoard` and `App.TaskListLayouts.quick` are each defined once and referenced with the same names throughout. `_display(field)` returns `{ label, swatch?, pill?, pillCls? }` in Task 8 and is consumed with those keys by `rows.render` and `rows.update`.

**Signatures verified against the source, not assumed.** `activeStatuses(company, type)`, `activeTypes(company)`, `activeLabels(company)`, `typeLabel(company, type)`, `statusLabel(company, type, status)`, `labelLabel(company, label)` and `defaultStatus(company, type)` all match `js/taxonomy.js:98-113` as used above.

**Three errors found and fixed during this review, all from assuming an interface instead of reading it.** `App.taxonomy.color` is `color(kind, company, key, type)` and does not serve companies at all — company accent colour is a CSS token picked by index, so Task 5 promotes the duplicated private helper to `App.utils.companyColor`. The priority tray was being built from `Object.keys(App.PRIORITIES)`, which would render five segments and undo the deliberate omission of `urgent` from the create path. The assignee tray was reading `App.directory.people()`, which ignores company scoping; it now uses `App.utils.peopleInCompany`.
