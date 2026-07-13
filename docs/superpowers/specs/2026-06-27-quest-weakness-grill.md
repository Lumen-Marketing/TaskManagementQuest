# Quest HQ — Weakness Grill & Improvement Findings

**Date:** 2026-06-27
**Method:** `superpowers:grilling` over a codebase weakness survey. Each branch was
walked one decision at a time and **verified against the code** before any conclusion.
**Context established up front:** scope = "everything"; **pre-launch / staging**;
effort = my judgment; mobile-friendly is the standing #1 priority (2026-06-18).

---

## Grilled scorecard

| Weakness (from survey) | Verdict | Why |
|---|---|---|
| Full-page re-renders / virtualization | ❌ **DROPPED** | Fine at ≤100 rows; triggers are rare; non-issue |
| Mobile triage UX | ✅ **DESIGNED** | Mostly already works; small additions only |
| Optimistic-lock version seeding gap | ❌ **DEBUNKED** | Versions seeded on load/insert + poll dirty-skip; system is sound |
| Offline / data-loss on reload | ✅ **DESIGNED** | Real but narrow; Stage A durable queue now, Stage B later |
| RLS regression coverage | ⏳ Not grilled | Security wall, 54 migrations, no test — genuine gap |

> **Audit reliability note:** 3 of the survey's top findings (render perf, "no mobile
> table collapse," optimistic-lock gap) were **wrong or overstated** when checked against
> code. The app is better-engineered than the survey implied. Verify before building.

---

## Branch 1 — Re-render strategy → **DROPPED (over-engineering avoided)**

Survey called this the #1 weakness. Grilling killed it:

- Realistic upper bound is **≤100 tasks per view** → full `innerHTML` rebuild is
  single-digit milliseconds. No CPU problem.
- `time:changed` fires **only on clock in/out**
  ([TimeModel.js:60,162,170](../../../js/models/TimeModel.js)), not per tick → no rebuild storm.
- The 30s poll merges **non-destructively** and only emits `tasks:changed` on real
  change ([app.js:330-331](../../../js/app.js)) → zero rebuilds in steady state.
- Scroll position already preserved ([TaskListView.js:122-130](../../../js/views/TaskListView.js)).

**Action:** remove "re-render engine / virtualization" from the backlog entirely.
Only residual (optional polish): a poll-driven rebuild can dismiss an open row menu
mid-interaction. Not a launch blocker.

---

## Branch 2 — Mobile triage → **DESIGNED**

**Job-to-be-done (decided):** quick triage / check-ins — glance at what's due,
change status, clock in/out, read/comment. Kanban & Calendar stay **desktop-first**
(horizontal-scroll kanban via `.list-pane{overflow-x:auto}`
[CSS:1803](../../../taskmanagement.css) is acceptable; **not** redesigning it).

**What already works on mobile (verified — do NOT rebuild):**
- Table collapses to a card stack ([CSS:1809-1831](../../../taskmanagement.css)):
  line 1 = checkbox + title, line 2 = type · due · status; company/priority/more-btn hidden.
- **Change status** from the card: status pill `data-action="open-status"` opens a
  keyboard-operable popover ([TaskListView.js:956,982,1140](../../../js/views/TaskListView.js)).
- **Mark done**: it's a status option inside that menu.
- **Clock in/out**: timer button on every card ([TaskListView.js:462](../../../js/views/TaskListView.js)).
- Detail panel becomes a full-screen overlay ([CSS:1838-1844](../../../taskmanagement.css)).

**What to actually build (the real gap):**
1. **Bottom-sheet quick menu** on the mobile card (trigger = a ⋮/chevron, since
   `more-btn` is currently hidden on mobile). Sheet consolidates: Change status ·
   Mark done · Clock in/out · **Reassign** · **Set due**. Reassign + due are the only
   net-new actions; the rest reuse existing handlers.
2. **Touch targets ≥44px** — promote the existing `responsive.spec.js` soft warning
   ([tests/responsive.spec.js:92-112](../../../tests/responsive.spec.js)) to a hard
   failure and fix offenders (status pill, timer button, sheet rows).

**Out of scope (decided):** mobile Kanban redesign, swipe gestures.

---

## Branch 3 — Offline / data-loss → **DESIGNED (scope escalation flagged)**

**Current reality (verified — better than the survey claimed):**
- 350ms debounced save ([app.js:279-282](../../../js/app.js)); failed saves **re-flag
  dirty and retry** ([app.js:256-257](../../../js/app.js)); reconnect flushes
  ([app.js:296](../../../js/app.js)). **A live tab never loses data — online use is safe.**
- Dirty set is **memory-only** (`_dirty` Set, [TaskModel.js:8](../../../js/models/TaskModel.js)).
  Loss window = tab closed / reloaded / crashed while un-persisted: (a) inside the 350ms
  debounce, (b) offline and never reconnected before close, (c) failed save then reload.

**Decided:** offline is **common (mobile/field use)** → `beforeunload` is the wrong fix
(doesn't fire on mobile). Need a **durable local queue (localStorage) + replay on load +
flush on `visibilitychange`/`pagehide`**.

**Decided:** replay conflict = **field-level merge** (auto-merge non-overlapping fields;
prompt only on same-field collision).

**⚠ Scope flag:** the model has **no per-field tracking and no base snapshot** today
(whole-task `_dirty`; `Object.assign` mutations [TaskModel.js:330](../../../js/models/TaskModel.js);
`applyServer` = whole-task replace [TaskModel.js:28](../../../js/models/TaskModel.js)).
Field-level 3-way merge therefore requires: base snapshots, per-field diffing, type-aware
merge (arrays: subtasks/watchers/activity; long text: description), and a conflict-prompt UI —
**a multi-week subsystem on its own.** This exceeds the agreed "focused ~1-week pre-launch
sprint." **Recommend staging (see below); pending user decision.**

### Recommended staging for offline
- **Stage A (days):** durable localStorage queue + replay + `visibilitychange`/`pagehide`
  flush, with **"offline edits win"** on replay (keep an activity-log entry so nothing is
  silently lost). Covers ~95% of field cases.
- **Stage B (later, only if real same-task collisions occur):** add base snapshots +
  per-field 3-way merge + conflict prompt.

---

## Branches not yet grilled (recommended order)

1. **Concurrent-edit / optimistic lock** — verify the version-seeding gap
   ([SupabaseDataStore.js:~194](../../../js/services/SupabaseDataStore.js)); decide
   multi-user edit semantics. Scale-independent data-integrity bug. (Now coupled to
   offline Stage B — same merge machinery.)
2. **RLS regression coverage** — snapshot policies, fail on drift; `due-reminders`
   JWT-off secret-header path.

---

## Recommended build plan (post-grill, realistic)

**Phase 1 — Mobile triage (~1–2 days)**
- Bottom-sheet quick menu on mobile cards: Status · Mark done · Clock · **Reassign** · **Set due**
  (only reassign + due are net-new; reuse existing handlers for the rest).
- Promote `responsive.spec.js` touch-target soft-check → hard failure; fix offenders
  (status pill, timer button, sheet rows ≥44px).

**Phase 2 — Offline Stage A (~2–3 days)**
- Durable localStorage queue of dirty tasks + unsaved time entries.
- Replay on load; flush on `visibilitychange`/`pagehide`.
- "Offline edits win" on replay, with an activity-log entry so nothing is silently lost.

**Phase 3 — RLS regression test (~1 day, NOT yet grilled)**
- Snapshot current policies; fail CI on unexpected drift across the 54 migrations.
- Document/rate-limit `due-reminders` secret-header path.

**Dropped / debunked (do NOT build):** render diffing, virtualization, optimistic-lock
"fix" (no bug), mobile table collapse (already done).

## Backlog (deferred, logged not built)
- Row-level re-render diffing / virtualization — **deleted** (not needed at scale).
- `window.App` read-only hardening.
- Full a11y pass (semantic landmarks, table semantics, focus restore, aria-live timer).
- Offline-first IndexedDB queue (pending Branch 2 grill).
