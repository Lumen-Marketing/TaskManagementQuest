window.App = window.App || {};

/* ProgressWidgetView — dark "Today's Progress" card pinned to the page head.
   Shows a circular ring + three counters (Total / Completed / Pending) for
   tasks assigned to the current user that are either due today or were
   completed today. Recomputes whenever the task model changes. */
App.ProgressWidgetView = class ProgressWidgetView {
  constructor({ taskModel, currentUser }) {
    this.taskModel = taskModel;
    this.currentUser = currentUser;
    this.mount = document.getElementById('progressWidget');
    if (!this.mount) return;

    this.subscribe();
    this.render();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.render());
    App.EventBus.on('view:changed',  () => this.render());
  }

  metrics() {
    const today = App.utils.todayISO(0);
    const me = this.currentUser;
    const mine = this.taskModel.all().filter(t => App.utils.isAssignee(t, me));
    const dueToday   = mine.filter(t => t.due === today);
    const doneToday  = mine.filter(t => App.utils.hqDateOf(t.completedAt) === today);
    // "In play today" = due today OR finished today (so finishing an older
    // task still nudges the ring forward instead of leaving it at 0%).
    const inPlay = new Set([...dueToday, ...doneToday].map(t => t.id));
    const total     = inPlay.size;
    const completed = doneToday.length;
    const pending   = Math.max(0, total - completed);
    const pct       = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, pct };
  }

  render() {
    if (!this.mount) return;
    const m = this.metrics();
    const RADIUS = 22;
    const CIRC = 2 * Math.PI * RADIUS;
    const offset = CIRC * (1 - m.pct / 100);

    this.mount.innerHTML = `
      <div class="progress-card">
        <div class="progress-ring" role="img" aria-label="${m.pct}% complete">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="${RADIUS}"
                    fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5" />
            <circle cx="28" cy="28" r="${RADIUS}"
                    fill="none" stroke="url(#progGrad)" stroke-width="5" stroke-linecap="round"
                    stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}"
                    transform="rotate(-90 28 28)" />
            <defs>
              <linearGradient id="progGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"  stop-color="oklch(82% 0.16 95)" />
                <stop offset="100%" stop-color="oklch(74% 0.16 50)" />
              </linearGradient>
            </defs>
          </svg>
          <div class="progress-ring-num">${m.pct}<span>%</span></div>
        </div>
        <div class="progress-card-text">
          <div class="progress-card-eyebrow">Today's progress</div>
          <div class="progress-card-title">${m.completed} of ${m.total} done</div>
        </div>
        <div class="progress-metrics">
          <div class="progress-metric">
            <div class="progress-metric-num">${m.total}</div>
            <div class="progress-metric-label">Total</div>
          </div>
          <div class="progress-metric">
            <div class="progress-metric-num">${m.completed}</div>
            <div class="progress-metric-label">Done</div>
          </div>
          <div class="progress-metric">
            <div class="progress-metric-num">${m.pending}</div>
            <div class="progress-metric-label">Pending</div>
          </div>
        </div>
      </div>
    `;
  }
};
