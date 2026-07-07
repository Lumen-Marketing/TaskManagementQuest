# C4 — Directory Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an interface in front of the people/company/project globals (CONTEXT.md: Directory) so shape changes stop at one seam, and give the 40+ hand-rolled avatar/pill renderings a shared implementation where one is actually earned.

**Architecture:** Wrap → migrate → privatize (grilled decision). `js/directory.js` (modeled on `js/taxonomy.js`, the repo's proven seam) wraps `App.PEOPLE` / `App.COMPANIES` / `App.projects` behind lookup accessors, plus the ONE render helper that passes the deletion test today: `avatarStack` (duplicated in TaskDetailView and NewTaskPageView). Call sites migrate view-by-view, each visually gated; the globals get privatized only when no direct reads remain.

**Scope discipline (deletion test applied):** `companyPill` and `statusChip` were in the spec's sketch but are NOT built — companyPill has a single call site, and the three "status chip" renderings (`pill-status`, `status-sel`, `qt-cellbtn`) are visually distinct components that merely share a name. Building either would move complexity, not concentrate it. Recorded here so future reviews don't re-suggest them without new evidence.

## Global Constraints

- Behavioral parity: sites keep their existing unknown-person fallbacks (`|| {name, color}` differs per site — deliberately NOT unified this pass; unification is a visual change needing sign-off).
- Every migrated view gets a preview-harness gate (taskdetail-preview / tasklist-preview) before commit.
- Worktree `worktree-c5-menu-c4-directory` (stacked with C5); tests green before each commit.

---

### Task 1: `js/directory.js` + wiring

- [ ] Create the module: `person(id)`, `people()`, `company(id)`, `companies()`, `project(id)`, `projects()` — thin, null-returning lookups over the globals (wrap phase) — plus `avatarStack(peopleOrIds, opts)` lifted verbatim from TaskDetailView._avatarStack (accepts person objects or ids; `max` default 4; falls back to the `?` chip on empty).
- [ ] Script tags: app.html Foundation block (defer, after taxonomy.js); plain tags in taskdetail/newtask/tasklist previews.
- [ ] Gate: smoke probe (lookup hit/miss, stack HTML for 0/2/6 people). Commit.

### Task 2: Proof migrations (the pattern for the rest)

- [ ] TaskDetailView: delete `_avatarStack`, call `App.directory.avatarStack` at its call sites; migrate the file's direct `App.PEOPLE[...]` reads to `App.directory.person(...) || <site fallback>`.
- [ ] WatchingLayout: same treatment (team panel's PEOPLE reads; PROFILES stays — it's the profiles table row array, a different thing from the Directory roster; recorded).
- [ ] Gate: taskdetail-preview (chip row avatar stack + watchers) and tasklist-preview watching layout — pixel-parity vs pre-change shots; interaction gates still green. Commit.

### Task 3 (staged, per-view): migrate remaining direct-global readers

Inventory (2026-07-08 audit): TaskListView+adapters (~19), NewTaskPageView (16), TaskDetailView remainder, HomeView, ApprovalView, HierarchyView, TaskModel.getFiltered, utils.js avatar/people helpers. One view per commit, harness-gated where a preview exists; boot-probe-gated otherwise.
- [ ] TaskListView + tasklist adapters
- [ ] NewTaskPageView (+ newtask preview gate)
- [ ] HomeView / ApprovalView / HierarchyView / remaining views (boot gate)
- [ ] TaskModel + utils.js internals last (they're the deepest readers)

### Task 4: Privatize

- [ ] When `grep -rn "App\.PEOPLE\[\|App\.COMPANIES\[\|App\.projects\[" js/ --include="*.js"` (excluding directory.js and the hydration sites in app.js/constants.js) returns nothing: rename the globals' write sites to publish through `App.directory._hydrate(...)` and freeze direct access (a getter that console.warns in preview mode). Record completion in the program memory.

## Self-review notes
- Spec deviations recorded: helpers cut to `avatarStack` only (deletion test); PROFILES excluded from the Directory (different concept — table rows vs roster).
- The wrap phase changes zero behavior; only Task 4 is a breaking change and it lands only after the grep is clean.
