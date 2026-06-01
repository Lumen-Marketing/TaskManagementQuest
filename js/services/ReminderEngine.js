window.App = window.App || {};

/* ReminderEngine — scans the user's tasks every minute and synthesizes
   in-app notifications when a due-date threshold is crossed, keyed by
   priority. Fired windows are deduped via localStorage so the same
   (taskId, window) only pings once.

   Reminder schedule by priority:
     critical → 4h before due, at-due, +24h overdue
     urgent   → 4h before due, at-due
     high     → morning-of (08:00 local), at-due
     medium   → morning-of (08:00 local)
     low      → none
*/
App.ReminderEngine = class ReminderEngine {
  constructor({ taskModel, notifModel, currentUser }) {
    this.taskModel = taskModel;
    this.notifModel = notifModel;
    this.currentUser = currentUser;

    this.STORAGE_KEY = 'questhq:reminders-fired';
    this.MORNING_HOUR = 8;            // morning-of reminders fire at 08:00 local
    this.PRE_DUE_MS = 4 * 60 * 60 * 1000;  // 4 hours
    this.OVERDUE_MS = 24 * 60 * 60 * 1000; // 24 hours
    this.TICK_MS = 60 * 1000;         // scan every minute
    this.GRACE_MS = 5 * 60 * 1000;    // only fire reminders within the last 5min of their window

    this.fired = this._loadFired();
    this.intervalId = null;
  }

  start() {
    this.scan();
    this.intervalId = setInterval(() => this.scan(), this.TICK_MS);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  scan() {
    const now = Date.now();
    let added = 0;
    this.taskModel.all().forEach(t => {
      if (!this._isMyTask(t) || !t.due || t.status === 'done') return;
      const dueTs = this._taskDueTimestamp(t);
      if (!dueTs) return;

      const windows = this._windowsFor(t, dueTs);
      windows.forEach(w => {
        const key = `${t.id}:${w.id}`;
        if (this.fired.has(key)) return;
        // Window must have just passed (within the grace) so we don't fire
        // long-stale reminders on fresh sessions.
        if (now < w.at) return;
        if (now - w.at > this.GRACE_MS) {
          // Past the grace window — silently mark fired so we don't ever fire it.
          this.fired.add(key);
          return;
        }
        this._fire(t, w);
        this.fired.add(key);
        added++;
      });
    });
    if (added) this._saveFired();
  }

  /* ---------- internals ---------- */

  _isMyTask(t) {
    return t.assignee === this.currentUser || (t.watchers || []).includes(this.currentUser);
  }

  /* Treat a task without dueTime as due at end-of-day (23:59 local) so
     "morning-of" + "4h before" stay well-defined. */
  _taskDueTimestamp(t) {
    if (!t.due) return null;
    const [y, m, d] = t.due.split('-').map(Number);
    if (!y || !m || !d) return null;
    let hh = 23, mm = 59;
    if (t.dueTime) {
      const parts = String(t.dueTime).split(':');
      hh = Number(parts[0]); mm = Number(parts[1] || 0);
      if (Number.isNaN(hh)) { hh = 23; mm = 59; }
    }
    return new Date(y, m - 1, d, hh, mm).getTime();
  }

  _windowsFor(t, dueTs) {
    const prio = t.priority || 'medium';
    const morning = this._morningOf(dueTs);
    const out = [];
    if (prio === 'critical') {
      out.push({ id: 'pre',     at: dueTs - this.PRE_DUE_MS });
      out.push({ id: 'at',      at: dueTs });
      out.push({ id: 'overdue', at: dueTs + this.OVERDUE_MS });
    } else if (prio === 'urgent') {
      out.push({ id: 'pre',     at: dueTs - this.PRE_DUE_MS });
      out.push({ id: 'at',      at: dueTs });
    } else if (prio === 'high') {
      out.push({ id: 'morning', at: morning });
      out.push({ id: 'at',      at: dueTs });
    } else if (prio === 'medium') {
      out.push({ id: 'morning', at: morning });
    }
    return out;
  }

  _morningOf(dueTs) {
    const d = new Date(dueTs);
    d.setHours(this.MORNING_HOUR, 0, 0, 0);
    return d.getTime();
  }

  _fire(task, window) {
    const prio = App.PRIORITIES[task.priority] || App.PRIORITIES.medium;
    const title = App.utils.escapeHtml(task.title);
    const label = {
      pre:     `Due in <strong>4 hours</strong>`,
      at:      `<strong>Due now</strong>`,
      morning: `Due <strong>today</strong>`,
      overdue: `<strong>Overdue</strong> — was due yesterday`,
    }[window.id] || 'Due soon';
    const meta = `Reminder · ${prio.label}`;
    this.notifModel.add({
      taskId: task.id,
      meta,
      html: `${label}: <em>${title}</em>`,
    });
  }

  _loadFired() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { return new Set(); }
  }

  _saveFired() {
    try {
      // Cap to last 500 entries so the set doesn't grow forever.
      const arr = [...this.fired].slice(-500);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(arr));
      this.fired = new Set(arr);
    } catch (e) { /* quota or disabled — non-fatal */ }
  }
};
