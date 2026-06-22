# UI Redesign Phase 3 — Focused Polish Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the AI ops-brief banner to Home, give the Approvals/Time tables a card treatment, and apply a small global radius nudge so every surface matches the Home/Reports Linear/Notion look.

**Architecture:** Zero-build vanilla-JS SPA. All visual changes are CSS appended to `taskmanagement.css`, scoped under `body.ui-command-center` so base light/dark themes are untouched. One markup removal in `app.html` plus one dead-handler removal in `js/views/TaskListView.js`. Higher-specificity `body.ui-command-center .X` rules override base `.X` rules regardless of source order, so new CSS is appended at end-of-file.

**Tech Stack:** HTML, vanilla JS (App.* global namespace), CSS custom properties (tokens in `tokens.css`), Playwright specs (CI) + local chromium `executablePath` verification scripts.

## Global Constraints

- No DB migration, no new perms, no framework, no new dependencies.
- All new CSS scoped under `body.ui-command-center` (verbatim from spec).
- Radius tokens are fixed in `tokens.css`: `--radius-sm: 10px`, `--radius-md: 14px`. Do NOT change `tokens.css`; only reference these tokens.
- Mobile-first: re-verify every surface at 390px in addition to desktop.
- Keep dense layouts (list rows, calendar cells, chips/pills, filter chips) on their current small radius — only soften card-like containers (modals, menus, kanban cards/columns, the Time/Approvals table cards).
- Local verification: dev server runs on port 4188 (`PORT=4188 node tools/dev-server.mjs`); the Playwright runner can't run locally (missing headless-shell build) so verify with chromium `executablePath` scripts. Preview bypass URL: `/app.html?preview=1&role=<role>&member=abraham`. Press Escape after load to dismiss the onboarding tour. Chromium exe: `C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe`.
- Branch: `feat/home-and-reports`.

---

## File Structure

- `app.html` — remove the static `.ai-brief` `<section>` (lines 163–178).
- `js/views/TaskListView.js` — remove the dead `[data-brief-view]` click binding (lines 35–37).
- `taskmanagement.css` — append one Phase-3 block at EOF (currently 4751 lines): table card treatment + radius nudge, all under `body.ui-command-center`.
- `tests/home-reports.spec.js` — add one assertion: `.ai-brief` is absent on the task list view (CI).
- `verify_out/_p3verify.mjs` — local before/after screenshot + JS-error verification script (Create).

---

## Task 1: AI ops-brief → Home only

Remove the static AI-brief banner so it no longer leaks onto the task list, Kanban, calendar, Time, Approvals, and Hierarchy surfaces. Home keeps its own `.qhq-brief` (in `HomeView.js`), which is untouched. The Overdue / Critical+urgent / Watching quick chips are dropped with the block (decision: reachable via sidebar + Filter menu).

**Files:**
- Modify: `app.html:163-178`
- Modify: `js/views/TaskListView.js:35-37`
- Test: `tests/home-reports.spec.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on (independent change).

- [ ] **Step 1: Add the failing CI assertion**

In `tests/home-reports.spec.js`, append this test after the existing `admin sees Reports...` test (before the final closing of the file):

```js
test('the AI ops-brief banner is gone from the task list', async ({ page }) => {
  await boot(page, 'admin');
  await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
  await page.waitForTimeout(300);
  // The static `.ai-brief` banner must not exist on any task surface anymore.
  expect(await page.locator('.ai-brief').count()).toBe(0);
  // Home still has its own brief.
  await page.evaluate(() => App.controller.setView('home'));
  await expect(page.locator('.qhq-brief')).toBeVisible();
});
```

- [ ] **Step 2: Verify it fails (locally, via chromium script)**

Create `verify_out/_p3t1.mjs`:

```js
import { chromium } from '@playwright/test';
const EXE = 'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const page = await (await browser.newContext({ viewport:{width:1320,height:1000} })).newPage();
await page.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham', { waitUntil:'networkidle' });
await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.evaluate(() => { App.controller.setView('all'); App.controller.setLayout('table'); });
await page.waitForTimeout(300);
const briefOnList = await page.locator('.ai-brief').count();
await page.evaluate(() => App.controller.setView('home'));
await page.waitForTimeout(300);
const qhqBrief = await page.locator('.qhq-brief').count();
console.log(JSON.stringify({ briefOnList, qhqBrief }));
await browser.close();
```

Run (dev server must be up on 4188):

```bash
node verify_out/_p3t1.mjs
```

Expected BEFORE the change: `{"briefOnList":1,"qhqBrief":1}` — i.e. the banner is still on the list (the desired state is `briefOnList:0`, so this confirms the gap).

- [ ] **Step 3: Remove the `.ai-brief` section from `app.html`**

Delete these exact lines (`app.html:163-178`):

```html
      <section class="ai-brief" aria-label="Quest AI operations brief">
        <div class="ai-brief-head">
          <span class="ai-brief-icon"><i class="ti ti-sparkles" aria-hidden="true"></i></span>
          <span class="ai-brief-title">Your ops brief</span>
          <span class="ai-brief-badge">QUEST AI</span>
          <span class="ai-brief-time">live workspace context</span>
        </div>
        <p class="ai-brief-copy">
          Prioritize overdue and high-impact work first. Use the side filters to review company queues, team workload, and blocked tasks without changing the underlying task data.
        </p>
        <div class="ai-brief-actions" aria-label="Suggested review paths">
          <button type="button" class="ai-chip" data-brief-view="overdue"><span></span>Overdue</button>
          <button type="button" class="ai-chip" data-brief-view="hot"><span></span>Critical + urgent</button>
          <button type="button" class="ai-chip" data-brief-view="watching"><span></span>Watching</button>
        </div>
      </section>

```

(The blank line after `</section>` goes too, so `.page-head` is followed directly by `<div id="filterBar" ...>`.)

- [ ] **Step 4: Remove the dead `[data-brief-view]` binding in `TaskListView.js`**

Delete these exact lines (`js/views/TaskListView.js:35-37`):

```js
    document.querySelectorAll('[data-brief-view]').forEach(btn => {
      btn.addEventListener('click', () => this.controller.setView(btn.dataset.briefView));
    });
```

Leave the surrounding `bindEvents()` method and the `#layoutSwitcher` binding directly above it intact.

- [ ] **Step 5: Verify it passes + no JS errors**

Re-run:

```bash
node verify_out/_p3t1.mjs
```

Expected AFTER: `{"briefOnList":0,"qhqBrief":1}` — banner gone from the list, Home brief intact.

Then confirm no console errors by adding a quick error capture (run this inline script):

```bash
node -e "import('@playwright/test').then(async ({chromium})=>{const b=await chromium.launch({executablePath:'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});const p=await(await b.newContext()).newPage();const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(String(e)));await p.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham',{waitUntil:'networkidle'});await p.waitForTimeout(900);for(const v of ['all','time:resource','approvals','team:hierarchy']){await p.evaluate(x=>App.controller.setView(x),v);await p.waitForTimeout(400)}console.log('ERRORS:'+JSON.stringify(errs));await b.close()})"
```

Expected: `ERRORS:[]`.

- [ ] **Step 6: Commit**

```bash
git add app.html js/views/TaskListView.js tests/home-reports.spec.js
git commit -m "feat(ui): restrict AI ops-brief to Home; drop banner from other surfaces"
```

---

## Task 2: Global radius nudge for card-like containers

Soften the modal, dropdown menus, and Kanban cards/columns from `--radius-sm` (10px) to `--radius-md` (14px) so they match the Home/Reports cards. Scoped under `body.ui-command-center`. No markup changes.

**Files:**
- Modify: `taskmanagement.css` (append at EOF, currently line 4751)
- Verify: `verify_out/_p3shots.mjs` (already exists — re-run for before/after)

**Interfaces:**
- Consumes: radius tokens `--radius-md` from `tokens.css`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Capture BEFORE screenshots**

With the dev server up on 4188, run the existing capture scripts:

```bash
node verify_out/_p3shots.mjs && node verify_out/_p3shots2.mjs
```

Copy the modal + kanban shots aside for comparison:

```bash
cp verify_out/p3_modal.png verify_out/before_modal.png && cp verify_out/p3_kanban.png verify_out/before_kanban.png
```

- [ ] **Step 2: Append the radius-nudge CSS at EOF of `taskmanagement.css`**

Add exactly this block at the end of the file:

```css

/* ============================================================
   Phase 3 polish — radius nudge for card-like containers.
   Card-like surfaces move to --radius-md (14px) to match
   Home/Reports. Dense layouts (rows, cells, chips) keep their
   smaller radius. Scoped to the command-center skin only.
   ============================================================ */
body.ui-command-center .modal { border-radius: var(--radius-md); }
body.ui-command-center .toolbar-menu { border-radius: var(--radius-md); }
body.ui-command-center .kanban-col { border-radius: var(--radius-md); }
body.ui-command-center .kanban-card { border-radius: var(--radius-md); }
```

- [ ] **Step 3: Capture AFTER screenshots and compare**

```bash
node verify_out/_p3shots.mjs && node verify_out/_p3shots2.mjs
```

Read `verify_out/p3_modal.png` and `verify_out/p3_kanban.png` and compare to the `before_*` copies. Expected: modal corners and kanban card/column corners are visibly rounder (14px); everything else unchanged; no clipping of content at the rounded corners.

- [ ] **Step 4: Verify mobile (390px) is unaffected**

Run:

```bash
node -e "import('@playwright/test').then(async ({chromium})=>{const b=await chromium.launch({executablePath:'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});const p=await(await b.newContext({viewport:{width:390,height:780}})).newPage();await p.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham',{waitUntil:'networkidle'});await p.waitForTimeout(900);await p.keyboard.press('Escape');await p.evaluate(()=>{App.controller.setView('all');App.controller.setLayout('kanban')});await p.waitForTimeout(500);await p.screenshot({path:'verify_out/p3_kanban_390.png'});await b.close()})"
```

Read `verify_out/p3_kanban_390.png`. Expected: kanban renders cleanly at 390px with rounded cards, no horizontal overflow.

- [ ] **Step 5: Commit**

```bash
git add taskmanagement.css
git commit -m "style(ui): nudge modal/menu/kanban radius to --radius-md for Home/Reports parity"
```

---

## Task 3: Approvals + Time tables — card treatment

The Time and Approvals tables already use `--surface`/`--border`/`--radius-sm` but read flat. Lift them to the Reports card aesthetic: `--radius-md` corners + a soft shadow, while preserving the existing `.live` active-timer highlight and the ≤1200px Approvals table→card stacking. Scoped under `body.ui-command-center`.

**Files:**
- Modify: `taskmanagement.css` (append after the Task-2 block at EOF)
- Verify: `verify_out/_p3shots2.mjs` (Time) + `verify_out/_p3shots.mjs` (Approvals shot was `p3_approvals.png`)

**Interfaces:**
- Consumes: radius tokens + `--shadow-sm` from `tokens.css`/existing token block.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Capture BEFORE screenshots**

```bash
node verify_out/_p3shots.mjs && node verify_out/_p3shots2.mjs
cp verify_out/p3_approvals.png verify_out/before_approvals.png && cp verify_out/p3_timeresource.png verify_out/before_time.png
```

- [ ] **Step 2: Append the table card-treatment CSS at EOF of `taskmanagement.css`**

Add exactly this block at the end of the file (after the Task-2 block):

```css

/* ============================================================
   Phase 3 polish — card treatment for the Time & Approvals
   tables. They already use --surface/--border; this rounds the
   corners to --radius-md and adds a soft shadow so they read
   like the Reports cards. Stat cards get the same radius.
   Responsive table→card stacking (≤1200px) is untouched.
   ============================================================ */
body.ui-command-center .time-table,
body.ui-command-center .approval-scroll .time-table {
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
body.ui-command-center .time-card { border-radius: var(--radius-md); }
```

(`.approval-table` is itself a `.time-table` in the markup — the `.approval-scroll .time-table` selector covers the Approvals roster; including the bare `.time-table` covers the Time views.)

- [ ] **Step 3: Capture AFTER screenshots and compare**

```bash
node verify_out/_p3shots.mjs && node verify_out/_p3shots2.mjs
```

Read `verify_out/p3_approvals.png` and `verify_out/p3_timeresource.png`; compare to `before_*`. Expected: both tables now have rounded corners + a subtle shadow lifting them off the page; column headers, rows, and the green live-row highlight unchanged.

- [ ] **Step 4: Verify Approvals stacked-card mode (≤1200px) still works**

```bash
node -e "import('@playwright/test').then(async ({chromium})=>{const b=await chromium.launch({executablePath:'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});const p=await(await b.newContext({viewport:{width:1100,height:900}})).newPage();await p.goto('http://localhost:4188/app.html?preview=1&role=admin&member=abraham',{waitUntil:'networkidle'});await p.waitForTimeout(900);await p.keyboard.press('Escape');await p.evaluate(()=>App.controller.setView('approvals'));await p.waitForTimeout(500);await p.screenshot({path:'verify_out/p3_approvals_1100.png',fullPage:true});await b.close()})"
```

Read `verify_out/p3_approvals_1100.png`. Expected: each approval row is a self-contained stacked card with labels beside controls; no sideways scroll; no broken layout from the new radius/shadow.

- [ ] **Step 5: Full-surface regression sweep (zero JS errors)**

```bash
node -e "import('@playwright/test').then(async ({chromium})=>{const b=await chromium.launch({executablePath:'C:/Users/tagal/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});const p=await(await b.newContext()).newPage();const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(String(e)));await p.goto('http://localhost:4188/app.html?preview=1&role=developer&member=abraham',{waitUntil:'networkidle'});await p.waitForTimeout(900);for(const v of ['home','all','reports','time:resource','time:mine','approvals','team:hierarchy']){await p.evaluate(x=>App.controller.setView(x),v);await p.waitForTimeout(400)}console.log('ERRORS:'+JSON.stringify(errs));await b.close()})"
```

Expected: `ERRORS:[]`.

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css
git commit -m "style(ui): give Time & Approvals tables the Reports card treatment"
```

---

## Self-Review

**Spec coverage:**
- Spec A (AI brief → Home only) → Task 1. ✓
- Spec B (Approvals + Time table card treatment) → Task 3. ✓
- Spec C (small global radius nudge) → Task 2. ✓
- Spec testing/verification (before/after all surfaces, mobile, zero-error sweep, existing specs green, `.ai-brief` absent assertion) → covered across Task 1 Step 5, Task 2 Steps 3–4, Task 3 Steps 3–5, and the Task 1 CI assertion. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps; every CSS/JS/test step shows the exact content. ✓

**Type/selector consistency:** Selectors match the verified source — `.ai-brief` (app.html:163), `[data-brief-view]` (TaskListView.js:35), `.modal`/`.toolbar-menu`/`.kanban-col`/`.kanban-card`/`.time-table`/`.time-card` all confirmed to currently use `--radius-sm`; `--radius-md` (14px) is defined in tokens.css. Approvals roster is a `.time-table` inside `.approval-scroll`. ✓

**Scope:** Single focused plan, no decomposition needed. ✓
