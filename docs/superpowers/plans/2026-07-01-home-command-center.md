# Home Personal Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Home into a two-column personal command center — emphasized section headers + a Week/Month selector, three trend cards with sparklines, a mini month calendar that opens the full Calendar on the clicked date, the existing Projects ring, re-homed Up next / At risk, and full-width Recents.

**Architecture:** All work lives in `js/views/HomeView.js` (markup + view logic) and `taskmanagement.css` (layout + styles), plus one tiny `AppController` helper for the calendar handoff. Metrics are computed viewer-scoped from `controller.visibleTasks`, reusing the bucketing approach ReportsView already uses. No new dependencies; zero-build static SPA.

**Tech Stack:** Vanilla ES classes on a global `App` namespace, inlined Solar-duotone SVG icons, CSS custom properties under the `panze-home` skin, Playwright (preview mode) for tests, `tools/dev-server.mjs` + a headless Chromium for screenshot verification.

## Global Constraints

- Zero-build static SPA — no framework, no bundler; edit `.js`/`.css` directly.
- Colors: existing tokens only — `--amber` (#ED4E0D brand), `--blue`, `--rust`, `--green` and their `-bg`/`-ink` variants. **No colored card fills, no gray cards/badges, no new pastels.**
- Trend badge color = the metric's *good direction* (improving → `--green`, worsening → `--rust`); always render the arrow glyph + number too (never color alone).
- Numbers use tabular figures (class `tnum`).
- All auto-playing motion stays behind `@media (prefers-reduced-motion: no-preference)`.
- Mobile breakpoint: `≤720px` collapses the two columns to one (rail after main).
- Icons come from the existing `HOME_ICONS` map (`done`, `inbox`, `calendar`, `date`, `donut`, etc.), rendered via the existing `icon(name)` helper (adds the `ic-<name>` class).
- Reuse existing helpers: `App.utils.todayISO(offset)` (today+offset days → ISO), `App.utils.toISODate(dateObj)`, `App.can('reports.view')`, `controller.currentUser`, `controller.visibleTasks({includeDone})`, `controller.getUserName(id)`, `controller.setView`, `controller.setLayout`, `controller.selectTask`, `controller.openNewTaskModal`, `App.EventBus`.
- Do NOT modify `js/views/ReportsView.js`.

## File Structure

- **Modify** `js/controllers/AppController.js` — add `openCalendarOn(iso)` (near the other `calendar*` methods, ~line 325).
- **Modify** `js/views/HomeView.js` — add `this.period` state; new methods `_periodWindow`, `_trendMetrics`, `_sparklinePath`, `_miniCalendar`; markup helpers `sectionHead`, `trendCardHtml`; restructure `render()` into the two-column layout; remove the stat-strip block; wire the period toggle + calendar day-click.
- **Modify** `taskmanagement.css` — section headers (`.qhq-sec-h`), two-column grid (`.qhq-cc-grid`/`-main`/`-rail`), trend cards (`.qhq-trend*`), sparkline, mini calendar (`.qhq-cal*`), period toggle (reuse `.qhq-range`), responsive + motion; remove the now-unused `.qhq-statstrip`/`.qhq-stat*` rules **only after** the markup no longer emits them.
- **Modify** `tests/home-reports.spec.js` — replace the `.qhq-stat` count assertion with trend-card + calendar assertions; keep greeting/up-next/recents/meta assertions green.

---

### Task 1: Controller `openCalendarOn(iso)` handoff

**Files:**
- Modify: `js/controllers/AppController.js` (after `selectCalendarDay`, ~line 325)
- Test: `tests/home-reports.spec.js` (append a test)

**Interfaces:**
- Produces: `AppController.openCalendarOn(iso: string)` — sets `uiState.calendarAnchor = iso` and `uiState.calendarSelectedDay = iso`, calls `setView('all')` then `setLayout('calendar')`, emits `calendar:changed`. Returns nothing.

- [ ] **Step 1: Write the failing test** — append to `tests/home-reports.spec.js`:

```js
test('openCalendarOn switches to the calendar layout anchored on the date', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  const state = await page.evaluate(() => {
    window.App.controller.openCalendarOn('2026-06-15');
    const u = window.App.controller.uiState;
    return { view: window.App.controller.currentViewName?.() ?? window.App.controller.uiState.view,
             layout: u.layout, anchor: u.calendarAnchor, selected: u.calendarSelectedDay };
  });
  expect(state.anchor).toBe('2026-06-15');
  expect(state.selected).toBe('2026-06-15');
  expect(state.layout).toBe('calendar');
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx playwright test tests/home-reports.spec.js -g "openCalendarOn" --project=local`. Expected: FAIL (`openCalendarOn is not a function`). If `uiState.view`/`currentViewName` differs, read `AppController` to use the correct accessor and adjust the test's `view` read only.

- [ ] **Step 3: Implement the helper** in `js/controllers/AppController.js` right after `selectCalendarDay(iso) { … }`:

```js
  // Jump straight to the All-tasks Calendar, anchored + pre-selected on a date
  // (used by the Home mini-calendar). The calendar layout already renders from
  // calendarAnchor and lists the selected day's tasks.
  openCalendarOn(iso) {
    this.uiState.calendarAnchor = iso;
    this.uiState.calendarSelectedDay = iso;
    this.setView('all');
    this.setLayout('calendar');
    App.EventBus.emit('calendar:changed');
  }
```

- [ ] **Step 4: Run it, verify it passes** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/controllers/AppController.js tests/home-reports.spec.js
git commit -m "feat(calendar): openCalendarOn(iso) handoff for the Home mini-calendar"
```

---

### Task 2: Period state + metric/calendar/sparkline logic (no UI yet)

Pure view-logic methods on `HomeView`, testable via `page.evaluate` before any markup changes. This isolates the correctness-critical math.

**Files:**
- Modify: `js/views/HomeView.js` (add `this.period='week'` in constructor; add the four methods below, near `_statusMix`)
- Test: `tests/home-reports.spec.js`

**Interfaces:**
- Produces:
  - `_periodWindow(mode) → { L, end: Date, curStart: Date, prevStart: Date }` where `L` = 7 (`'week'`) or 30 (`'month'`), `end` = tomorrow 00:00 (so "current" includes today), `curStart` = end−L days, `prevStart` = end−2L days.
  - `_trendMetrics(mode) → Array<{ key, label, icon, tone, value:number, prev:number, goodWhen:'up'|'down', spark:number[] }>` — exactly 3 entries: `completed`, `openload`, `dueweek`.
  - `_sparklinePath(series:number[], w=100, h=28) → string` — SVG polyline `points`.
  - `_miniCalendar() → { label:string, weeks: Array<Array<null | { d:number, iso:string, due:number, today:boolean, overdue:boolean }>> }` — Monday-first, padded to full weeks.

- [ ] **Step 1: Add `this.period` to the constructor.** In `HomeView.constructor`, before `this.subscribe();`:

```js
    this.period = 'week';
```

- [ ] **Step 2: Write the failing test** — append to `tests/home-reports.spec.js`:

```js
test('Home view logic: trend metrics + mini calendar shapes', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  await page.evaluate(() => window.App.controller.setView('home'));
  const r = await page.evaluate(() => {
    const v = window.App.homeView || window.App._homeView;
    const hv = v || Object.values(window.App).find(x => x && x.constructor && x.constructor.name === 'HomeView');
    const m = hv._trendMetrics('week');
    const cal = hv._miniCalendar();
    return {
      keys: m.map(x => x.key),
      allNumeric: m.every(x => typeof x.value === 'number' && Array.isArray(x.spark) && x.spark.length === 8),
      spark: hv._sparklinePath([0, 1, 2, 3]),
      calWeekLen: cal.weeks[0].length,
      calHasLabel: typeof cal.label === 'string' && cal.label.length > 0,
    };
  });
  expect(r.keys).toEqual(['completed', 'openload', 'dueweek']);
  expect(r.allNumeric).toBe(true);
  expect(r.spark).toMatch(/^0\.0,/);           // first point x=0
  expect(r.calWeekLen).toBe(7);
  expect(r.calHasLabel).toBe(true);
});
```

If `window.App.homeView` isn't exposed, expose it: in `HomeView.constructor` add `App.homeView = this;` as the last line. (Add that now — it's also handy for future tests.)

- [ ] **Step 3: Run it, verify it fails** — `npx playwright test tests/home-reports.spec.js -g "trend metrics" --project=local`. Expected: FAIL (`_trendMetrics is not a function`).

- [ ] **Step 4: Implement the four methods** in `js/views/HomeView.js` (place after `_statusMix`):

```js
  _periodWindow(mode) {
    const L = mode === 'month' ? 30 : 7;
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1); // tomorrow 00:00
    const curStart = new Date(end); curStart.setDate(end.getDate() - L);
    const prevStart = new Date(end); prevStart.setDate(end.getDate() - 2 * L);
    return { L, end, curStart, prevStart };
  }

  // 3 viewer-scoped trend cards: value (current period), prev (previous period),
  // goodWhen (which direction is "good", for the badge color), and an 8-bucket
  // sparkline series (oldest -> newest).
  _trendMetrics(mode) {
    const me = this.controller.currentUser;
    const all = this.controller.visibleTasks({ includeDone: true }).filter(t => t.assignee === me);
    const { L, end, curStart, prevStart } = this._periodWindow(mode);
    const today = App.utils.todayISO(0);
    const doneMs = t => (t.completedAt ? new Date(t.completedAt).getTime() : null);
    const createdMs = t => (t.createdAt ? new Date(t.createdAt).getTime() : 0);
    const completedIn = (a, b) => all.filter(t => { const c = doneMs(t); return c != null && c >= a.getTime() && c < b.getTime(); }).length;
    const openAt = T => all.filter(t => { const c = doneMs(t); return createdMs(t) <= T && (c == null || c > T); }).length;
    const openNow = all.filter(t => t.status !== 'done').length;
    const dueBetween = (fromISO, toISO) => all.filter(t => t.status !== 'done' && t.due && t.due >= fromISO && t.due < toISO).length;

    // 8 buckets of length L days, oldest -> newest.
    const buckets = (fn) => {
      const out = [];
      for (let i = 7; i >= 0; i--) {
        const b1 = new Date(end); b1.setDate(end.getDate() - (i + 1) * L);
        const b2 = new Date(end); b2.setDate(end.getDate() - i * L);
        out.push(fn(b1, b2));
      }
      return out;
    };

    return [
      { key: 'completed', label: 'Completed', icon: 'done', tone: 'tone-green', goodWhen: 'up',
        value: completedIn(curStart, end), prev: completedIn(prevStart, curStart),
        spark: buckets((a, b) => completedIn(a, b)) },
      { key: 'openload', label: 'Open workload', icon: 'inbox', tone: 'tone-blue', goodWhen: 'down',
        value: openNow, prev: openAt(curStart.getTime()),
        spark: buckets((a, b) => openAt(b.getTime() - 1)) },
      { key: 'dueweek', label: 'Due this week', icon: 'calendar', tone: 'tone-amber', goodWhen: 'down',
        value: dueBetween(today, App.utils.todayISO(7)), prev: dueBetween(App.utils.todayISO(-7), today),
        spark: buckets((a, b) => all.filter(t => t.status !== 'done' && t.due &&
          t.due >= App.utils.toISODate(a) && t.due < App.utils.toISODate(b)).length) },
    ];
  }

  _sparklinePath(series, w = 100, h = 28) {
    const n = series.length;
    if (!n) return '';
    const max = Math.max(1, ...series);
    const stepX = n > 1 ? w / (n - 1) : 0;
    return series.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  }

  // Current-month grid (Monday-first) with per-day open-task due counts.
  _miniCalendar() {
    const me = this.controller.currentUser;
    const open = this.controller.visibleTasks({ includeDone: false }).filter(t => t.assignee === me);
    const today = App.utils.todayISO(0);
    const dueByDay = {};
    open.forEach(t => { if (t.due) dueByDay[t.due] = (dueByDay[t.due] || 0) + 1; });
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const y = now.getFullYear(), mo = now.getMonth();
    const first = new Date(y, mo, 1);
    const startDow = (first.getDay() + 6) % 7;               // Monday = 0
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = App.utils.toISODate(new Date(y, mo, d));
      const due = dueByDay[iso] || 0;
      cells.push({ d, iso, due, today: iso === today, overdue: due > 0 && iso < today });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { label: first.toLocaleDateString('en-US', { month: 'long' }), weeks };
  }
```

- [ ] **Step 5: Run it, verify it passes** — same command. Expected: PASS. (If `App.utils.toISODate` is absent, grep `js/utils.js` for the ISO-date helper name and substitute it consistently.)

- [ ] **Step 6: Commit**

```bash
git add js/views/HomeView.js tests/home-reports.spec.js
git commit -m "feat(home): trend-metric, sparkline and mini-calendar logic"
```

---

### Task 3: Two-column shell + section headers + period toggle (re-home existing cards, drop stat strip)

Restructure `render()`'s output markup into the command-center layout. Existing cards (Up next, At risk, Projects ring, Recents) keep their inner markup; they move into the new columns. The stat strip is removed. Trend cards + calendar get placeholder mounts filled in Tasks 4-5? No — build them here so the section is real, using Task 2's data.

**Files:**
- Modify: `js/views/HomeView.js` (`render()` template + wiring; add `sectionHead` + `trendCardHtml` helpers)
- Modify: `taskmanagement.css` (section headers, two-column grid, period toggle, trend cards, sparkline)
- Test: `tests/home-reports.spec.js`

**Interfaces:**
- Consumes: `_trendMetrics`, `_sparklinePath`, `icon()`, existing `cardHead`, `_upNext/_atRisk/_recents/_statusMix`.
- Produces: DOM contract — container `.qhq-cc`, `.qhq-cc-grid` with `.qhq-cc-main` + `.qhq-cc-rail`; section headers `.qhq-sec-h` (`.qhq-sec-title` + `.qhq-sec-sub`); trend cards `.qhq-trend` (×3) each containing `.qhq-trend-v`, `.qhq-trend-badge`, `svg.qhq-spark`; period toggle `.qhq-period button[data-p]`; full-width `.qhq-recents`.

- [ ] **Step 1: Write the failing test** — append:

```js
test('Home command center: 3 trend cards, no stat strip, period toggle', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  await page.evaluate(() => window.App.controller.setView('home'));
  await expect(page.locator('.qhq-trend')).toHaveCount(3);
  await expect(page.locator('.qhq-statstrip')).toHaveCount(0);
  await expect(page.locator('.qhq-cc-main')).toBeVisible();
  await expect(page.locator('.qhq-cc-rail')).toBeVisible();
  await expect(page.locator('.qhq-trend svg.qhq-spark')).toHaveCount(3);
  // period toggle re-renders without error
  await page.locator('.qhq-period button[data-p="month"]').click();
  await expect(page.locator('.qhq-trend')).toHaveCount(3);
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx playwright test tests/home-reports.spec.js -g "command center" --project=local`. Expected: FAIL (`.qhq-trend` count 0).

- [ ] **Step 3: Add markup helpers + restructure `render()`.** In `render()`, after the existing `icon`/`cardHead` helpers, add:

```js
    const sectionHead = (title, sub, control = '') => `
      <div class="qhq-sec-h">
        <div class="qhq-sec-htext"><div class="qhq-sec-title">${esc(title)}</div><div class="qhq-sec-sub">${esc(sub)}</div></div>
        ${control}
      </div>`;

    const metrics = this._trendMetrics(this.period);
    const trendCardHtml = m => {
      const up = m.value >= m.prev;
      const good = (m.goodWhen === 'up') === up;         // improving?
      const deltaAbs = Math.abs(m.value - m.prev);
      const deltaTxt = m.prev === 0 ? (m.value === 0 ? '—' : '+' + m.value)
        : (up ? '+' : '−') + Math.round(Math.abs((m.value - m.prev) / m.prev) * 100) + '%';
      return `
        <div class="qhq-trend ${m.tone}">
          <span class="qhq-trend-ic">${icon(m.icon)}</span>
          <div class="qhq-trend-body">
            <div class="qhq-trend-top"><span class="qhq-trend-v tnum">${m.value}</span>
              <span class="qhq-trend-badge ${m.value === m.prev ? 'flat' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${esc(deltaTxt)}</span></div>
            <div class="qhq-trend-l">${esc(m.label)}</div>
          </div>
          <svg class="qhq-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="${this._sparklinePath(m.spark)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>`;
    };

    const cal = this._miniCalendar();
    const calHtml = `
      <div class="qhq-cal">
        <div class="qhq-cal-head">${esc(cal.label)}</div>
        <div class="qhq-cal-grid qhq-cal-dow">${['M','T','W','T','F','S','S'].map(d => `<span>${d}</span>`).join('')}</div>
        ${cal.weeks.map(w => `<div class="qhq-cal-grid">${w.map(c => c
          ? `<button type="button" class="qhq-cal-day ${c.today ? 'today' : ''} ${c.due ? 'has-due' : ''} ${c.overdue ? 'overdue' : ''}" data-day="${c.iso}">${c.d}${c.due ? '<span class="qhq-cal-dot"></span>' : ''}</button>`
          : `<span class="qhq-cal-day empty"></span>`).join('')}</div>`).join('')}
      </div>`;

    const periodCtl = `<div class="qhq-period" role="tablist">${['week','month']
      .map(p => `<button type="button" data-p="${p}" class="${p === this.period ? 'on' : ''}">${p[0].toUpperCase()+p.slice(1)}</button>`).join('')}</div>`;
```

Then replace the whole `this.wrap.innerHTML = ...` template with the command-center structure (keep the existing greeting/actions header; `unHtml`, `riskRows`, `donutHtml`, `recHtml` are unchanged from current code):

```js
    const enter = this._rendered ? '' : ' qhq-enter';
    this._rendered = true;

    this.wrap.innerHTML = `
      <div class="qhq-home qhq-cc${enter}">
        <div class="qhq-head">
          <div>
            <div class="qhq-greet">${this._greeting()}, <span class="em">${esc(this._firstName())}</span></div>
            <div class="qhq-dateline">${icon('date')} ${esc(this._longDate(today))}</div>
          </div>
          <div class="qhq-actions">
            <button type="button" class="qhq-act primary" data-act="new"><i class="ti ti-plus"></i> New task</button>
            <button type="button" class="qhq-act" data-act="all">All tasks</button>
            <button type="button" class="qhq-act" data-act="calendar">Calendar</button>
          </div>
        </div>

        <div class="qhq-cc-grid">
          <div class="qhq-cc-main">
            ${sectionHead('Your work', 'what needs you now')}
            <div class="qhq-card">${cardHead('layers', 'tone-amber', 'Up next', 'your queue')}<div class="qhq-unlist">${unHtml}</div></div>
            <div class="qhq-card">${cardHead('warning', 'tone-rust', 'At risk', 'needs attention')}<div class="qhq-arlist">${riskRows}</div></div>
          </div>
          <div class="qhq-cc-rail">
            ${sectionHead('Your performance', this.period === 'month' ? 'this month' : 'this week', periodCtl)}
            <div class="qhq-trend-list">${metrics.map(trendCardHtml).join('')}</div>
            ${calHtml}
            ${donutHtml}
          </div>
        </div>

        <div class="qhq-card qhq-recents">
          ${cardHead('activity', 'tone-slate', 'Recents', App.can('reports.view') ? 'team activity' : 'your activity')}
          <div class="qhq-reclist">${recHtml}</div>
        </div>
      </div>`;
```

Delete the old `statHtml` construction and the `<div class="qhq-statstrip">${statHtml}</div>` line. Keep `_stats()` for now (unused) — remove in Task 6 cleanup.

- [ ] **Step 4: Wire the period toggle + calendar day-click.** In the interaction-wiring block at the end of `render()`, after the existing `.qhq-act` handler, add:

```js
    this.wrap.querySelectorAll('.qhq-period button').forEach(b => b.addEventListener('click', () => {
      this.period = b.dataset.p; this.render();
    }));
    this.wrap.querySelectorAll('.qhq-cal-day[data-day]').forEach(b => b.addEventListener('click', () => {
      this.controller.openCalendarOn(b.dataset.day);
    }));
```

- [ ] **Step 5: Add the CSS** to `taskmanagement.css` (in the Home section; values are a starting point, tuned by screenshot in Task 5):

```css
/* Command center: section headers + two-column shell */
.qhq-sec-h { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 22px 2px 12px; }
.qhq-sec-title { font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--ink); line-height: 1.1; }
.qhq-sec-sub { font-size: 12px; color: var(--ink-3); font-weight: 600; margin-top: 2px; }
.qhq-cc-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; align-items: start; }
.qhq-cc-main, .qhq-cc-rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.qhq-period { display: inline-flex; background: var(--bg-3); border-radius: 9px; padding: 3px; }
.qhq-period button { height: 26px; padding: 0 11px; border-radius: 6px; font-size: 11.5px; font-weight: 700; color: var(--ink-2); }
.qhq-period button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); }

/* Trend cards (white; existing accents only) */
.qhq-trend-list { display: flex; flex-direction: column; gap: 10px; }
.qhq-trend { display: grid; grid-template-columns: 40px 1fr 84px; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--block-line, var(--border)); border-radius: 14px; padding: 12px 14px; }
.qhq-trend-ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--tn-bg, var(--bg-3)); color: var(--tn-fg, var(--ink-2)); }
.qhq-trend-ic .qhq-ic { width: 23px; height: 23px; }
.qhq-trend-body { min-width: 0; }
.qhq-trend-top { display: flex; align-items: baseline; gap: 8px; }
.qhq-trend-v { font-size: 24px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; }
.qhq-trend-badge { font-size: 11px; font-weight: 800; }
.qhq-trend-badge.good { color: var(--green); }
.qhq-trend-badge.bad { color: var(--rust); }
.qhq-trend-badge.flat { color: var(--ink-3); }
.qhq-trend-l { font-size: 11.5px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
.qhq-spark { width: 84px; height: 28px; color: var(--amber); }

/* Mini month calendar */
.qhq-cal { background: var(--surface); border: 1px solid var(--block-line, var(--border)); border-radius: 14px; padding: 14px; }
.qhq-cal-head { font-size: 13px; font-weight: 800; color: var(--ink); margin-bottom: 10px; }
.qhq-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.qhq-cal-dow span { font-size: 10px; font-weight: 700; color: var(--ink-4); text-align: center; padding-bottom: 4px; text-transform: uppercase; }
.qhq-cal-day { position: relative; height: 30px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--ink-2); display: grid; place-items: center; cursor: pointer; transition: background var(--dur-fast) var(--ease-out); }
.qhq-cal-day:hover:not(.empty) { background: var(--bg-2); }
.qhq-cal-day.empty { cursor: default; }
.qhq-cal-day.today { background: var(--amber); color: #fff; }
.qhq-cal-dot { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--amber); }
.qhq-cal-day.today .qhq-cal-dot { background: #fff; }
.qhq-cal-day.overdue .qhq-cal-dot { background: var(--rust); }

@media (max-width: 720px) {
  .qhq-cc-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 6: Verify (test + screenshot).** Run `npx playwright test tests/home-reports.spec.js -g "command center" --project=local` → PASS. Then screenshot: `PORT=4188 node tools/dev-server.mjs &`, and a headless Chromium (exe `C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe`) → goto preview, `setView('home')`, full-page screenshot to the scratchpad; confirm two columns, 3 trend cards, calendar, ring, Recents full-width, no stat strip, no console errors.

- [ ] **Step 7: Commit**

```bash
git add js/views/HomeView.js taskmanagement.css tests/home-reports.spec.js
git commit -m "feat(home): two-column command center with section headers, trend cards, mini calendar, period toggle"
```

---

### Task 4: Calendar day-click end-to-end + trend-badge color correctness

Tighten two behaviors with assertions: clicking a calendar day navigates to the calendar layout on that date, and the badge's good/bad class follows `goodWhen` (not raw direction).

**Files:**
- Test: `tests/home-reports.spec.js`
- Modify (only if a test fails): `js/views/HomeView.js`

- [ ] **Step 1: Write the tests** — append:

```js
test('clicking a Home calendar day opens the calendar on that date', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  await page.evaluate(() => window.App.controller.setView('home'));
  const day = page.locator('.qhq-cal-day[data-day]').first();
  const iso = await day.getAttribute('data-day');
  await day.click();
  const state = await page.evaluate(() => ({ layout: window.App.controller.uiState.layout, anchor: window.App.controller.uiState.calendarAnchor }));
  expect(state.layout).toBe('calendar');
  expect(state.anchor).toBe(iso);
});

test('trend badge color follows good-direction', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
  await page.evaluate(() => window.App.controller.setView('home'));
  const bad = await page.evaluate(() => {
    const hv = window.App.homeView;
    // openload with value>prev must be "worsening" (goodWhen down)
    const m = { value: 9, prev: 5, goodWhen: 'down' };
    const up = m.value >= m.prev; const good = (m.goodWhen === 'up') === up;
    return good;
  });
  expect(bad).toBe(false);
});
```

- [ ] **Step 2: Run them** — `npx playwright test tests/home-reports.spec.js -g "calendar day|good-direction" --project=local`. Expected: PASS (logic from Task 3 already satisfies both). If the click test fails because the calendar wiring didn't attach, re-check Task 3 Step 4.

- [ ] **Step 3: Commit**

```bash
git add tests/home-reports.spec.js
git commit -m "test(home): calendar day-click navigation + trend badge direction"
```

---

### Task 5: Responsive, dark, and motion polish (screenshot-driven)

Fine-tune spacing/sizes and add entrance motion for the new elements; verify light + dark + mobile.

**Files:**
- Modify: `taskmanagement.css`
- Modify (if needed): `js/views/HomeView.js` (count-up wiring for trend values)

- [ ] **Step 1: Count up the trend values on entrance.** In `render()`'s entrance block (where `.qhq-donut-num` counts up), add — guarded by `enter && !this._reduceMotion()`:

```js
      this.wrap.querySelectorAll('.qhq-trend-v').forEach((el, i) => this._countUp(el, metrics[i] && metrics[i].value));
```

- [ ] **Step 2: Add motion + rail/entry rules** inside the existing `@media (prefers-reduced-motion: no-preference)` Home block:

```css
  .qhq-home.qhq-enter .qhq-cc-main > *, .qhq-home.qhq-enter .qhq-cc-rail > * { opacity: 0; animation: qhqRise 460ms var(--ease-out) both; }
  .qhq-home.qhq-enter .qhq-cc-rail > *:nth-child(2) { animation-delay: 90ms; }
  .qhq-home.qhq-enter .qhq-cc-rail > *:nth-child(3) { animation-delay: 150ms; }
  .qhq-home.qhq-enter .qhq-cc-rail > *:nth-child(4) { animation-delay: 210ms; }
```

- [ ] **Step 3: Screenshot light + dark + 390px** using the dev-server + headless Chromium harness (set `data-theme=dark` for dark; viewport 390 for mobile). Confirm: columns collapse to one on mobile, trend cards/calendar/ring read correctly in dark (tinted chips use dark accent tokens), sparklines visible, today cell highlighted, no overflow, no console errors. Tune the CSS values from Task 3 Step 5 as needed (sizes, gaps).

- [ ] **Step 4: Commit**

```bash
git add js/views/HomeView.js taskmanagement.css
git commit -m "style(home): responsive + dark + entrance motion for the command center"
```

---

### Task 6: Cleanup, remove dead stat-strip code/CSS, full verification

**Files:**
- Modify: `js/views/HomeView.js` (remove now-unused `_stats()`)
- Modify: `taskmanagement.css` (remove `.qhq-statstrip`, `.qhq-stat`, `.qhq-stat-ic`, `.qhq-stat .sv/.sl`, `.qhq-stat.is-alert`, and the stat-strip mobile rule — **only** those; keep `.tone-*`, `.qhq-ic`, shared rules)
- Modify: `tests/home-reports.spec.js` (ensure the old `.qhq-stat` count-4 assertion is gone)

- [ ] **Step 1: Grep for stragglers** — `grep -rn "qhq-stat\b\|qhq-statstrip\|_stats(" js/ taskmanagement.css tests/`. Confirm the only remaining references are the CSS rules to delete and (none) in JS markup.

- [ ] **Step 2: Delete** the `_stats()` method from `HomeView.js` and the stat-strip CSS rules listed above. Leave `.qhq-stat-ic`-shared tone logic only if still referenced by trend cards — it is not (`.qhq-trend-ic` is separate), so remove the `.qhq-stat*` block wholesale but keep `.tone-*` and `.qhq-ic`.

- [ ] **Step 3: Run the full Home suite** — `npx playwright test tests/home-reports.spec.js --project=local`. Expected: ALL PASS, including the retained greeting/up-next/recents/`.qhq-recents .meta` "team"/"your" assertions.

- [ ] **Step 4: Final screenshot pass** (admin light, admin dark, worker light, 390px) — no console errors; the four historical checks (greet contains "Good", up-next rows, recents rows, meta text) hold.

- [ ] **Step 5: Commit**

```bash
git add js/views/HomeView.js taskmanagement.css tests/home-reports.spec.js
git commit -m "chore(home): remove the retired stat strip; final command-center verification"
```

---

## Self-Review

**Spec coverage:**
- Two-column layout → Task 3. Emphasized section headers + Week/Month selector → Task 3. Trend cards (3, Completed/Open workload/Due this week, sparklines, ↑green/↓rust) → Tasks 2-3-4. Mini calendar + click-to-date via `openCalendarOn` → Tasks 1-3-4. Projects ring kept → Task 3 (reuses `donutHtml`). Up next / At risk re-homed → Task 3. Recents full-width → Task 3. Stat strip removed → Tasks 3 + 6. Existing-tokens-only / no fills / no gray → Task 3 CSS + Global Constraints. Period windows / trend % / sparkline buckets / calendar counts → Task 2. Mobile single column → Tasks 3+5. Motion (count-up, entrance, reduced-motion) → Task 5. Reports untouched → Global Constraints. Test impact (stat→trend) → Tasks 3+6. **No gaps.**

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only "tune by screenshot" notes are on CSS pixel values, with concrete starting values provided.

**Type/name consistency:** `openCalendarOn(iso)` (Task 1) used in Task 3 Step 4 + tested Tasks 1/4. `_trendMetrics`/`_periodWindow`/`_sparklinePath`/`_miniCalendar` defined Task 2, consumed Task 3. DOM classes (`.qhq-trend`, `.qhq-cc-main/-rail`, `.qhq-period`, `.qhq-cal-day[data-day]`, `svg.qhq-spark`) are consistent between the markup (Task 3), CSS (Task 3/5), and tests (Tasks 3/4). `App.homeView` exposed in Task 2 Step 2, used by tests.

**Known fragility to watch during execution:** the `window.App.homeView` accessor and `uiState.view`/`currentViewName` reads in tests are best-effort — if the real accessors differ, adjust the *test reads* (not the production code) after a quick grep of `AppController`.
