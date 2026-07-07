/* Kanban layout adapter (CONTEXT.md: Layout) — status columns. Cards come from
   view.renderKanbanCard, which stays on the TaskList module because Watching's
   panel and Calendar's selected-day list reuse it. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  layouts.kanban = {
    render(view, tasks) {
      view.body.className = 'kanban-board';
      view.body.innerHTML = '';

      if (tasks.length === 0) {
        view._renderEmpty(view._emptyConfig());
        return;
      }

      const columns = [
        { key: 'todo',    label: 'Active',  cls: 'col-todo' },
        { key: 'pending', label: 'Pending', cls: 'col-pending' },
        { key: 'hold',    label: 'On hold', cls: 'col-hold' },
        { key: 'review',  label: 'Review',  cls: 'col-review' },
        { key: 'done',    label: 'Done',    cls: 'col-done' },
      ];
      // Per-type taxonomies (e.g. the Bid pipeline: queue/started/…) carry status keys
      // outside the generic set above. Append a column for any status actually present
      // on a task so nothing is dropped from the board; its label + colour come from the
      // taxonomy (via the first task carrying that status).
      const known = new Set(columns.map(c => c.key));
      tasks.forEach(t => {
        const k = t.status || 'todo';
        if (known.has(k)) return;
        known.add(k);
        columns.push({ key: k, label: App.taxonomy.statusLabel(t.company, t.type, k), cls: '', chip: App.taxonomy.chipStyle('status', t.company, k, t.type) });
      });

      columns.forEach(col => {
        const colTasks = tasks.filter(t => (t.status || 'todo') === col.key);
        const column = document.createElement('div');
        column.className = `kanban-col ${col.cls}`;
        column.innerHTML = `
          <div class="kanban-col-head">
            <span class="kanban-col-title"${col.chip && col.chip.style ? ` style="${col.chip.style}"` : ''}>${App.utils.escapeHtml(col.label)}</span>
            <span class="kanban-col-count">${colTasks.length}</span>
          </div>
          <div class="kanban-col-body"></div>
        `;
        const colBody = column.querySelector('.kanban-col-body');
        colTasks.forEach(t => colBody.appendChild(view.renderKanbanCard(t)));
        view.body.appendChild(column);
      });
    },
  };
})();
