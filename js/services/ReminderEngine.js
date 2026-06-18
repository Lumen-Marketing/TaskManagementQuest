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
      if (!this._isMyTask(t) || t.status === 'done') return;

      const windows = this._windowsFor(t);
      windows.forEach(w => {
        const key = `${t.id}:${w.id}`;
        if (this.fired.has(key)) return;
        if (now < w.at) return;
        // Automatic (priority) windows are suppressed once stale so a fresh
        // session isn't flooded with old pings. A user-set reminder is honoured
        // even if late — the user explicitly asked to be told about this task.
        if (!w.custom && now - w.at > this.GRACE_MS) {
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

  /* Treat a task without dueTime as due at end-of-day (23:59 HQ) so
     "morning-of" + "4h before" stay well-defined. Interpreted in the HQ zone
     so the window is the same instant for everyone. */
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
    return App.utils.hqWallClockToMs(y, m, d, hh, mm);
  }

  /* Parse a `datetime-local` string ("YYYY-MM-DDTHH:MM") as HQ wall-clock, so a
     reminder fires at the intended HQ (Phoenix) time for every viewer regardless
     of their device timezone. */
  _parseLocal(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const ts = App.utils.hqWallClockToMs(+m[1], +m[2], +m[3], +m[4], +m[5]);
    return Number.isNaN(ts) ? null : ts;
  }

  /* All reminder windows for a task: the user-set reminder (if any, independent
     of the due date) plus the automatic priority-derived windows (which need a
     due date). */
  _windowsFor(t) {
    const out = [];
    if (t.reminderAt) {
      const ts = this._parseLocal(t.reminderAt);
      // Key on the value so changing the reminder re-arms it.
      if (ts) out.push({ id: `custom:${t.reminderAt}`, at: ts, custom: true });
    }
    if (t.due) {
      const dueTs = this._taskDueTimestamp(t);
      if (dueTs) out.push(...this._priorityWindows(t, dueTs));
    }
    return out;
  }

  _priorityWindows(t, dueTs) {
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

  /* 08:00 HQ on the due date — the due date as seen in the HQ zone, at the
     morning hour in HQ wall-clock, so "morning-of" lands at 8am Phoenix for
     everyone. */
  _morningOf(dueTs) {
    let y, m, d;
    try {
      const p = {};
      new Intl.DateTimeFormat('en-CA', {
        timeZone: App.HQ_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(dueTs)).forEach(part => { p[part.type] = part.value; });
      y = Number(p.year); m = Number(p.month); d = Number(p.day);
    } catch (e) {
      const dt = new Date(dueTs);
      y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
    }
    return App.utils.hqWallClockToMs(y, m, d, this.MORNING_HOUR, 0);
  }

  _fire(task, window) {
    const title = App.utils.escapeHtml(task.title);
    if (window.custom) {
      this.notifModel.add({
        taskId: task.id,
        meta: 'Reminder',
        html: `<strong>Reminder</strong>: <em>${title}</em>`,
      });
      return;
    }
    const prio = App.PRIORITIES[task.priority] || App.PRIORITIES.medium;
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
