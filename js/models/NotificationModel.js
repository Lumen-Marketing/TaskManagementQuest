window.App = window.App || {};

App.NotificationModel = class NotificationModel {
  constructor() {
    this.notifications = [];
    // ids of notifications changed since the last successful save. Drives the
    // delta upsert so a save rewrites ONLY rows this device actually touched —
    // it never re-upserts the whole list and so can't revert read/meta/html
    // state that another device changed. (Mirrors TaskModel._dirty.)
    this._dirty = new Set();
  }

  /* ---------- dirty tracking ---------- */
  _markDirty(id) { if (id) this._dirty.add(id); }
  // Returns the changed notification objects and clears the dirty set
  // (optimistic — the save re-marks on failure via markDirty()).
  takeDirty() {
    const ids = [...this._dirty];
    this._dirty.clear();
    return ids.map(id => this.find(id)).filter(Boolean);
  }
  // Re-flag ids as dirty (when a save failed and must be retried).
  markDirty(ids) { (ids || []).forEach(id => this._markDirty(id)); }

  // Initial seed (boot). Hard-set is fine here: nothing is dirty yet and there
  // are no local-only rows to preserve. The 30s poll uses merge(), NOT hydrate,
  // so it can't clobber unsaved local notifications.
  hydrate(arr) {
    this.notifications = Array.isArray(arr) ? arr : [];
    this._dirty.clear();
  }

  /* Non-destructively fold a fresh server snapshot into the local list — the
     notification analogue of TaskModel.mergeServer. Rules:
       - Rows still dirty/unsaved locally keep their LOCAL copy (a pending save
         will reconcile them); they're never overwritten by the server snapshot,
         and local-only rows the server hasn't seen yet are preserved.
       - Every other row takes the server state, so notifications created on
         another device show up.
       - read-state is monotonic: a row read on EITHER side stays read. This
         keeps a "mark read" on this device from being reverted by a stale
         server row, and vice-versa.
     Emits 'notifs:changed' only when something actually changed. */
  merge(serverNotifs) {
    if (!Array.isArray(serverNotifs)) return false;
    const localById = new Map(this.notifications.map(n => [n.id, n]));
    const serverIds = new Set(serverNotifs.map(n => n.id));

    const merged = serverNotifs.map(srv => {
      const local = localById.get(srv.id);
      if (local && this._dirty.has(srv.id)) {
        // Unsaved local edit wins, but never un-read a row read on the server.
        return { ...local, read: local.read || srv.read };
      }
      if (local) {
        // Take server state, but read is sticky across either side.
        return { ...srv, read: srv.read || local.read };
      }
      return srv;
    });

    // Preserve local-only rows the server doesn't know about yet (just-created,
    // not-yet-saved). Keep them at the front so newest stays on top.
    const localOnly = this.notifications.filter(n => !serverIds.has(n.id));
    const next = [...localOnly, ...merged];

    const sig = list => JSON.stringify(
      list.map(n => [n.id, !!n.read]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    );
    const changed = sig(this.notifications) !== sig(next);
    this.notifications = next;
    if (changed) App.EventBus.emit('notifs:changed');
    return changed;
  }

  all() { return this.notifications; }
  unreadCount() { return this.notifications.filter(n => !n.read).length; }
  find(id) { return this.notifications.find(n => n.id === id); }

  add({ taskId, meta, html }) {
    const id = App.utils.uid('n');
    this.notifications.unshift({
      id,
      taskId, meta, html,
      read: false,
      createdAt: new Date().toISOString(),
    });
    this.notifications = this.notifications.slice(0, 50);
    this._markDirty(id);
    App.EventBus.emit('notifs:changed');
  }

  markRead(id) {
    const n = this.find(id);
    if (n && !n.read) {
      n.read = true;
      this._markDirty(id);
      App.EventBus.emit('notifs:changed');
    }
  }

  markAllRead() {
    let changed = false;
    this.notifications.forEach(n => {
      if (!n.read) { n.read = true; this._markDirty(n.id); changed = true; }
    });
    if (changed) App.EventBus.emit('notifs:changed');
  }
};
