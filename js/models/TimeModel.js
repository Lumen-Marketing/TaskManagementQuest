window.App = window.App || {};

/* TimeModel — owns time entries + currently running timers.
   Does not know about tasks; the controller passes taskId through. */
App.TimeModel = class TimeModel {
  constructor() {
    this.entries = [];
    this.activeTimers = {}; // { userId: { taskId, startedAt, taskTitle, taskCompany } }
    this._unsaved = new Set(); // ids of time entries not yet persisted
  }

  hydrate(entries, activeTimers) {
    this.entries = Array.isArray(entries) ? entries : [];
    this.activeTimers = activeTimers && typeof activeTimers === 'object' ? activeTimers : {};
    this._unsaved.clear();
  }

  /* ---------- unsaved-entry tracking (delta saves) ---------- */
  takeUnsavedEntries() {
    const ids = new Set(this._unsaved);
    this._unsaved.clear();
    return this.entries.filter(e => ids.has(e.id));
  }
  markUnsavedEntries(ids) { (ids || []).forEach(id => this._unsaved.add(id)); }

  // Caps an open timer's live contribution so a forgotten clock-in can't show
  // an absurd total before it's auto-closed.
  _liveMs(startedAt) {
    return Math.min(Date.now() - startedAt, App.MAX_SHIFT_MS);
  }

  // Live contribution of an open timer that falls within [sinceMs, now). A
  // shift that began before the window (e.g. clocked in at 11pm, asked for
  // "today") still counts the portion since the boundary — otherwise an
  // overnight/over-week shift drops out of the windowed total entirely while
  // the row still reads "clocked in". Still capped at the max shift.
  _liveMsSince(startedAt, sinceMs) {
    const from = sinceMs ? Math.max(startedAt, sinceMs) : startedAt;
    return Math.min(Date.now() - from, App.MAX_SHIFT_MS);
  }

  // Closes any of THIS user's timers that have run past the max shift, logging a
  // capped entry. Returns the closed entry (or null). Server-side cleanup would
  // be needed for other users; here we only touch the current user's own timer.
  autoCloseStaleForUser(userId, maxMs) {
    const t = this.activeTimers[userId];
    if (!t || (Date.now() - t.startedAt) <= maxMs) return null;
    const entry = {
      id: App.utils.uid('e'),
      userId,
      taskId: t.taskId,
      start: t.startedAt,
      end: t.startedAt + maxMs,
      durationMs: maxMs,
      note: 'Auto clock-out (max shift exceeded)',
    };
    this.entries.unshift(entry);
    this._unsaved.add(entry.id);
    delete this.activeTimers[userId];
    App.EventBus.emit('time:changed');
    return entry;
  }

  seedDefaults() {
    const now = Date.now();
    const H = 60 * 60 * 1000;
    this.entries = [
      { id:'e1', userId:'abraham',  taskId:'t3',  start: now - 26*H, end: now - 24.2*H, durationMs: 1.8*H, note:'CNL call prep' },
      { id:'e2', userId:'abraham',  taskId:'t1',  start: now - 50*H, end: now - 48.5*H, durationMs: 1.5*H, note:'Lien paperwork' },
      { id:'e3', userId:'kristine', taskId:'t2',  start: now - 28*H, end: now - 25*H,   durationMs: 3*H,   note:'ROC complaint draft' },
      { id:'e4', userId:'alkeith',  taskId:'t4',  start: now - 8*H,  end: now - 3.5*H,  durationMs: 4.5*H, note:'Paradise Valley demo' },
      { id:'e5', userId:'andres',   taskId:'t9',  start: now - 6*H,  end: now - 3*H,    durationMs: 3*H,   note:'Markup QA Safari' },
      { id:'e6', userId:'adrian',   taskId:'t8',  start: now - 30*H, end: now - 27.5*H, durationMs: 2.5*H, note:'Pitch deck review' },
      { id:'e7', userId:'jesus',    taskId:'t12', start: now - 4*H,  end: now - 2.2*H,  durationMs: 1.8*H, note:'GC outreach draft' },
    ];
    this.activeTimers = {};
  }

  /* ---------- queries ---------- */
  isRunning(userId) {
    return !!this.activeTimers[userId];
  }

  activeFor(userId) {
    return this.activeTimers[userId] || null;
  }

  allActive() {
    return Object.entries(this.activeTimers).map(([userId, t]) => ({ userId, ...t }));
  }

  entriesForUser(userId, sinceMs = null) {
    return this.entries.filter(e => e.userId === userId && (!sinceMs || e.start >= sinceMs));
  }

  entriesForTask(taskId) {
    return this.entries.filter(e => e.taskId === taskId);
  }

  totalForTask(taskId) {
    let total = this.entriesForTask(taskId).reduce((s, e) => s + (e.durationMs || 0), 0);
    Object.values(this.activeTimers).forEach(timer => {
      if (timer.taskId === taskId) total += this._liveMs(timer.startedAt);
    });
    return total;
  }

  totalForUser(userId, sinceMs = null) {
    let total = this.entriesForUser(userId, sinceMs).reduce((s, e) => s + (e.durationMs || 0), 0);
    const active = this.activeTimers[userId];
    if (active) {
      total += this._liveMsSince(active.startedAt, sinceMs);
    }
    return total;
  }

  // Cumulative time ONE user has spent on ONE task within [sinceMs, now),
  // including the live portion of a still-open timer on that task. Backs the
  // live clock display so switching away from and back to a task (e.g. General
  // shift) resumes the running total instead of restarting at 0: every switch
  // closes the prior session as a logged entry, and this sums those entries
  // plus the current live session.
  sessionTotalForUserTask(userId, taskId, sinceMs = null) {
    let total = this.entries
      .filter(e => e.userId === userId && e.taskId === taskId && (!sinceMs || e.start >= sinceMs))
      .reduce((s, e) => s + (e.durationMs || 0), 0);
    const active = this.activeTimers[userId];
    if (active && active.taskId === taskId) {
      total += this._liveMsSince(active.startedAt, sinceMs);
    }
    return total;
  }

  totalForTaskIds(taskIds) {
    const idSet = new Set(taskIds);
    let total = this.entries
      .filter(e => idSet.has(e.taskId))
      .reduce((s, e) => s + (e.durationMs || 0), 0);
    Object.values(this.activeTimers).forEach(timer => {
      if (idSet.has(timer.taskId)) total += this._liveMs(timer.startedAt);
    });
    return total;
  }

  /* ---------- mutations ---------- */
  // `meta` carries a snapshot of the task label ({ taskTitle, taskCompany }) so
  // a board can still name the running task when the task row itself isn't
  // loadable for the viewer (RLS company/role scope). The model stays
  // task-agnostic; the controller looks the task up and passes the snapshot.
  startTimer(userId, taskId, meta = {}) {
    // If already running for this user, stop the prior timer first (silent — caller decides).
    let priorEntry = null;
    if (this.activeTimers[userId]) {
      priorEntry = this._closeTimerEntry(userId);
    }
    this.activeTimers[userId] = {
      taskId,
      startedAt: Date.now(),
      taskTitle: meta.taskTitle || null,
      taskCompany: meta.taskCompany || null,
    };
    App.EventBus.emit('time:changed');
    return { priorEntry };
  }

  stopTimer(userId) {
    if (!this.activeTimers[userId]) return null;
    const entry = this._closeTimerEntry(userId);
    delete this.activeTimers[userId];
    App.EventBus.emit('time:changed');
    return entry;
  }

  _closeTimerEntry(userId) {
    const active = this.activeTimers[userId];
    if (!active) return null;
    const durationMs = Date.now() - active.startedAt;
    const entry = {
      id: App.utils.uid('e'),
      userId,
      taskId: active.taskId,
      start: active.startedAt,
      end: Date.now(),
      durationMs,
      note: '',
    };
    this.entries.unshift(entry);
    this._unsaved.add(entry.id);
    return entry;
  }
};
