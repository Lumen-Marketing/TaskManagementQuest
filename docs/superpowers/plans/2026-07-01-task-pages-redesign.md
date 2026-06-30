# Task Pages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the task detail page to the boss's card-based mockup, and replace the new-task modal with a full-page create form in the same visual language.

**Architecture:** Zero-build static SPA. New `App.NewTaskPageView` replaces `App.NewTaskModalView`; `App.TaskDetailView` template is rewritten over the same data. Creation is a transient `uiState.creatingTask` flag (mirrors how `selectedTaskId` drives the detail page), routed through `_togglePanes()` into a new `#newTaskWrap` full-page surface.

**Tech Stack:** Vanilla JS view classes on `window.App`, `App.EventBus`, Tabler icons (`ti`), CSS in `taskmanagement.css`, Playwright tests.

## Global Constraints

- No build step; no framework; no new dependencies.
- No DB schema changes / migrations. All new actions reuse existing controller paths (`createTask`, `updateTaskDetails`, `addTaskComment`, `completeTask`, `deleteTask`), which already enforce RLS + notify.
- Mobile-first: 3 columns collapse to 1 at ≤720px; primary button becomes a sticky bottom bar; touch targets ≥44px.
- Omit the "Where this task stands" Quest AI banner.
- Reuse existing helpers: `App.utils.escapeHtml`, `avatarHtml`, `peopleInCompany`, `timeAgo`, `formatHours`, `todayISO`; constants `App.STATUSES/PRIORITIES/TASK_TYPES/TASK_LABELS/BID_STATUSES`.

---

## Phase 1 — Detail page redesign

### Task 1: Controller actions for the new buttons

**Files:**
- Modify: `js/controllers/AppController.js`

**Interfaces produced (used by TaskDetailView):**
- `duplicateTask(id)` — clones a task: reads the source via `taskModel.find(id)`, builds a `createTask` payload from its fields with `title = "Copy of " + title`, `status = 'todo'`, subtasks mapped to `{t, d:false}` text array (createTask expects `subtasks: string[]`), watchers copied, no activity/comments; calls `this.createTask(payload)`; toasts "Task duplicated".
- `toggleSelfWatch(id)` — adds/removes `this.currentUser` from the task's watchers and persists via `updateTaskDetails(id, draft)` (draft = `_draftFromTask`-equivalent built from the task with watchers toggled). Returns the new watching state. Gate on `App.can('tasks.write')`; if a worker can't edit others' tasks, still allow self-watch by writing watchers only.
- `addCallLog(id)` — convenience: `this.addTaskComment(id, '📞 Logged a call', [])`.

- [ ] **Step 1:** Add `duplicateTask(id)`, `toggleSelfWatch(id)`, `addCallLog(id)` near the other task actions (after `completeTask`, ~line 542). Build payloads from the same field names `_draftFromTask` uses.
- [ ] **Step 2:** Verify syntax: `node --check js/controllers/AppController.js` → no output.
- [ ] **Step 3:** Commit: `feat(detail): controller actions for duplicate/self-watch/call-log`.

### Task 2: Detail page — new template (header, stat strip, 3-col cards, tabs, quick actions)

**Files:**
- Modify: `js/views/TaskDetailView.js` (the `render()` template, lines ~201–331; keep `_openModal/_closeModal`, edit mode, comments, helpers).

**Interfaces consumed:** `controller.duplicateTask/toggleSelfWatch/addCallLog/completeTask/deleteTask/canDeleteTask/toggleTimerForTask`, existing `_commentsSection(t)`, `_formatDue/_formatReminder`.

Template structure (replace the read-mode `this.pane.innerHTML` only):
- **`.tdp-head`**: `← Tasks` back button (`data-action="close"`); chip row — status chip (`data-action="status-menu"`), bid-status chip when `t.type==='bid'`, type chip; `.tdp-title`; `.tdp-meta` (assignee avatar+name · due+overdue via existing overdue math · priority); `.tdp-head-actions` buttons Comment (`data-action="focus-comment"`), Watch (`data-action="toggle-watch"`, label reflects whether currentUser is a watcher), Edit (`data-action="edit-task"`), `⋯` (`data-action="overflow"`).
- **`.tdp-stats`**: status pill; counts Comments=`(t.comments||[]).length` (fallback to `t.commentCount` if not loaded — show number when loaded else 0), Watchers=`(t.watchers||[]).length`, Subtasks=`(t.subtasks||[]).length`; overdue badge; `Mark complete` button (`data-action="mark-complete"`; label "Reopen" + neutral style when `t.status==='done'`).
- **`.tdp-grid`** three columns reusing existing data builders (watchersHtml, subtasksHtml, activityHtml, entriesHtml already computed above the template):
  - Left `.tdp-col-left`: delegation banner + timer banner (keep existing), Clock-in button (keep), **Details card** (same rows as today).
  - Middle `.tdp-col-main`: **Description card**; **tabbed card** `.tdp-tabs` with buttons Activity/Comments/History and panels — Activity = `activityHtml`, Comments = `this._commentsSection(t)` body, History = `entriesHtml`.
  - Right `.tdp-col-right`: **Quick actions card** (Reassign/Add subtask/Set due/Add note/Log call/Duplicate, each a `.tdp-qa` button with `data-action`); **Watchers card** (`watchersHtml` + a `+` self-add `data-action="toggle-watch"`).
- Keep the `try/catch` render fallback.

- [ ] **Step 1:** Rewrite the read-mode template. Compute `isWatching = (t.watchers||[]).includes(this.currentUser)` and `overdue` before the template.
- [ ] **Step 2:** `node --check js/views/TaskDetailView.js`.
- [ ] **Step 3:** Commit: `feat(detail): card-based detail page template`.

### Task 3: Detail page — wire the new handlers

**Files:**
- Modify: `js/views/TaskDetailView.js` `bindHandlers(t)` (~line 350).

- [ ] **Step 1:** Add bindings: `close`→`closeDetail`; `edit-task`→edit mode (existing); `toggle-timer`→existing; `mark-complete`→`controller.completeTask(t.id)`; `toggle-watch`→`controller.toggleSelfWatch(t.id)`; `focus-comment`→switch to Comments tab + focus `#cmInput`; quick actions: `qa-reassign`/`qa-setdue`/`qa-subtask`→enter edit mode focused on that field (set `editingId`, `editDraft`, call `renderEditMode(t,{focus...})`); `qa-note`→Comments tab + focus composer; `qa-logcall`→`controller.addCallLog(t.id)`; `qa-duplicate`→`controller.duplicateTask(t.id)`; `status-menu`→small status dropdown calling `controller.updateTaskDetails` with status changed; `overflow`→menu with Duplicate + Delete (Delete gated by `canDeleteTask`). Tabs: clicking a tab button toggles `.active` on buttons/panels (local DOM, no re-render). Keep `_wireComments(t)` + lazy `loadTaskComments`.
- [ ] **Step 2:** `node --check js/views/TaskDetailView.js`.
- [ ] **Step 3:** Commit: `feat(detail): wire card detail handlers`.

### Task 4: Detail page CSS + mobile

**Files:**
- Modify: `taskmanagement.css` (add a `/* ===== Task detail page (tdp) ===== */` block; keep legacy `.detail-*` classes for edit mode).

- [ ] **Step 1:** Add styles: `.tdp-head`, `.tdp-chip`, `.tdp-title`, `.tdp-meta`, `.tdp-head-actions .btn`, `.tdp-stats` (flex strip + `Mark complete` orange primary), `.tdp-grid` (`grid-template-columns: 260px 1fr 230px; gap`), `.tdp-card` (white, radius, subtle border/shadow, title), `.tdp-tabs` (tab buttons + panels, `.active`), `.tdp-qa` (icon buttons in a 2-col grid), watchers chips. Use existing tokens (`--ink-*`, `--orange`, `--blue-*`). At `@media (max-width:720px)`: `.tdp-grid{grid-template-columns:1fr}`, reorder so main comes first, `.tdp-stats` wraps, make `Mark complete` a sticky bottom bar.
- [ ] **Step 2:** Open `app.html` in the verify flow / browser; confirm a task opens with the new layout and no console errors.
- [ ] **Step 3:** Commit: `style(detail): card layout + mobile for task detail page`.

---

## Phase 2 — New-task create page

### Task 5: Routing — `#newTaskWrap`, `creatingTask`, open/close

**Files:**
- Modify: `app.html` (add `<section id="newTaskWrap" class="qhq-page hidden" aria-label="New task"></section>` next to `#taskDetailWrap`; swap the `NewTaskModalView.js` script tag for `NewTaskPageView.js`).
- Modify: `js/controllers/AppController.js`.

**Interfaces produced:**
- `openNewTaskPage(prefill)` — replaces `openNewTaskModal`; gate `tasks.write`; set `this.uiState.creatingTask = true`, `this._returnView = this.uiState.view`, store `prefill`; `_togglePanes()`; emit `newtask:changed` (true).
- `closeNewTaskPage()` — set `creatingTask=false`; `_togglePanes()`; emit `newtask:changed` (false).
- `_togglePanes()` — when `creatingTask`, hide all surfaces and show `#newTaskWrap`; else current behavior (and ensure `#newTaskWrap` hidden).
- Escape handler routes to `closeNewTaskPage()` when `creatingTask`.

- [ ] **Step 1:** Implement the above; keep `prefill` on `this._newTaskPrefill`.
- [ ] **Step 2:** `node --check js/controllers/AppController.js`.
- [ ] **Step 3:** Commit: `feat(create): full-page routing for new task`.

### Task 6: `NewTaskPageView` (port modal into a page)

**Files:**
- Create: `js/views/NewTaskPageView.js`.

Port from `NewTaskModalView`: `_companyChoices`, `_assigneeOptionsHtml`, `_onCompanyChanged`, watcher picker, subtask adder, `_maskTime/_parseTime`, `submit()` (validation + `controller.createTask` + notify), `updateDelegationBanner`, `updateBidStatusRow`. **Drop:** focus-trap, drag-resize, Ctrl+S size pinning, `--nt-scale`, `modal-backdrop`. Render into `#newTaskWrap` with the same `.tdp-grid`/`.tdp-card` shells as the detail page (Details inputs left, title+description+subtasks+notify middle, watchers right, sticky Cancel/Create footer). `open()` subscribes to `newtask:changed`; on close clears the wrap.

- [ ] **Step 1:** Write the view; mount/unmount on `newtask:changed`.
- [ ] **Step 2:** `node --check js/views/NewTaskPageView.js`.
- [ ] **Step 3:** Commit: `feat(create): NewTaskPageView full-page form`.

### Task 7: Wire callers; remove the modal

**Files:**
- Modify: `js/app.js` (instantiate `new App.NewTaskPageView({controller, currentUser})`; `attachViews` rename; FAB + keyboard shortcut → `openNewTaskPage`; replace `getElementById('newTaskModal')` guard with `controller.uiState.creatingTask`).
- Modify: `js/views/HomeView.js` (`openNewTaskModal`→`openNewTaskPage`), `js/views/TaskListView.js` (3 call sites).
- Delete: `js/views/NewTaskModalView.js`.
- Modify: `taskmanagement.css` (remove the `#newTaskModal` blocks).

- [ ] **Step 1:** Apply renames; delete the modal file + its script tag (done in Task 5) + CSS.
- [ ] **Step 2:** `grep -rn "openNewTaskModal\|newTaskModal\|NewTaskModalView" js app.html` → only intentional matches (none) remain.
- [ ] **Step 3:** Commit: `refactor(create): repoint callers, remove new-task modal`.

### Task 8: Tests + verification

**Files:**
- Modify: `tests/tasks.spec.js`, `tests/responsive.spec.js` (target `#newTaskWrap` instead of `#newTaskModal`).

- [ ] **Step 1:** Update selectors: open via New task button → assert `#newTaskWrap` visible; fill title; Create → assert `#newTaskWrap` hidden and the task appears.
- [ ] **Step 2:** Run `node --check` on every changed JS file; run Playwright if the env allows (`npx playwright test tests/tasks.spec.js`), else document that it needs the test Supabase project.
- [ ] **Step 3:** Commit: `test: drive new-task page instead of modal`.

---

## Self-Review

- **Spec coverage:** detail header/chips/meta/actions (Task 2), stat strip + Mark complete (Task 2/3), 3-col cards + tabs (Task 2), quick actions all wired (Task 1/3), Quest AI omitted (Task 2), create page + routing + remove modal (Tasks 5–7), mobile (Task 4 + create CSS), tests (Task 8). Covered.
- **Quick-actions deviation:** Reassign/Set due/Add subtask open Edit mode focused on the field rather than bespoke popovers — same outcome, reuses proven code, lower risk. Note in PR.
- **Type consistency:** `createTask` expects `subtasks: string[]`; `duplicateTask` maps subtask objects → text. `toggleSelfWatch`/`updateTaskDetails` use the `_draftFromTask` field shape (`watchers` array). Consistent.
