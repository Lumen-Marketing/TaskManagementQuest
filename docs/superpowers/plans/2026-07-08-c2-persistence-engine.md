# C2 — PersistenceEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the debounce / single-flight / save-barrier machinery out of app.js into one deep PersistenceEngine module with a small interface, provable by unit tests through a fake adapter.

**Architecture:** Pull-shaped seam (per the program spec): models keep their dirty sets; the engine owns *scheduling only* — 350 ms debounce, single-flight coalescing, and the generation-counter `saveNow()` barrier. All app-specific behavior (what a snapshot contains, how conflicts reconcile, failure re-flagging, toasts) stays in app.js as four constructor callbacks. Two adapters prove the seam: `dataStore.save` in prod, a hand-rolled fake `write` in tests. Spec: `docs/superpowers/specs/2026-07-08-mobile-perf-architecture-program-design.md` §C2.

**Tech Stack:** vanilla JS (dual browser/Node export), `node:test` (zero new dependencies), existing SupabaseDataStore untouched.

## Global Constraints

- **Semantics must be preserved exactly** — the machinery being moved (app.js:263–421) is battle-tested and heavily commented; port the invariants (snapshot-then-clear, at-most-one-in-flight, coalesce-not-queue, generation barrier), not a rewrite.
- **`controller.saveNow` keeps its contract:** resolves `true`/`false` only after a save whose snapshot included the caller's just-made edits has settled (the worker-notify race fix depends on it — it becomes a named regression test).
- **No new runtime dependencies.** `node:test` ships with Node ≥20 (already the engines floor).
- **The engine file must load in both environments:** browser `<script defer>` (attaches `App.PersistenceEngine`) and Node `require()` (module.exports) — no `window.*` inside the class; use bare `setTimeout`/`clearTimeout`.
- Execute in the existing worktree `worktree-c1-mobile-load-path` (stacked on C1 per user decision); verify branch before every commit.

---

### Task 1: PersistenceEngine module + unit tests (TDD)

**Files:**
- Create: `js/services/PersistenceEngine.js`
- Create: `tests/unit/persistence-engine.test.mjs`
- Modify: `package.json` (add `"test:unit": "node --test tests/unit/"`)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `new App.PersistenceEngine({ takeSnapshot, write, onSuccess, onFailure, debounceMs = 350 })` with methods:
  - `schedule(): void` — debounced flush (replaces app.js `persist`)
  - `flush(): Promise` — fire-and-coalesce (replaces `flush`)
  - `saveNow(): Promise<boolean>` — generation barrier (replaces `flushIncludingCurrent`)
  - `cancelPending(): void` — clears the debounce timer (exit handlers)

- [ ] **Step 1: Add the test script to package.json** — in `"scripts"`:
```json
"test:unit": "node --test tests/unit/",
```

- [ ] **Step 2: Write the failing tests** — `tests/unit/persistence-engine.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PersistenceEngine } = require('../../js/services/PersistenceEngine.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* Fake adapter: the seam's second adapter. Records every write's snapshot and
   lets each test resolve/reject writes manually, in order. */
function makeFake() {
  const writes = [];   // { snapshot, resolve, reject, settled }
  const write = (snapshot) => new Promise((resolve, reject) => {
    const w = { snapshot, settled: false };
    w.resolve = (v) => { w.settled = true; resolve(v); };
    w.reject = (e) => { w.settled = true; reject(e); };
    writes.push(w);
  });
  return { writes, write };
}

function makeEngine(fake, overrides = {}) {
  const events = [];
  const engine = new PersistenceEngine({
    debounceMs: 5,
    takeSnapshot: overrides.takeSnapshot || (() => ({ n: events.length })),
    write: fake.write,
    onSuccess: (r) => events.push(['success', r]),
    onFailure: (e, s) => events.push(['failure', e, s]),
    ...overrides,
  });
  return { engine, events };
}

test('debounce: N schedule() calls coalesce into one write', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.schedule(); engine.schedule(); engine.schedule();
  await tick(20);
  assert.equal(fake.writes.length, 1);
  fake.writes[0].resolve({});
  await tick(1);
});

test('single-flight: requests during an in-flight save collapse into ONE re-run', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.flush();                    // write 1 starts, unresolved
  await tick(1);
  engine.flush(); engine.flush();    // both while in flight
  await tick(1);
  assert.equal(fake.writes.length, 1, 'no overlap while in flight');
  fake.writes[0].resolve({});
  await tick(5);
  assert.equal(fake.writes.length, 2, 'exactly one coalesced re-run');
  fake.writes[1].resolve({});
  await tick(1);
});

test('REGRESSION (worker-notify race): saveNow resolves only after a save that snapshotted the edit', async () => {
  const fake = makeFake();
  let data = 'old';
  const { engine } = makeEngine(fake, { takeSnapshot: () => ({ data }) });
  engine.flush();                    // write 1 snapshots 'old', unresolved
  await tick(1);
  data = 'new-task';                 // the edit createTask just made
  let saveNowDone = false;
  const p = engine.saveNow().then((ok) => { saveNowDone = true; return ok; });
  await tick(5);
  assert.equal(saveNowDone, false, 'must NOT resolve on the stale in-flight save');
  fake.writes[0].resolve({});        // stale save settles
  await tick(5);
  assert.equal(fake.writes.length, 2, 'barrier forced a re-run');
  assert.equal(fake.writes[1].snapshot.data, 'new-task', 're-run snapshotted the edit');
  assert.equal(saveNowDone, false, 'still waiting for the qualifying run');
  fake.writes[1].resolve({});
  assert.equal(await p, true, 'resolves true once the qualifying save lands');
});

test('saveNow when idle: starts a save immediately and resolves with its outcome', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  const p = engine.saveNow();
  await tick(1);
  assert.equal(fake.writes.length, 1);
  fake.writes[0].resolve({});
  assert.equal(await p, true);
});

test('failure: onFailure gets (err, snapshot); saveNow resolves false; next flush retries', async () => {
  const fake = makeFake();
  const { engine, events } = makeEngine(fake, { takeSnapshot: () => ({ rows: [1] }) });
  const p = engine.saveNow();
  await tick(1);
  fake.writes[0].reject(new Error('boom'));
  assert.equal(await p, false);
  const failure = events.find((e) => e[0] === 'failure');
  assert.ok(failure, 'onFailure called');
  assert.deepEqual(failure[2], { rows: [1] }, 'failure handler receives the snapshot for re-flagging');
  engine.flush();
  await tick(1);
  assert.equal(fake.writes.length, 2, 'engine is not wedged after a failure');
  fake.writes[1].resolve({});
  await tick(1);
});

test('success: onSuccess receives the adapter result (conflicts flow through)', async () => {
  const fake = makeFake();
  const { engine, events } = makeEngine(fake);
  engine.flush();
  await tick(1);
  fake.writes[0].resolve({ conflicts: [{ id: 't1' }] });
  await tick(1);
  const success = events.find((e) => e[0] === 'success');
  assert.deepEqual(success[1], { conflicts: [{ id: 't1' }] });
});

test('cancelPending: a scheduled save is dropped', async () => {
  const fake = makeFake();
  const { engine } = makeEngine(fake);
  engine.schedule();
  engine.cancelPending();
  await tick(20);
  assert.equal(fake.writes.length, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../js/services/PersistenceEngine.js'`

- [ ] **Step 4: Write the engine** — `js/services/PersistenceEngine.js`:

```js
/* PersistenceEngine (CONTEXT.md) — the one pipeline through which dirty rows
   reach storage. Owns WHEN saves happen; owns nothing about WHAT is saved.

   Deep module, small interface:
     schedule()      debounced flush — the default for model-changed events
     flush()         fire-and-coalesce — "a save should happen soon"
     saveNow()       awaitable barrier — resolves (true/false) only after a save
                     whose snapshot INCLUDED the caller's just-made edits settled
     cancelPending() drop the debounce timer (exit handlers flush explicitly)

   App-specific behavior is injected: takeSnapshot() collects the models' dirty
   rows (snapshot-and-clear — the models re-dirty on failure via onFailure),
   write(snapshot) is the storage adapter (SupabaseDataStore.save in prod, a
   fake in tests), onSuccess(result) reconciles conflicts, onFailure(err,
   snapshot) re-flags and toasts.

   Invariants (ported verbatim from the original app.js machinery):
   - takeSnapshot clears dirty state up front, so edits made DURING an await
     re-populate it and are carried by the coalesced follow-up run.
   - At most ONE write is in flight. Requests during a run set `pending` and
     collapse into EXACTLY ONE re-run (coalescing, not a queue).
   - saveNow() computes the earliest generation guaranteed to have snapshotted
     the caller's edit (current run if idle, else the forced next run) and
     resolves — with that run's success boolean — once doneGen reaches it.
     createTask awaits this before notification delivery (migration 040:
     the task row must exist server-side first). */
(function (root) {
  'use strict';

  class PersistenceEngine {
    constructor(opts) {
      this._takeSnapshot = opts.takeSnapshot;
      this._write = opts.write;
      this._onSuccess = opts.onSuccess || (() => {});
      this._onFailure = opts.onFailure || (() => {});
      this._debounceMs = opts.debounceMs == null ? 350 : opts.debounceMs;

      this._timer = null;    // debounce timer id
      this._saving = null;   // in-flight promise, or null when idle
      this._pending = false; // a re-run is queued (requested mid-flight)
      this._runGen = 0;      // generation of the most recently STARTED run
      this._doneGen = 0;     // generation of the most recently SETTLED run
      this._doneOk = true;   // success boolean of that settled run
      this._waiters = [];    // { gen, resolve } awaiting doneGen >= gen
    }

    schedule() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.flush(), this._debounceMs);
    }

    cancelPending() {
      clearTimeout(this._timer);
      this._timer = null;
    }

    flush() {
      if (this._saving) { this._pending = true; return this._saving; }
      return this._startSave();
    }

    saveNow() {
      let targetGen;
      if (!this._saving) {
        this._startSave();          // its snapshot includes the caller's edit
        targetGen = this._runGen;
      } else {
        this._pending = true;       // force a re-run after the stale-snapshot one
        targetGen = this._runGen + 1;
      }
      if (this._doneGen >= targetGen) return Promise.resolve(true);
      return new Promise((resolve) => { this._waiters.push({ gen: targetGen, resolve }); });
    }

    async _saveOnce() {
      this.cancelPending(); // coalesce any pending debounce into this run
      const snapshot = this._takeSnapshot();
      try {
        const result = await this._write(snapshot);
        this._onSuccess(result);
        return true;
      } catch (err) {
        this._onFailure(err, snapshot);
        return false;
      }
    }

    _startSave() {
      this._runGen += 1;
      const myGen = this._runGen;
      this._saving = this._saveOnce().then(
        (ok) => { this._doneOk = ok !== false; },
        ()   => { this._doneOk = false; }
      ).finally(() => {
        this._doneGen = myGen;
        this._saving = null;
        this._notifyWaiters();
        if (this._pending) { this._pending = false; this._startSave(); }
      });
      return this._saving;
    }

    _notifyWaiters() {
      for (let i = this._waiters.length - 1; i >= 0; i--) {
        if (this._doneGen >= this._waiters[i].gen) {
          const w = this._waiters.splice(i, 1)[0];
          w.resolve(this._doneOk);
        }
      }
    }
  }

  const App = root.App = root.App || {};
  App.PersistenceEngine = PersistenceEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PersistenceEngine };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: `pass 7` / `fail 0`

- [ ] **Step 6: Commit**
```bash
git rev-parse --abbrev-ref HEAD   # worktree-c1-mobile-load-path
git add js/services/PersistenceEngine.js tests/unit/persistence-engine.test.mjs package.json
git commit -m "feat(persistence): PersistenceEngine — debounce/single-flight/saveNow barrier behind one seam, with node:test suite (worker-notify race is now a regression test)"
```

---

### Task 2: Rewire app.js onto the engine

**Files:**
- Modify: `js/app.js` (replace the machinery at ~251–437; rewire exit handlers at ~668–681)
- Modify: `app.html` (add the engine script tag after SupabaseDataStore.js)

**Interfaces:**
- Consumes: Task 1's `App.PersistenceEngine`.
- Produces: `controller.saveNow` keeps its exact contract (awaitable, boolean). `engine` is block-scoped in app.js — nothing else may reach it.

- [ ] **Step 1: Add the script tag** — in app.html, directly after the SupabaseDataStore line:
```html
<script defer src="js/services/PersistenceEngine.js?v=..."></script>
```
(No literal `?v=` — copy the neighboring lines' form; in the worktree they are unversioned: `<script defer src="js/services/PersistenceEngine.js"></script>`. The deploy stamp adds versions.)

- [ ] **Step 2: Replace the app.js machinery.** Delete from `let persistTimer = null;` (line ~251) through `controller.saveNow = flushIncludingCurrent;` (line ~437) inclusive, and insert:

```js
  // Delta save: only the tasks/time-entries that actually changed are written,
  // via upserts (never delete-and-reinsert). Conflicts (a newer server version)
  // are reconciled by taking the server's copy.
  //
  // The scheduling machinery (350ms debounce, single-flight coalescing, and the
  // saveNow generation barrier) lives in PersistenceEngine — see that file for
  // the invariants. app.js only supplies the app-specific pieces: what a
  // snapshot contains, how conflicts reconcile, and how failures re-flag.
  const engine = new App.PersistenceEngine({
    debounceMs: 350,
    // Snapshot-and-clear: takeDirty()/takeUnsavedEntries() clear the dirty sets
    // synchronously, so edits made DURING the awaited write re-dirty the models
    // and ride the coalesced follow-up run.
    takeSnapshot: () => ({
      tasks: taskModel.takeDirty(),
      timeEntries: timeModel.takeUnsavedEntries(),
      activeTimers: timeModel.activeTimers,
      notifications: notifModel.takeDirty(),
    }),
    write: (snapshot) => dataStore.save(snapshot),
    onSuccess: (result) => {
      if (result && result.conflicts && result.conflicts.length) {
        // Conflict reconciliation (fix #4). The datastore returns a FIELD-MERGED
        // task: server row as base with local edits re-applied. We apply it AND
        // keep it dirty so the coalesced retry re-saves it — this time the known
        // version is the server's latest, so the lock passes (it converges, no
        // infinite conflict loop). applyServer() alone would clear the dirty
        // flag and drop the local edits, so we use applyServerKeepDirty().
        result.conflicts.forEach(t => {
          if (t && t._conflictMerged) {
            delete t._conflictMerged;
            taskModel.applyServerKeepDirty(t);
          } else {
            taskModel.applyServer(t);
          }
        });
        if (controller.toastView) {
          controller.toastView.show({
            title: 'Task updated elsewhere',
            sub: `Merged ${result.conflicts.length} task${result.conflicts.length > 1 ? 's' : ''} with the latest version.`,
          });
        }
      }
    },
    onFailure: (err, snapshot) => {
      console.error('[app] Supabase save failed', err, 'cause:', err && err.cause);
      // Re-flag the changes so the next save retries them instead of losing them.
      taskModel.markDirty(snapshot.tasks.map(t => t.id));
      timeModel.markUnsavedEntries(snapshot.timeEntries.map(e => e.id));
      notifModel.markDirty(snapshot.notifications.map(n => n.id));
      if (controller.toastView) {
        // Reassure first (the changes are re-flagged above and WILL retry), then
        // include the underlying Supabase message so the cause (RLS, constraint,
        // network) isn't hidden behind friendly text.
        let failToast;
        if (!navigator.onLine) {
          failToast = controller.toastView.show({
            title: "You're offline",
            sub: 'Your changes are kept and will sync automatically when you reconnect.',
          });
        } else {
          const friendly = (err && err.message) || 'Save failed';
          const cause = err && err.cause && err.cause.message;
          failToast = controller.toastView.show({
            title: "Couldn't save — your changes are kept",
            sub: `Retrying shortly. ${cause ? `${friendly} — ${cause}` : friendly}`,
          });
        }
        // Shake the toast so a failed/offline save is impossible to miss.
        if (App.Motion) App.Motion.shake(failToast);
      }
    },
  });

  App.EventBus.on('tasks:changed', () => engine.schedule());
  App.EventBus.on('time:changed', () => engine.schedule());
  App.EventBus.on('notifs:changed', () => engine.schedule());

  // Let the controller force an immediate, awaitable save. createTask uses this to
  // persist a new task BEFORE it notifies the assignee — a worker's permission to
  // insert that notification (migration 040) requires the task row to already exist.
  // saveNow's barrier resolves only once a save that snapshotted the just-created
  // task has actually completed (not merely the save in flight when it was called).
  controller.saveNow = () => engine.saveNow();
```

- [ ] **Step 3: Rewire the two later call sites.**
  - `new App.ConnectionView({ toastView, onReconnect: doSave });` → `new App.ConnectionView({ toastView, onReconnect: () => engine.flush() });`
  - In BOTH exit handlers (visibilitychange-hidden and beforeunload), replace
    `if (persistTimer) window.clearTimeout(persistTimer);` with `engine.cancelPending();` and `flush()` with `engine.flush()` (keep the `.catch` logging lines as they are).

- [ ] **Step 4: Verify nothing references the old machinery**
```bash
node --check js/app.js
grep -n "persistTimer\|flushIncludingCurrent\|doSaveOnce\|startSave\|notifyWaiters" js/app.js
```
Expected: syntax OK; grep prints **nothing**.

- [ ] **Step 5: Boot verification** — dev server + Playwright probe (same as C1 T5): zero console/page errors through boot, auth redirect intact. The engine registers its three listeners at boot even though no save fires while signed out.

- [ ] **Step 6: Unit tests still green:** `npm run test:unit` → pass 7.

- [ ] **Step 7: Commit**
```bash
git add js/app.js app.html
git commit -m "refactor(persistence): app.js delegates scheduling to PersistenceEngine — behavior-preserving port, ~170 lines of machinery behind the seam"
```

---

### Task 3: Verification sweep

- [ ] **Step 1:** `npm run test:unit` → 7 passing.
- [ ] **Step 2:** Boot probe rerun (no errors; login redirect; loader handoff).
- [ ] **Step 3:** Record the C6 attrition note: `controller.saveNow`'s interface is unchanged; the preview-stub width is unaffected this candidate (the seam moved *below* the controller).
- [ ] **Step 4:** Report done; C2 merges together with C1 whenever the user ships the stacked branch.

## Self-review notes

- Contract parity checked line-by-line against app.js:263–437: snapshot-and-clear ✓, coalesce-not-queue ✓, generation barrier arithmetic identical ✓, doneOk propagation to waiters ✓, failure re-flag via snapshot (was closure vars) ✓.
- One deliberate simplification: `doSaveOnce`'s `window.clearTimeout(persistTimer)` on entry becomes `cancelPending()` inside `_saveOnce` — same coalescing effect.
- No placeholders; exact code in every step; types/names consistent across tasks (`engine`, `saveNow`, `cancelPending`).
