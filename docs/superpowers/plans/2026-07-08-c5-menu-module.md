# C5 — Menu Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deep Menu module (CONTEXT.md: Menu) owning the transient-chooser choreography — positioning, click-away, Escape, passive repositioning, focus return, aria-expanded — with two presentation adapters (anchored popover + bottom sheet). Call sites keep their content and item wiring; the drifted copies of the choreography get deleted.

**Architecture:** `App.Menu.open(opts)` returns a close handle. Existing CSS classes pass through via `opts.className`, so **zero visual change**. Migration is staged by risk: the four heavyweight fixed-position popovers first (worst duplication), then the quick sheet (sheet adapter's proving call site), then TaskDetailView's four pickers, then the always-attached-listener menus (kills the leak class). Inventory evidence: 20 implementations / ~1,200 LOC found (Explore sweep 2026-07-08); the audit's "8" undercounted. Out of scope, recorded: composer mention menu (blur-driven, editor-coupled), reaction picker (8-line delegated toggle), sidebar drawer (a drawer, not a Menu).

**Tech Stack:** vanilla JS, existing preview harnesses as gates (tasklist-preview has the status menu, column filter, quick sheet; taskdetail-preview has the four pickers + overflow).

## Global Constraints

- **Zero visual change** — each site keeps its CSS classes and inner markup; only choreography moves. Gate every task with the relevant preview harness (light + dark where themed) plus interaction probes (open → click-away closes; open → Esc closes; anchor aria-expanded toggles; focus returns).
- **One menu at a time:** opening any Menu closes the currently-open one (module-level current handle) — matches today's effective behavior.
- **Listener hygiene is the point:** all document/window listeners are added on open and removed on close, symmetric, with `scroll` passive+capture. No always-attached document listeners remain at migrated sites.
- **Per-call-site presentation opt-in** (grilled decision): everything keeps its current presentation on day one; the sheet adapter exists because the quick sheet migrates onto it. No picker flips to sheet-on-mobile without boss sign-off.
- Worktree `worktree-c5-menu-c4-directory`; verify branch each commit; `npm run test:unit` before each commit.

---

### Task 1: The Menu module

**Files:**
- Create: `js/ui/Menu.js`
- Modify: `app.html` (script tag, defer, in the Foundation block after `js/utils/motion.js`), `tasklist-preview.html`, `taskdetail-preview.html` (plain tags before their view scripts)

**Interfaces:**
- Produces (the seam):
```js
App.Menu.open({
  anchor,                    // Element — required for 'anchored'; the aria-expanded target
  present = 'anchored',      // 'anchored' | 'sheet'
  className = '',            // classes for the menu element (site CSS passes through)
  build,                     // (menuEl, handle) => void — site renders content + wires items
  placement = 'bottom-start',// under anchor, left-aligned; flips up when the viewport clips
  offset = 6,                // px gap from the anchor
  matchAnchorWidth = false,
  onClose = null,            // (reason: 'away'|'esc'|'api'|'reopen') => void
  repositionOnScroll = true, // false → close on scroll instead
  returnFocus = true,
  backdropTitle = '',        // sheet only — header text
}) => handle { el, close(reason), reposition() }
```

- [ ] **Step 1: Write `js/ui/Menu.js`:**

```js
/* Menu (CONTEXT.md) — a transient contextual chooser. This module owns the
   choreography every menu used to hand-roll (and drift on): body-appended
   element, anchored positioning with viewport clamping + flip, click-away
   (pointerdown, capture), Escape, passive scroll/resize repositioning,
   aria-expanded, and focus return. Call sites own only their CONTENT via
   opts.build. Two presentations sit behind the seam: 'anchored' (popover) and
   'sheet' (bottom sheet with backdrop — the mobile quick-actions pattern).
   One Menu is open at a time; opening another closes the current ('reopen'). */
(function () {
  'use strict';
  window.App = window.App || {};

  let current = null; // the open handle, if any

  function place(el, anchor, opts) {
    const r = anchor.getBoundingClientRect();
    el.style.position = 'fixed';
    if (opts.matchAnchorWidth) el.style.minWidth = `${Math.round(r.width)}px`;
    // Measure after content render.
    const mw = el.offsetWidth, mh = el.offsetHeight;
    let top = r.bottom + opts.offset;
    if (top + mh > window.innerHeight - 8 && r.top - opts.offset - mh > 8) {
      top = r.top - opts.offset - mh; // flip above
    }
    let left = r.left;
    left = Math.min(left, window.innerWidth - mw - 12);
    left = Math.max(8, left);
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }

  function openAnchored(opts) {
    const el = document.createElement('div');
    el.className = opts.className;
    el.setAttribute('role', el.getAttribute('role') || 'menu');
    document.body.appendChild(el);

    const handle = { el, close, reposition };
    opts.build(el, handle);
    place(el, opts.anchor, opts);
    if (opts.anchor) opts.anchor.setAttribute('aria-expanded', 'true');

    function reposition() { place(el, opts.anchor, opts); }

    const onAway = (e) => {
      if (el.contains(e.target) || (opts.anchor && opts.anchor.contains(e.target))) return;
      close('away');
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('esc'); } };
    const onScroll = (e) => {
      if (el.contains(e.target)) return; // scrolling inside the menu itself
      if (opts.repositionOnScroll) reposition(); else close('away');
    };
    const onResize = () => reposition();

    // pointerdown-capture so the menu closes before the underlying control
    // reacts; deferred a tick so the opening click doesn't instantly close it.
    let bound = false;
    const bindTimer = setTimeout(() => {
      bound = true;
      document.addEventListener('pointerdown', onAway, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('resize', onResize, { passive: true });
    }, 0);

    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      clearTimeout(bindTimer);
      if (bound) {
        document.removeEventListener('pointerdown', onAway, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('resize', onResize);
      }
      el.remove();
      if (opts.anchor) {
        opts.anchor.setAttribute('aria-expanded', 'false');
        if (opts.returnFocus && reason !== 'reopen' && opts.anchor.focus) opts.anchor.focus();
      }
      if (current && current.handle === handle) current = null;
      if (opts.onClose) opts.onClose(reason || 'api');
    }

    return handle;
  }

  function openSheet(opts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'quick-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = opts.className || 'quick-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (opts.backdropTitle) {
      const h = document.createElement('div');
      h.className = 'quick-sheet-title';
      h.textContent = opts.backdropTitle;
      sheet.appendChild(h);
    }
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    const handle = { el: sheet, close, reposition: () => {} };
    opts.build(sheet, handle);

    const onBackdrop = (e) => { if (e.target === backdrop) close('away'); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('esc'); } };
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);

    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (opts.anchor && opts.returnFocus && reason !== 'reopen' && opts.anchor.focus) opts.anchor.focus();
      if (current && current.handle === handle) current = null;
      if (opts.onClose) opts.onClose(reason || 'api');
    }

    return handle;
  }

  App.Menu = {
    open(userOpts) {
      const opts = Object.assign({
        present: 'anchored', className: '', placement: 'bottom-start', offset: 6,
        matchAnchorWidth: false, onClose: null, repositionOnScroll: true,
        returnFocus: true, backdropTitle: '',
      }, userOpts);
      if (current) current.handle.close('reopen');
      const handle = opts.present === 'sheet' ? openSheet(opts) : openAnchored(opts);
      current = { handle };
      return handle;
    },
    closeCurrent(reason) { if (current) current.handle.close(reason || 'api'); },
    get isOpen() { return !!current; },
  };
})();
```

- [ ] **Step 2:** Script tags: app.html Foundation block (defer, after `js/utils/motion.js`); plain tags in both preview harnesses before their view scripts.
- [ ] **Step 3:** Smoke probe (Playwright vs tasklist-preview): `App.Menu.open({anchor: <a real button>, className:'col-filter-menu', build:(el)=>el.innerHTML='<div class=cf-item>x</div>'})` → element appears positioned under the anchor; pointerdown outside closes; Esc closes; aria-expanded toggles; opening a second closes the first.
- [ ] **Step 4:** Commit — `feat(ui): Menu module — one seam for the transient-chooser choreography (anchored + sheet presentations)`

### Task 2: Migrate the four heavyweight fixed popovers

**Files:** `js/views/TaskListView.js` (shared status/priority menu, ~123 LOC cluster), `js/views/tasklist/TableLayout.js` (column filter, ~72 LOC), `js/views/ProjectPickerView.js` (~122 LOC), `js/views/DateTimePickerView.js` (~173 LOC).

For each, one at a time (read the cluster fully first; port CONTENT + item wiring into a `build` callback; delete the choreography):
- [ ] **Step 1: TaskListView status/priority menu** — `_openStatusMenu` keeps its option-list rendering + `_applyStatus` wiring inside `build`; `_ensureStatusMenu`, `_positionStatusMenu`, `_onStatusMenuKey`, `_closeStatusMenu`'s listener bookkeeping are deleted (Menu owns them). Keep its keyboard item-navigation by wiring keydown INSIDE the menu element (content-level, stays at the site). Gate: tasklist-preview table layout — click a status pill → menu opens under it, item click applies (stub logs), click-away/Esc close, re-render doesn't stack.
- [ ] **Step 2: TableLayout column filter** — `openColumnFilter`/`closeColumnFilter`/doc-listener plumbing replaced by `App.Menu.open({className:'col-filter-menu', ...})`; `renderColumnFilterMenu` becomes the `build` body re-invoked on filters:changed via `handle.el` (multi-select keeps the menu open — rebuild in place). Gate: column filter opens/filters/clears; multi-select stays open; Esc closes.
- [ ] **Step 3: ProjectPickerView** — keep its search + list content; drop its pointerdown/scroll/resize plumbing. Gate: taskdetail-preview project row.
- [ ] **Step 4: DateTimePickerView** — same; keep its grid content + `_cleanup` focus contract via onClose. Gate: newtask-preview date/time fields open/close correctly.
- [ ] **Step 5:** Commit per sub-step or one commit — `refactor(menus): status menu, column filter, project picker, date picker onto App.Menu`

### Task 3: Quick sheet onto the sheet presentation

- [ ] `_ensureQuickSheet`/`_openQuickSheet`/`_closeQuickSheet` (~126 LOC) → `App.Menu.open({present:'sheet', className:'quick-sheet', build: ...})`; the root/detail sub-screens (`_renderQuickRoot` etc.) render into `handle.el`. Backdrop + Escape come from the module. Gate: mobile-width tasklist-preview → quick actions button opens the sheet; backdrop tap closes; actions log once.
- [ ] Commit — `refactor(menus): mobile quick sheet is the Menu sheet presentation's first call site`

### Task 4: TaskDetailView's four pickers

- [ ] `_openStatusMenu` (inline chip menu), `_openAssigneePicker`, `_openStuckPanel`, `_openHelpPicker` (~205 LOC total): these anchor as INLINE SIBLINGS today (position: absolute within the pill row). Keep visual parity by passing their existing classes and using `present:'anchored'` with the pill as anchor — verify each against taskdetail-preview light+dark (the pills' menus must land in the same spot; adjust `offset` per site if needed).
- [ ] Commit — `refactor(menus): task-detail status/assignee/stuck/help pickers onto App.Menu`

### Task 5: Kill the always-attached-listener class

- [ ] Migrate TaskDetailView overflow (⋯) + QA More (~58 LOC, bound-once doc listeners), TopbarView user menu (~161) + notification panel (~33) + Team nav menu (~32), ToolbarMenuView (~59), UiScaleView (~56). Each keeps content; always-attached document click/keydown listeners are deleted. The notification panel is an inline sibling today — it may stay inline-toggled if converting changes stacking context; if so, ONLY its document listeners move to per-open registration (partial adoption is fine and recorded).
- [ ] Gate: app boot probe — open/close each topbar menu via Playwright on the dev server (stubbing auth like C1-T5's probe), assert no duplicated firing after repeated open/close, and `getEventListeners`-style count via re-render loop (open+close ×5 → still closes with one click).
- [ ] Commit — `refactor(menus): topbar/toolbar/scale/overflow menus onto App.Menu — always-attached document listeners eliminated`

### Task 6: Sweep

- [ ] All preview harnesses (tasklist ×6 layouts, taskdetail, newtask) light+dark+mobile — zero visual diffs; interaction probes pass; `npm run test:unit`; boot probe clean.
- [ ] Measurements: LOC deleted across the 15 migrated sites (~900 expected), remaining hand-rolled menus (mention menu, reaction picker, drawer — recorded as out of scope).
- [ ] Commit any stragglers; C5 done (merges with C4 whenever the user ships).

## Self-review notes
- Spec coverage: one module two presentations ✓, per-site opt-in ✓ (nothing flips presentation), quick-sheet as sheet call site ✓, passive listeners ✓, one-pass migration → **amended**: staged by risk across 4 tasks because the inventory found 20 sites/1,200 LOC, not 8 (recorded).
- The 'reopen' close reason exists so switching anchors doesn't return focus to the OLD anchor (would fight the new menu's focus).
- Column filter's "stays open on multi-select re-render" is honored by rebuilding inside `handle.el` rather than close/reopen.
