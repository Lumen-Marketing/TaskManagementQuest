# Wallboard ("TV Mode") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen, chrome-less, auto-refreshing "office TV" wallboard that shows every person in the current company and each person's open tasks, entered from the sidebar and exited with Esc or an Exit button.

**Architecture:** A new `App.WallboardView` rendered into a new `#wallboardWrap` section in `app.html`, registered as the `wallboard` view in `AppController` (canView / setView / `_togglePanes`). Entering toggles a `body.wallboard-active` class that hides the deck + topbar so the board goes full-bleed. Data comes from the existing `controller.visibleTasks()` (company/role scoped) and `App.utils.activePeople()`. Live updates ride the existing EventBus (`tasks:changed` etc.) plus a 60s fallback timer; a 1s timer drives the clock. All CSS uses existing theme tokens so it follows light/dark automatically.

**Tech Stack:** Vanilla JS class views (no framework), CSS custom properties, Playwright (`--project=local`) e2e tests in preview mode.

## Global Constraints

- New view key is the literal string `wallboard`.
- Blocked = `task.status === 'hold'` (confirmed: `ReportsView.js:91` maps `hold → 'Blocked'`). Done = `task.status === 'done'`. Open = `status !== 'done'`.
- "Today" must be computed with `App.utils.todayISO(0)` (timezone-aware), never `new Date()` for date-only comparisons.
- Esc must NOT exit while a modal is open — guard with `document.querySelector('.modal-backdrop')`.
- The person object shape is `{ id, name, full, email, color, avatar_url, company_ids, active }` — there is **no** `role`/`title` field. Derive the role subtitle from `App.PROFILES` (`profile.role`), falling back to empty string.
- All timers MUST be cleared on exit (no background work when the view is hidden).
- New test spec MUST be added to the `testMatch` array in `playwright.config.js:29`.
- Run tests with: `npx playwright test --project=local <file>`.
- Preview boot URL: `/app.html?preview=1&role=admin&member=abraham`, then `await page.waitForFunction(() => !!window.App && !!window.App.controller)`.

---

### Task 1: View scaffold, wiring, and takeover/exit lifecycle

**Files:**
- Create: `js/views/WallboardView.js`
- Modify: `app.html:198` (add `#wallboardWrap` section), `app.html:276` (add `<script>` tag)
- Modify: `js/app.js:198` (instantiate the view)
- Modify: `js/controllers/AppController.js` — `canView` (line ~84), `_togglePanes` (line ~484)
- Modify: `app.html:24` (add the sidebar nav item)
- Test: `tests/wallboard.spec.js` (create), `playwright.config.js:29`

**Interfaces:**
- Produces: `App.WallboardView` class constructed as `new App.WallboardView({ controller })`. Public behavior: when `view:changed` fires with `'wallboard'` it enters (adds `body.wallboard-active`, starts timers, renders); any other view leaves (removes the class, stops timers). Exposes `render()` (stubbed here, filled in Task 2).
- Consumes: `controller.setView(view)`, `controller.uiState.view`, `App.EventBus`.

- [ ] **Step 1: Add the sidebar nav item**

In `app.html`, in the "Personal" deck section, add after the "Watching" item (line 24):

```html
        <div class="side-item" data-view="wallboard" title="Wallboard"><i class="ti ti-device-tv"></i><span class="side-item-label">Wallboard</span></div>
```

(Static `data-view` items are auto-wired by `SidebarView` to `controller.setView`, so no JS wiring is needed for the click.)

- [ ] **Step 2: Add the view container and script tag**

In `app.html`, after the reports section (line 198), add:

```html
    <section id="wallboardWrap" class="qhq-page hidden" aria-label="Wallboard"></section>
```

And after the ReportsView script (line 276), add:

```html
<script src="js/views/WallboardView.js"></script>
```

- [ ] **Step 3: Register the view in AppController**

In `js/controllers/AppController.js`, in `canView` (after the `reports` line, ~line 85), add:

```js
    if (view === 'wallboard') return App.can('home.view');
```

In `_togglePanes` (line ~484), treat `wallboard` as a full-page view. Change the `isPageView` line and add the wrap toggle:

```js
    const isPageView = v === 'home' || v === 'reports' || v === 'wallboard';
```

and after the `reportsWrap` toggle line, add:

```js
    const wallboardWrap = document.getElementById('wallboardWrap');
    if (wallboardWrap) wallboardWrap.classList.toggle('hidden', v !== 'wallboard');
    document.body.classList.toggle('wallboard-active', v === 'wallboard');
```

- [ ] **Step 4: Write the failing test**

Add `'wallboard.spec.js'` to `testMatch` in `playwright.config.js:29`, then create `tests/wallboard.spec.js`:

```js
// @ts-check
import { test, expect } from './_fixtures.js';

async function boot(page, baseURL) {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
}

test.describe('wallboard · navigation + takeover', () => {
  test('sidebar item enters a full-screen takeover; Esc returns to prior view', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    // Start on All tasks, then enter the wallboard via the sidebar.
    await page.evaluate(() => window.App.controller.setView('all'));
    await page.click('.side-item[data-view="wallboard"]');
    await expect(page.locator('#wallboardWrap')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/wallboard-active/);

    // Esc exits back to the previous view (all) and restores chrome.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/wallboard-active/);
    const view = await page.evaluate(() => window.App.controller.uiState.view);
    expect(view).toBe('all');
  });

  test('timers are cleared after leaving the wallboard', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));
    await page.evaluate(() => window.App.controller.setView('home'));
    const live = await page.evaluate(() => window.App.wallboardView && window.App.wallboardView._timersActive());
    expect(live).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx playwright test --project=local wallboard.spec.js`
Expected: FAIL — `WallboardView` does not exist yet; `#wallboardWrap` never becomes visible.

- [ ] **Step 6: Create the view scaffold**

Create `js/views/WallboardView.js`:

```js
window.App = window.App || {};

/* WallboardView — full-screen, auto-refreshing "office TV" board of the whole
   company team and each person's open tasks. Entered via the sidebar; exits on
   Esc or the Exit button. Read-only. Follows the app's current theme. */
App.WallboardView = class WallboardView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('wallboardWrap');
    this._clockTimer = null;
    this._fallbackTimer = null;
    this._prevView = 'home';          // where Esc / Exit returns to
    this._onKeydown = this._onKeydown.bind(this);
    App.wallboardView = this;          // exposed for tests / debugging
    this.subscribe();
  }

  subscribe() {
    const rerender = () => { if (this._active()) this.render(); };
    App.EventBus.on('tasks:changed',   rerender);
    App.EventBus.on('people:changed',  rerender);
    App.EventBus.on('company:changed', rerender);
    App.EventBus.on('view:changed', (v) => {
      if (v === 'wallboard') this._enter();
      else { this._prevView = v; this._leave(); }
    });
  }

  _active() { return !!this.wrap && !this.wrap.classList.contains('hidden'); }
  _timersActive() { return !!(this._clockTimer || this._fallbackTimer); }

  _enter() {
    document.addEventListener('keydown', this._onKeydown);
    this._startTimers();
    this.render();
  }

  _leave() {
    document.removeEventListener('keydown', this._onKeydown);
    this._stopTimers();
  }

  _startTimers() {
    this._stopTimers();
    this._clockTimer = setInterval(() => this._renderClock(), 1000);
    this._fallbackTimer = setInterval(() => this.render(), 60000);
  }

  _stopTimers() {
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
  }

  _onKeydown(e) {
    // Don't steal Esc from an open modal.
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
      this.controller.setView(this._prevView || 'home');
    }
  }

  _renderClock() {
    const el = this.wrap && this.wrap.querySelector('.wb-clock');
    if (el) el.textContent = this._clockText();
  }

  _clockText() {
    const tz = (App.timezone && App.timezone()) || undefined;
    try {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date());
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date());
    }
  }

  // Filled in Task 2.
  render() {
    if (!this.wrap) return;
    this.wrap.innerHTML = `<div class="wb-head"><div class="wb-title">Quest HQ — Today</div></div>`;
  }
};
```

- [ ] **Step 7: Instantiate the view**

In `js/app.js`, after the ReportsView instantiation (line 198), add:

```js
  new App.WallboardView({ controller });
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx playwright test --project=local wallboard.spec.js`
Expected: PASS (both tests).

- [ ] **Step 9: Commit**

```bash
git add js/views/WallboardView.js js/app.js app.html js/controllers/AppController.js tests/wallboard.spec.js playwright.config.js
git commit -m "feat(wallboard): scaffold TV-mode view, sidebar entry, takeover + Esc exit"
```

---

### Task 2: Render the header, counts, clock, and per-person grid

**Files:**
- Modify: `js/views/WallboardView.js` (replace the `render()` method, add helpers)
- Test: `tests/wallboard.spec.js` (extend)

**Interfaces:**
- Consumes: `controller.visibleTasks({ includeDone: true })`, `App.utils.activePeople()`, `App.utils.todayISO(0)`, `App.PRIORITIES`, `App.PROFILES`.
- Produces: DOM under `#wallboardWrap`: `.wb-head` (title, date subtitle, `.wb-stats` with `.wb-stat` for ACTIVE/DONE/BLOCKED, `.wb-clock`, `.wb-exit` button), `.wb-grid` of `.wb-card` per person (each with `.wb-card-head` and `.wb-task` rows; blocked rows get `.wb-task--blocked`), and `.wb-foot`.

- [ ] **Step 1: Write the failing test**

Append to `tests/wallboard.spec.js`:

```js
test.describe('wallboard · content', () => {
  test('renders one card per active person with counts and blocked highlighting', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));

    // A card per active person (seed has several).
    const cards = page.locator('#wallboardWrap .wb-card');
    expect(await cards.count()).toBeGreaterThan(1);

    // Header stats exist (ACTIVE / DONE / BLOCKED).
    await expect(page.locator('#wallboardWrap .wb-stat')).toHaveCount(3);

    // The seed has a held (blocked) task (t11 'Supabase auth wiring', assignee abraham).
    const blocked = page.locator('#wallboardWrap .wb-task--blocked');
    expect(await blocked.count()).toBeGreaterThan(0);

    // Exit button returns to prior view.
    await page.click('#wallboardWrap .wb-exit');
    await expect(page.locator('body')).not.toHaveClass(/wallboard-active/);
  });

  test('caps each person at 4 tasks with a +N more line', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => {
      // Pile 6 open tasks onto one person so the cap triggers deterministically.
      const tm = window.App.controller.taskModel;
      for (let i = 0; i < 6; i++) {
        tm.tasks.push({ id: 'wb-extra-' + i, title: 'Extra ' + i, type: 'admin', company: 'roofing',
          creator: 'abraham', assignee: 'abraham', watchers: [], due: window.App.utils.todayISO(2),
          priority: 'medium', status: 'todo', subtasks: [], activity: [] });
      }
      window.App.EventBus.emit('tasks:changed');
      window.App.controller.setView('wallboard');
    });
    const more = page.locator('#wallboardWrap .wb-card .wb-more').first();
    await expect(more).toBeVisible();
    await expect(more).toContainText('more');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=local wallboard.spec.js -g "content"`
Expected: FAIL — the stub `render()` only writes a title; no `.wb-card`, `.wb-stat`, `.wb-exit`.

- [ ] **Step 3: Implement the full render**

In `js/views/WallboardView.js`, replace the stub `render()` with the following and add the helper methods (place them above `render()`), keeping the rest of the class unchanged:

```js
  _scopedTasks() {
    return this.controller.visibleTasks({ includeDone: true });
  }

  _roleSub(personId) {
    const profile = (App.PROFILES || []).find(pr => pr.member_id === personId);
    return (profile && profile.role) ? String(profile.role) : '';
  }

  _prioColor(priority) {
    switch (priority) {
      case 'critical':
      case 'urgent': return 'var(--rust)';
      case 'high':   return 'var(--u-high)';
      case 'medium': return 'var(--u-medium)';
      default:       return 'var(--u-low)';
    }
  }

  _fmtDue(due) {
    if (!due) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(due + 'T00:00:00'));
    } catch (e) { return String(due).slice(5); }
  }

  // blocked (hold) first, then overdue, then soonest due.
  _sortTasks(tasks, today) {
    const rank = (t) => (t.status === 'hold' ? 0 : (t.due && t.due < today ? 1 : 2));
    return tasks.slice().sort((a, b) =>
      rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }

  _taskRow(t, today) {
    const esc = App.utils.escapeHtml;
    const blocked = t.status === 'hold';
    const overdue = !blocked && t.due && t.due < today;
    return `
      <div class="wb-task ${blocked ? 'wb-task--blocked' : ''}">
        <span class="wb-dot" style="background:${this._prioColor(t.priority)}"></span>
        <span class="wb-task-t">${esc(t.title)}</span>
        ${blocked
          ? `<span class="wb-badge">BLOCKED</span>`
          : `<span class="wb-due ${overdue ? 'over' : ''}">${esc(this._fmtDue(t.due))}</span>`}
      </div>`;
  }

  _personCard(person, tasks, today) {
    const esc = App.utils.escapeHtml;
    const open = this._sortTasks(tasks.filter(t => t.status !== 'done'), today);
    const sub = this._roleSub(person.id);
    const shown = open.slice(0, 4).map(t => this._taskRow(t, today)).join('');
    const moreCount = open.length - Math.min(open.length, 4);
    const body = open.length
      ? shown + (moreCount > 0 ? `<div class="wb-more">+${moreCount} more</div>` : '')
      : `<div class="wb-clear">All clear ✅</div>`;
    return `
      <div class="wb-card">
        <div class="wb-card-head">
          <span class="avatar-sm" style="background:${esc(person.color || 'var(--ink)')}">${esc(App.utils.initials ? App.utils.initials(person.full || person.name) : (person.name || '?').slice(0, 2))}</span>
          <div class="wb-who">
            <div class="wb-name">${esc(person.full || person.name || person.id)}</div>
            ${sub ? `<div class="wb-role">${esc(sub)}</div>` : ''}
          </div>
          <div class="wb-open"><span class="wb-open-n">${open.length}</span><span class="wb-open-l">open</span></div>
        </div>
        <div class="wb-tasks">${body}</div>
      </div>`;
  }

  render() {
    if (!this.wrap) return;
    const esc = App.utils.escapeHtml;
    const today = App.utils.todayISO(0);
    const all = this._scopedTasks();
    const open = all.filter(t => t.status !== 'done');
    const done = all.filter(t => t.status === 'done');
    const blocked = all.filter(t => t.status === 'hold');

    const people = App.utils.activePeople();
    const byId = {};
    open.concat(blocked).forEach(() => {});
    const tasksByPerson = (id) => all.filter(t => t.assignee === id);

    const dateLine = (() => {
      try {
        return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
      } catch (e) { return today; }
    })();

    const cards = people.map(p => this._personCard(p, tasksByPerson(p.id), today)).join('');

    this.wrap.innerHTML = `
      <div class="wb-head">
        <div class="wb-head-l">
          <div class="wb-title">Quest HQ — Today</div>
          <div class="wb-sub">${esc(dateLine)} · everybody's tasks for the day</div>
        </div>
        <div class="wb-head-r">
          <div class="wb-stats">
            <div class="wb-stat"><span class="wb-stat-n">${open.length}</span><span class="wb-stat-l">Active</span></div>
            <div class="wb-stat"><span class="wb-stat-n">${done.length}</span><span class="wb-stat-l">Done</span></div>
            <div class="wb-stat"><span class="wb-stat-n wb-stat-blocked">${blocked.length}</span><span class="wb-stat-l">Blocked</span></div>
          </div>
          <div class="wb-clock">${esc(this._clockText())}</div>
          <button type="button" class="wb-exit" data-action="exit"><i class="ti ti-x"></i> Exit</button>
        </div>
      </div>
      <div class="wb-grid">${cards}</div>
      <div class="wb-foot"><span class="wb-live"></span> Live · Auto-refreshing · press Esc to exit</div>`;

    const exitBtn = this.wrap.querySelector('.wb-exit');
    if (exitBtn) exitBtn.addEventListener('click', () => this.controller.setView(this._prevView || 'home'));
  }
```

(Remove the now-unused `byId` / empty `forEach` lines if your linter flags them — they are harmless no-ops but `tasksByPerson` is the real lookup.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test --project=local wallboard.spec.js`
Expected: PASS (navigation + content + cap tests).

- [ ] **Step 5: Commit**

```bash
git add js/views/WallboardView.js tests/wallboard.spec.js
git commit -m "feat(wallboard): render header, counts, clock, and per-person task grid"
```

---

### Task 3: Style the wallboard (theme-following) and verify end-to-end

**Files:**
- Modify: `taskmanagement.css` (append a `body.wallboard-active` + `.wb-*` block)
- Test: `tests/wallboard.spec.js` (extend with a live-update assertion)

**Interfaces:**
- Consumes: existing theme tokens (`--bg`, `--surface`, `--ink`, `--ink-2/3`, `--border`, `--rust`, `--green`, `--amber`, radius/space tokens). No new tokens.
- Produces: the full-bleed dark/light wallboard styling; deck + topbar hidden while active.

- [ ] **Step 1: Write the failing test (live update)**

Append to `tests/wallboard.spec.js`:

```js
test.describe('wallboard · live + chrome', () => {
  test('hides app chrome and updates live on tasks:changed', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('wallboard'));

    // Chrome hidden while active.
    await expect(page.locator('.deck')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();

    const before = await page.locator('#wallboardWrap .wb-task').count();
    await page.evaluate(() => {
      const tm = window.App.controller.taskModel;
      tm.tasks.push({ id: 'wb-live-1', title: 'Live added task', type: 'admin', company: 'roofing',
        creator: 'abraham', assignee: 'andres', watchers: [], due: window.App.utils.todayISO(1),
        priority: 'high', status: 'todo', subtasks: [], activity: [] });
      window.App.EventBus.emit('tasks:changed');
    });
    await expect(page.locator('#wallboardWrap .wb-task')).toHaveCount(before + 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=local wallboard.spec.js -g "live"`
Expected: live-update assertion may pass (render is already subscribed), but the chrome-hidden assertions FAIL — no CSS hides `.deck`/`.topbar` yet.

- [ ] **Step 3: Add the wallboard CSS**

Append to `taskmanagement.css`:

```css
/* ============ Wallboard ("TV mode") — full-bleed team display ============ */
body.wallboard-active .deck,
body.wallboard-active .topbar { display: none !important; }
body.wallboard-active .app { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
body.wallboard-active #mainPane { padding: 0; }

#wallboardWrap {
  position: fixed; inset: 0; z-index: 60;
  background: var(--bg); color: var(--ink);
  display: flex; flex-direction: column;
  padding: 28px 32px; overflow-y: auto;
}
#wallboardWrap.hidden { display: none; }

.wb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.wb-title { font-family: var(--font-display); font-size: 30px; font-weight: 800; line-height: 1.1; }
.wb-sub { color: var(--ink-3); font-size: 14px; margin-top: 4px; }
.wb-head-r { display: flex; align-items: center; gap: 24px; }
.wb-stats { display: flex; gap: 22px; }
.wb-stat { display: flex; flex-direction: column; align-items: center; }
.wb-stat-n { font-family: var(--font-display); font-size: 28px; font-weight: 800; line-height: 1; }
.wb-stat-blocked { color: var(--rust); }
.wb-stat-l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); margin-top: 3px; }
.wb-clock { font-family: var(--font-mono); font-size: 26px; font-weight: 600; }
.wb-exit { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius-pill); background: var(--surface); border: 1px solid var(--border); color: var(--ink); font-size: 13px; }
.wb-exit:hover { background: var(--bg-2); }

.wb-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-content: start; flex: 1; }
.wb-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px 18px; }
.wb-card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.wb-card-head .avatar-sm { width: 34px; height: 34px; font-size: 12px; flex: 0 0 auto; }
.wb-who { flex: 1; min-width: 0; }
.wb-name { font-weight: 700; font-size: 16px; }
.wb-role { font-size: 12px; color: var(--ink-3); }
.wb-open { text-align: right; }
.wb-open-n { font-family: var(--font-display); font-size: 22px; font-weight: 800; display: block; line-height: 1; }
.wb-open-l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }

.wb-tasks { display: flex; flex-direction: column; gap: 2px; }
.wb-task { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--radius-sm); }
.wb-task--blocked { background: var(--rust-bg); }
.wb-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.wb-task-t { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-due { font-size: 12px; color: var(--ink-3); font-family: var(--font-mono); flex: 0 0 auto; }
.wb-due.over { color: var(--rust); }
.wb-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--rust-ink); background: var(--rust-bg); border: 1px solid var(--rust); padding: 2px 7px; border-radius: var(--radius-sm); flex: 0 0 auto; }
.wb-more { font-size: 12px; color: var(--ink-3); padding: 7px 10px; }
.wb-clear { font-size: 13px; color: var(--ink-3); padding: 9px 10px; }

.wb-foot { margin-top: 22px; font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 8px; }
.wb-live { width: 9px; height: 9px; border-radius: 50%; background: var(--green); display: inline-block; }
```

- [ ] **Step 4: Run the full spec to verify it passes**

Run: `npx playwright test --project=local wallboard.spec.js`
Expected: PASS (all wallboard tests, including chrome-hidden + live update).

- [ ] **Step 5: Manual end-to-end verification**

Run `npm run dev`, open `http://localhost:4173/app.html?preview=1&role=admin&member=abraham`. Then:
- Click the sidebar "Wallboard" item → confirm the full-bleed board with the header, clock ticking each second, per-person cards, the held task showing a red BLOCKED row, and "+N more" where applicable.
- Press Esc and click Exit → both return to the previous view and restore the sidebar/topbar.
- Switch company (topbar company switcher) before entering → confirm the board reflects only that company's people/tasks.
- Toggle dark theme → confirm the board reads well (it uses tokens, so it follows).
- Confirm in DevTools that after exiting, no `setInterval` keeps firing (the clock stops; `App.wallboardView._timersActive()` returns `false`).

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css tests/wallboard.spec.js
git commit -m "feat(wallboard): theme-following full-bleed styling + live-update test"
```

---

## Self-Review

- **Spec coverage:** new `WallboardView` like HomeView (Task 1) ✓; `wallboard` view key registered in canView/`_togglePanes` (Task 1) ✓; sidebar entry (Task 1) ✓; `body.wallboard-active` takeover hiding deck/topbar (Task 1 wiring + Task 3 CSS) ✓; Esc/Exit return to prior view with modal guard (Task 1 + Task 2 exit button) ✓; data via `visibleTasks` + `activePeople` (Task 2) ✓; realtime via EventBus + 60s fallback + 1s clock, all cleared on exit (Task 1) ✓; header title/date/counts/clock/exit (Task 2) ✓; per-person cards sorted blocked→overdue→due, capped at 4 with +N more (Task 2) ✓; blocked = `status==='hold'` red row + BLOCKED badge (Task 2) ✓; zero-task "All clear ✅" (Task 2) ✓; theme-following CSS (Task 3) ✓; footer (Task 2) ✓; permission `home.view` (Task 1) ✓; overflow scrolls (`#wallboardWrap { overflow-y:auto }`, Task 3) ✓.
- **Placeholder scan:** none — full file contents and CSS are provided. The role subtitle's empty-in-seed behavior is explicitly handled (`_roleSub` returns `''`, card omits the line), per the Global Constraints note.
- **Type/selector consistency:** `_prevView`, `_timersActive`, `_clockText`, `_active`, `render` are defined once and referenced consistently; test selectors (`.wb-card`, `.wb-stat`, `.wb-task--blocked`, `.wb-exit`, `.wb-more`, `.wb-clock`) all match the strings emitted by `render()`; `wallboard-active` class name matches between AppController (`_togglePanes`), the CSS, and the tests.
- **Note (follow-up, not v1 blocker):** the role subtitle uses `profile.role` which is empty in the preview seed; to mirror Home's richer role labels, a later pass can reuse Home's exact role-string source. Captured in the design's non-goals.
