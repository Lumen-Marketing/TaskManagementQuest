# UI Redesign Phase 1 (Theme + Chrome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole app read like the `quest-hq-reports-standalone.html` mockup by evolving the existing `body.ui-command-center` skin — orange accent, Inter, full-height sidebar, relocated chrome, topbar title + scope segment.

**Architecture:** All visual changes stay scoped under `body.ui-command-center` (the active skin) so base light/dark themes are untouched. DOM nodes are relocated but keep their existing `id`s so `TopbarView`/`SidebarView` bindings keep working. New behavior (scope segment, Ask Quest) reuses existing controller methods only.

**Tech Stack:** Zero-build static SPA — vanilla JS + CSS, IBM Plex→Inter via Google Fonts, Tabler icons, Playwright for tests.

## Global Constraints

- No framework / no build step. Edits are plain JS + CSS.
- Mobile-first: every change must hold at ≤720px with no horizontal overflow; `.app` columns use `minmax(0,1fr)` (known grid-clipping bug).
- All skin CSS scoped under `body.ui-command-center`; do not alter base `[data-theme]` tokens.
- Preserve element ids: `searchInput`, `clockWidget`, `clockLabel`, `clockTimer`, `notifBtn`, `notifPanel`, `userAvatar`, `viewAsSwitcher`.
- Accent palette (verbatim): accent `#ED4E0D`, tint `#FDEDE6`, press `#CE430A`. Surfaces `--bg #F5F6F8`, `--surface #FFFFFF`, sidebar `#FBFBFD`. Ink `#16191D / #5A626B / #929AA3 / #B6BCC4`. Border `#EAECF0 / #E2E5EA`. Status: green `#2E9E6B`, over `#E0484D`, warn `#E08A0B`, blue `#3E7BF2`, lilac `#8268DC`.

---

### Task 1: Palette + fonts

**Files:**
- Modify: `app.html` (Google Fonts `<link>`, line 17)
- Modify: `taskmanagement.css` (`body.ui-command-center` token block, ~4106-4138)

**Interfaces:**
- Produces: the orange/Inter token values every later task relies on.

- [ ] **Step 1: Add Inter + JetBrains Mono to the font link.** In `app.html` line 17, append to the `family=` query: `&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600`.

- [ ] **Step 2: Rewrite the `body.ui-command-center` token block** (`taskmanagement.css` ~4106) with the mockup palette:

```css
body.ui-command-center{
  --font-body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --font-display:var(--font-body);
  --font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --bg:#F5F6F8; --bg-2:#FAFBFC; --bg-3:#FBFBFD; --surface:#FFFFFF;
  --ink:#16191D; --ink-2:#5A626B; --ink-3:#929AA3; --ink-4:#B6BCC4;
  --border:#EAECF0; --border-strong:#E2E5EA;
  --amber:#ED4E0D; --amber-bg:#FDEDE6; --amber-ink:#CE430A;
  --rust:#E0484D; --rust-bg:#FCEDED; --rust-ink:#C53B40;
  --blue:#3E7BF2; --blue-bg:#EAF1FE; --blue-ink:#2459C5;
  --green:#2E9E6B; --green-bg:#E8F5EE; --green-ink:#258257;
  --u-critical:#E0484D; --u-urgent:#E0484D; --u-high:#E08A0B; --u-medium:#3E7BF2; --u-low:#929AA3;
  --shadow-sm:0 1px 2px rgba(18,22,28,.05),0 1px 1px rgba(18,22,28,.03);
  --shadow-md:0 10px 28px -10px rgba(18,22,28,.16),0 2px 6px rgba(18,22,28,.05);
  --shadow-lg:0 28px 64px -18px rgba(18,22,28,.30),0 10px 24px -10px rgba(18,22,28,.14);
  background:var(--bg); color:var(--ink);
}
```
Also update the primary-button hover (~4222-4226) to `background:var(--amber-ink);border-color:var(--amber-ink);` and the logo (~4171-4184) gradient to `linear-gradient(150deg,#F2581A,#D8410A)`.

- [ ] **Step 3: Verify visually.** Serve the app (`python -m http.server` in repo root) and open `app.html`. Expected: accent is orange (logo, primary button, active nav, clock pulse), surfaces white on light-gray bg, body text in Inter. No console errors.

- [ ] **Step 4: Commit.**
```bash
git add app.html taskmanagement.css
git commit -m "style(redesign): orange accent + Inter palette for command-center skin"
```

---

### Task 2: Full-height sidebar + brand relocation

**Files:**
- Modify: `app.html` (move `.topbar-left` block from topbar into a new sidebar header)
- Modify: `taskmanagement.css` (`body.ui-command-center` grid + sidebar header rules)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `.app` grid with `.deck` spanning both rows; brand markup living inside `.sidebar`.

- [ ] **Step 1: Move the brand markup.** Cut the `<div class="topbar-left">…</div>` block (`app.html` 39-45) out of `.topbar` and paste it as the first child inside `.sidebar` (before `.side-minimize-btn`), wrapping it as `<div class="side-brand">…</div>` (keep the `.logo`, `.brand-name`, `.brand-sub` inner markup and add the existing chevron icon).

- [ ] **Step 2: Override the grid** under `body.ui-command-center`:
```css
body.ui-command-center .app{grid-template-columns:248px minmax(0,1fr);grid-template-rows:54px 1fr}
body.ui-command-center .app>.deck{grid-column:1;grid-row:1 / -1}
body.ui-command-center .app>.topbar{grid-column:2;grid-row:1}
body.ui-command-center .app>.main{grid-column:2;grid-row:2}
body.ui-command-center .side-brand{display:flex;align-items:center;gap:10px;padding:14px 12px 12px}
```
Update the minimized rule (`body.sidebar-minimized.ui-command-center .app{grid-template-columns:68px minmax(0,1fr)}`) and hide brand text when minimized.

- [ ] **Step 3: Verify.** Reload. Expected: full-height white sidebar with "Q / Quest HQ" at top; topbar only spans the main pane; collapse button still toggles to 68px strip; mobile (≤720px) still opens the drawer.

- [ ] **Step 4: Commit.**
```bash
git add app.html taskmanagement.css
git commit -m "style(redesign): true full-height sidebar with brand header"
```

---

### Task 3: Ask Quest bar + sidebar footer (clock + user chip)

**Files:**
- Modify: `app.html` (add Ask Quest button under brand; add sidebar footer; move `#clockWidget` + `#userAvatar` into it)
- Modify: `taskmanagement.css` (footer + kbar styles)
- Modify: `js/views/TopbarView.js` (user-menu positioning for a left-anchored avatar)
- Modify: `js/views/SidebarView.js` (wire Ask Quest → focus search)

**Interfaces:**
- Consumes: Task 2 sidebar.
- Produces: `.kbar` button, `.side-foot` footer holding the existing clock + a `.userchip` wrapping `#userAvatar`.

- [ ] **Step 1: Add the Ask Quest bar** in `app.html` inside `.sidebar`, after `.side-brand`:
```html
<button type="button" class="kbar" id="askQuestBtn"><i class="ti ti-sparkles"></i><span>Ask Quest…</span><span class="kbd">⌘K</span></button>
```

- [ ] **Step 2: Add the footer + relocate clock/avatar.** Move the `#clockWidget` button and `#userAvatar` button out of `.topbar-right` into a new `<div class="side-foot">` appended as the last child of `.sidebar`. Wrap the avatar as `<div class="userchip"> <button id="userAvatar" …>…</button> <div class="uc-meta"><div class="uc-name">…</div><div class="uc-role">…</div></div> </div>`. Keep all ids/classes/attrs on `#clockWidget` and `#userAvatar` unchanged.

- [ ] **Step 3: Style** `.kbar`, `.side-foot`, `.userchip` under `body.ui-command-center` per the mockup (kbar = 32px white rounded bar with `⌘K` chip; foot = top-bordered, padding 9px 12px; clock full-width; userchip row).

- [ ] **Step 4: Wire Ask Quest** in `SidebarView` constructor: `const ask=document.getElementById('askQuestBtn'); if(ask) ask.addEventListener('click',()=>{const s=document.getElementById('searchInput'); if(s) s.focus();});`

- [ ] **Step 5: Fix user-menu anchoring.** In `TopbarView.toggleUserMenu` (~230-234), replace the right-anchored positioning with left-anchored for the sidebar avatar:
```js
const rect = this.avatar.getBoundingClientRect();
menu.style.position='fixed';
menu.style.bottom=(window.innerHeight-rect.top+6)+'px';
menu.style.left=rect.left+'px';
menu.style.right='auto';
```

- [ ] **Step 6: Verify.** Reload. Expected: clock-in/out works from the sidebar footer (timer ticks); user chip shows avatar+name+role; clicking it opens the account menu above it, fully on-screen; Ask Quest focuses the topbar search.

- [ ] **Step 7: Commit.**
```bash
git add app.html taskmanagement.css js/views/TopbarView.js js/views/SidebarView.js
git commit -m "style(redesign): Ask Quest bar + sidebar footer (clock + user chip)"
```

---

### Task 4: Sidebar group labels (Personal / Team / Workspaces)

**Files:**
- Modify: `app.html` (static group `.side-label` text → "Personal")
- Modify: `js/views/SidebarView.js` (`_buildSections` group labels)

**Interfaces:**
- Consumes: existing nav items; produces the mockup's three section headers using existing items (no new items in Phase 1).

- [ ] **Step 1:** In `app.html`, change the static Workspace group label (`<div class="side-label">Workspace</div>`, line 91) to `Personal`.

- [ ] **Step 2:** In `SidebarView._buildSections` (`SidebarView.js` ~192-238), relabel sections so the rendered headers read as the mockup: keep the `company` section label as **"Workspaces"**; group the `time`(team)/`org`/`admin` items under a single **"Team"** header (merge their items into one section keyed `team` while preserving each item's existing `view`/permission gating); leave the personal `time:mine` item under the static Personal group is not required — keep `time:mine` in its own grouping as today. Net rendered headers: Personal, Team, Workspaces.

- [ ] **Step 3: Verify.** Reload as admin and as worker (use the developer View-as switcher). Expected: headers read Personal / Team / Workspaces; every item still navigates; gated items (Approvals, Team workload) hidden for worker.

- [ ] **Step 4: Commit.**
```bash
git add app.html js/views/SidebarView.js
git commit -m "style(redesign): regroup sidebar nav into Personal/Team/Workspaces"
```

---

### Task 5: Topbar title + My work / Company segment

**Files:**
- Modify: `app.html` (add `#tbTitle` + `.seg` to topbar-left area)
- Modify: `js/views/TopbarView.js` (sync title + segment on `view:changed`)
- Test: `tests/redesign-topbar.spec.js`

**Interfaces:**
- Consumes: `controller.setView`, `controller.uiState.view`, `view:changed` event.
- Produces: `#tbTitle` text + `.seg button[data-scope]` active state.

- [ ] **Step 1: Add markup** to the (now brand-free) topbar left in `app.html`:
```html
<div class="topbar-left">
  <span class="tb-title" id="tbTitle">All tasks</span>
  <div class="seg" id="scopeSeg">
    <button data-scope="mine">My work</button>
    <button data-scope="all">Company</button>
  </div>
</div>
```

- [ ] **Step 2: Write the failing Playwright test** `tests/redesign-topbar.spec.js`:
```js
const { test, expect } = require('@playwright/test');
test('scope segment switches view and title', async ({ page }) => {
  await page.goto('/app.html');
  await page.locator('#scopeSeg button[data-scope="mine"]').click();
  await expect(page.locator('.seg button[data-scope="mine"]')).toHaveClass(/on/);
  await page.locator('#scopeSeg button[data-scope="all"]').click();
  await expect(page.locator('.seg button[data-scope="all"]')).toHaveClass(/on/);
  await expect(page.locator('#tbTitle')).toContainText('All');
});
```

- [ ] **Step 3: Run it, expect FAIL** (`on` class never applied / title static). `npx playwright test tests/redesign-topbar.spec.js`.

- [ ] **Step 4: Implement** in `TopbarView`: add a `TITLES` map (`all:'All tasks', mine:'My tasks', hot:'Urgent', today:'Today', overdue:'Overdue', watching:'Watching', 'time:mine':'My time', 'time:resource':'Team workload', 'team:hierarchy':'Team chart', approvals:'Approvals', 'admin:clock':'Clock dashboard'`); a `renderTopbarTitleAndScope()` that sets `#tbTitle` text and toggles `.on` on the `[data-scope]` button matching the current view (`mine`→view `mine`, else `all` active only when view==='all'); bind the two buttons to `controller.setView(btn.dataset.scope)`; call it in `render()` and subscribe to `view:changed`.

- [ ] **Step 5: Style** `.seg`/`.tb-title` under `body.ui-command-center` per the mockup (segmented pill, active=white card).

- [ ] **Step 6: Run the test, expect PASS.**

- [ ] **Step 7: Commit.**
```bash
git add app.html js/views/TopbarView.js tests/redesign-topbar.spec.js taskmanagement.css
git commit -m "feat(redesign): topbar title + My work/Company scope segment"
```

---

### Task 6: Mobile + regression verification

**Files:**
- Test: `tests/redesign-topbar.spec.js` (extend) + manual visual

- [ ] **Step 1: Add a mobile smoke** to the spec: at viewport 390×800, assert no horizontal overflow (`scrollWidth <= clientWidth + 1` on `document.documentElement`) and that tapping `.topbar-left` (or menu hint) opens the drawer (`body.sidebar-open`).

- [ ] **Step 2: Run full suite** `npx playwright test` and the existing preview/critical specs; expect PASS.

- [ ] **Step 3: Visual check** desktop (1280) + 390px against the mockup using the verify skill / screenshots: orange accent, full-height sidebar, footer clock+user, topbar title+segment, drawer on mobile.

- [ ] **Step 4: Regression** — toggle to the base light theme via the account menu and confirm non-command-center rendering is unaffected (the skin overrides only apply under `body.ui-command-center`).

- [ ] **Step 5: Commit any fixes.**
```bash
git add -A && git commit -m "test(redesign): phase-1 mobile + regression smoke"
```

## Self-review notes
- Spec coverage: fonts+palette (T1), full-height sidebar+brand (T2), Ask Quest+footer clock/user (T3), grouping (T4), topbar title+segment (T5), mobile/regression (T6) — all §1-6 of the spec covered.
- Element ids preserved across relocations (T2/T3) so existing bindings hold; user-menu reposition handled in T3 step 5.
- "Start review" primary button intentionally stays "New task" (Meeting Mode out of scope).
