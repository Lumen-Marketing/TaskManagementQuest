window.App = window.App || {};

/* TimeModel — owns time entries + currently running timers.
   Does not know about tasks; the controller passes taskId through. */
App.TimeModel = class TimeModel {
  constructor() {
    this.entries = [];
    this.activeTimers = {}; // { userId: { taskId, startedAt } }
  }

  hydrate(entries, activeTimers) {
    this.entries = Array.isArray(entries) ? entries : [];
    this.activeTimers = activeTimers && typeof activeTimers === 'object' ? activeTimers : {};
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
      if (timer.taskId === taskId) total += Date.now() - timer.startedAt;
    });
    return total;
  }

  totalForUser(userId, sinceMs = null) {
    let total = this.entriesForUser(userId, sinceMs).reduce((s, e) => s + (e.durationMs || 0), 0);
    const active = this.activeTimers[userId];
    if (active && (!sinceMs || active.startedAt >= sinceMs)) {
      total += Date.now() - active.startedAt;
    }
    return total;
  }

  totalForTaskIds(taskIds) {
    const idSet = new Set(taskIds);
    let total = this.entries
      .filter(e => idSet.has(e.taskId))
      .reduce((s, e) => s + (e.durationMs || 0), 0);
    Object.values(this.activeTimers).forEach(timer => {
      if (idSet.has(timer.taskId)) total += Date.now() - timer.startedAt;
    });
    return total;
  }

  /* ---------- mutations ---------- */
  startTimer(userId, taskId) {
    // If already running for this user, stop the prior timer first (silent — caller decides).
    let priorEntry = null;
    if (this.activeTimers[userId]) {
      priorEntry = this._closeTimerEntry(userId);
    }
    this.activeTimers[userId] = { taskId, startedAt: Date.now() };
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
    return entry;
  }
};
