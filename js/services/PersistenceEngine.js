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
        () => { this._doneOk = false; }
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
