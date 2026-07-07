window.App = window.App || {};

/* UpNextWidgetView — surfaces the single highest-priority task assigned to the
   current user that's overdue or due today (falling back to the next upcoming
   one). Lives in the page-head next to ProgressWidget. Clicking the card opens
   the task detail; the Start button toggles the work timer for that task. */
App.UpNextWidgetView = class UpNextWidgetView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;
    this.mount = document.getElementById('upNextWidget');
    if (!this.mount) return;

    this.subscribe();
    this.render();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.render());
    App.EventBus.on('time:changed',  () => this.render());
    App.EventBus.on('view:changed',  () => this.render());
  }

  pickNext() {
    const PRIO = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4, chill: 5 };
    const today = App.utils.todayISO(0);
    const mine = this.taskModel.all().filter(t =>
      t.assignee === this.currentUser && !App.taxonomy.isDone(t)
    );
    const dueRanked = mine
      .filter(t => t.due)
      .sort((a, b) => {
        // Overdue + today first (by due asc), then upcoming
        const aPast = a.due <= today, bPast = b.due <= today;
        if (aPast !== bPast) return aPast ? -1 : 1;
        if (a.due !== b.due) return a.due < b.due ? -1 : 1;
        return (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9);
      });
    return dueRanked[0] || null;
  }

  dueLabel(dueISO) {
    if (!dueISO) return '';
    const today = App.utils.todayISO(0);
    if (dueISO === today) return 'Due today';
    if (dueISO < today) {
      // Crude day diff via ISO string parsing — both are YYYY-MM-DD.
      const a = new Date(dueISO), b = new Date(today);
      const days = Math.round((b - a) / 86400000);
      return `${days}d overdue`;
    }
    const tomorrow = App.utils.todayISO(1);
    if (dueISO === tomorrow) return 'Due tomorrow';
    const a = new Date(today), b = new Date(dueISO);
    const days = Math.round((b - a) / 86400000);
    return `Due in ${days}d`;
  }

  render() {
    if (!this.mount) return;
    const t = this.pickNext();

    if (!t) {
      this.mount.innerHTML = `
        <div class="up-next-card up-next-empty">
          <div class="up-next-icon"><i class="ti ti-checks"></i></div>
          <div class="up-next-text">
            <div class="up-next-eyebrow">Up next</div>
            <div class="up-next-empty-row">All caught up</div>
          </div>
        </div>
      `;
      return;
    }

    const active = this.timeModel.activeFor(this.currentUser);
    const isRunning = active && active.taskId === t.id;
    const due = this.dueLabel(t.due);
    const overdue = t.due && t.due < App.utils.todayISO(0);
    const prio = t.priority || 'medium';
    const TYPE_ICON = {
      lead: 'ti-target-arrow', bid: 'ti-file-dollar', admin: 'ti-folder',
      invoicing: 'ti-receipt', ar: 'ti-coin', meeting: 'ti-calendar-event'
    };
    const icon = TYPE_ICON[t.type] || 'ti-bolt';

    this.mount.innerHTML = `
      <div class="up-next-card is-${prio}" data-task-id="${t.id}">
        <div class="up-next-icon"><i class="ti ${icon}"></i></div>
        <div class="up-next-text">
          <div class="up-next-eyebrow">Up next</div>
          <div class="up-next-title" title="${App.utils.escapeHtml(t.title)}">${App.utils.escapeHtml(t.title)}</div>
          <div class="up-next-meta">
            <span class="up-next-prio prio-${prio}">${prio}</span>
            <span class="up-next-due ${overdue ? 'overdue' : ''}">${due}</span>
          </div>
        </div>
        <button class="up-next-start ${isRunning ? 'running' : ''}" data-action="start" aria-label="${isRunning ? 'Back to General shift' : 'Start timer'}">
          <i class="ti ${isRunning ? 'ti-player-pause-filled' : 'ti-player-play-filled'}"></i>
        </button>
      </div>
    `;

    const card = this.mount.querySelector('.up-next-card');
    const startBtn = this.mount.querySelector('[data-action="start"]');
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controller.toggleTimerForTask(t.id);
      });
    }
    if (card) {
      card.addEventListener('click', () => this.controller.selectTask(t.id));
    }
  }
};
