/* Calendar layout adapter (CONTEXT.md: Layout) — month / week grid, tasks
   placed on their due date. The selected-day panel reuses the shared
   view.renderKanbanCard. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  function calWeekLabel(anchor) {
    const start = new Date(anchor); start.setDate(anchor.getDate() - anchor.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const sMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const eMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const year = end.getFullYear();
    if (start.getMonth() === end.getMonth()) {
      return `${sMonth} ${start.getDate()} – ${end.getDate()}, ${year}`;
    }
    return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}, ${year}`;
  }

  function calChip(t) {
    const done = App.taxonomy.isDone(t);
    const prio = t.priority || 'medium';
    return `<button type="button" class="cal-chip${done ? ' done' : ''}" data-cal-task="${App.utils.escapeHtml(t.id)}" title="${App.utils.escapeHtml(t.title)}">`
      + `<span class="cal-chip-dot" style="background:var(--u-${App.utils.escapeHtml(prio)});"></span>`
      + `<span class="cal-chip-title">${App.utils.escapeHtml(t.title)}</span></button>`;
  }

  function bindCalendar(view) {
    const c = view.controller;
    view.body.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.cal;
      if (a === 'prev') c.shiftCalendar(-1);
      else if (a === 'next') c.shiftCalendar(1);
      else if (a === 'today') c.resetCalendarToToday();
    }));
    view.body.querySelectorAll('[data-cal-mode]').forEach(b =>
      b.addEventListener('click', () => c.setCalendarMode(b.dataset.calMode)));
    view.body.querySelectorAll('[data-cal-task]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      c.selectTask(b.dataset.calTask);
    }));
    view.body.querySelectorAll('.cal-cell').forEach(cell => cell.addEventListener('click', (e) => {
      if (e.target.closest('[data-cal-task]')) return; // chip click handled above
      // Clicking a day NAVIGATES to it ("if I click on the 17th, I only want
      // to see the 17th"): anchor + select the day so its task list panel
      // shows, on every form factor. It used to open a prefilled new-task
      // page on desktop, which fought the boss's click-to-see habit.
      c.openCalendarOn(cell.dataset.day);
    }));
  }

  layouts.calendar = {
    render(view, tasks) {
      view.body.className = 'calendar-view';
      view.body.innerHTML = '';

      const ui = view.controller.uiState;
      const mode = ui.calendarMode === 'week' ? 'week' : 'month';
      const today = App.utils.todayISO(0);
      const anchor = new Date((ui.calendarAnchor || today) + 'T00:00:00');

      // Bucket the filtered tasks by their due date; count the date-less ones.
      const byDate = new Map();
      let noDue = 0;
      tasks.forEach(t => {
        if (!t.due) { noDue++; return; }
        if (!byDate.has(t.due)) byDate.set(t.due, []);
        byDate.get(t.due).push(t);
      });

      // --- Toolbar: nav + Today + period label + Month/Week toggle ---
      const label = mode === 'week'
        ? calWeekLabel(anchor)
        : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const toolbar = document.createElement('div');
      toolbar.className = 'cal-toolbar';
      toolbar.innerHTML = `
        <div class="cal-nav">
          <button class="cal-nav-btn" data-cal="prev" aria-label="Previous"><i class="ti ti-chevron-left"></i></button>
          <button class="cal-nav-btn" data-cal="next" aria-label="Next"><i class="ti ti-chevron-right"></i></button>
          <button class="cal-today" data-cal="today">Today</button>
          <span class="cal-label">${App.utils.escapeHtml(label)}</span>
        </div>
        <div class="cal-mode" role="group" aria-label="Calendar range">
          <button class="cal-mode-btn ${mode === 'month' ? 'active' : ''}" data-cal-mode="month" aria-pressed="${mode === 'month'}">Month</button>
          <button class="cal-mode-btn ${mode === 'week' ? 'active' : ''}" data-cal-mode="week" aria-pressed="${mode === 'week'}">Week</button>
        </div>`;
      view.body.appendChild(toolbar);

      // --- Day cells ---
      const days = [];
      if (mode === 'week') {
        const start = new Date(anchor); start.setDate(anchor.getDate() - anchor.getDay());
        for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
      } else {
        const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const start = new Date(first); start.setDate(first.getDate() - first.getDay());
        const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
        const cells = Math.ceil((last.getDate() + first.getDay()) / 7) * 7; // 35 or 42
        for (let i = 0; i < cells; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
      }

      const grid = document.createElement('div');
      grid.className = `cal-grid cal-${mode}`;
      grid.innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        .map(d => `<div class="cal-dow">${d}</div>`).join('');

      const curMonth = anchor.getMonth();
      const maxChips = mode === 'week' ? 10 : 3;
      days.forEach(d => {
        const iso = App.utils.toISODate(d);
        const dayTasks = byDate.get(iso) || [];
        const outside = mode === 'month' && d.getMonth() !== curMonth;
        const cls = [
          'cal-cell',
          outside ? 'outside' : '',
          iso === today ? 'today' : '',
          ui.calendarSelectedDay === iso ? 'selected' : '',
          dayTasks.length ? 'has-tasks' : '',
        ].filter(Boolean).join(' ');
        const chips = dayTasks.slice(0, maxChips).map(t => calChip(t)).join('');
        const more = dayTasks.length > maxChips
          ? `<div class="cal-more">+${dayTasks.length - maxChips} more</div>` : '';
        const cell = document.createElement('div');
        cell.className = cls;
        cell.dataset.day = iso;
        cell.innerHTML = `
          <div class="cal-daynum">${d.getDate()}</div>
          <div class="cal-count" aria-hidden="true">${dayTasks.length || ''}</div>
          <div class="cal-chips">${chips}${more}</div>`;
        grid.appendChild(cell);
      });
      view.body.appendChild(grid);

      // --- Selected-day task list (the phone tap-through; harmless on desktop) ---
      if (ui.calendarSelectedDay) {
        const list = byDate.get(ui.calendarSelectedDay) || [];
        const dLabel = new Date(ui.calendarSelectedDay + 'T00:00:00')
          .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const panel = document.createElement('div');
        panel.className = 'cal-day-panel';
        panel.innerHTML = `<div class="cal-day-panel-head">${App.utils.escapeHtml(dLabel)} · ${list.length} task${list.length === 1 ? '' : 's'}</div>`;
        const pbody = document.createElement('div');
        pbody.className = 'cal-day-panel-body';
        if (list.length) list.forEach(t => pbody.appendChild(view.renderKanbanCard(t)));
        else pbody.innerHTML = `<div class="cal-day-empty">No tasks due this day.</div>`;
        panel.appendChild(pbody);
        view.body.appendChild(panel);
      }

      // --- No-due-date note so those tasks aren't silently hidden ---
      if (noDue) {
        const note = document.createElement('div');
        note.className = 'cal-nodue-note';
        note.innerHTML = `<i class="ti ti-calendar-off"></i> ${noDue} task${noDue === 1 ? '' : 's'} with no due date (not shown here).`;
        view.body.appendChild(note);
      }

      bindCalendar(view);
    },
  };
})();
