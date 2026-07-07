/* Cards layout adapter (CONTEXT.md: Layout) — a responsive grid of task cards.
   renderTaskCard is cards-only, so it lives here as a private helper. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  function renderTaskCard(view, t) {
    const person = App.PEOPLE[t.assignee] || { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const type = App.TASK_TYPES[t.type] || App.TASK_TYPES.admin;
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(t.due);
    const selected = view.controller.uiState.selectedTaskId === t.id;
    const isDone = App.taxonomy.isDone(t);
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subDone = subs.filter(s => s.d).length;

    const card = document.createElement('div');
    card.className = 'task-card prio-' + (priority.cls || 'medium') + (selected ? ' selected' : '') + (isDone ? ' done' : '');
    card.dataset.id = t.id;
    card.innerHTML = `
      <span class="task-card-edge"></span>
      <div class="task-card-top">
        <span class="task-card-type"><i class="ti ${type.icon || 'ti-file-text'}"></i>${App.utils.escapeHtml(App.taxonomy.typeLabel(t.company, t.type))}</span>
        <button class="task-card-check ${isDone ? 'is-done' : ''} ${App.can('tasks.write') ? '' : 'hidden'}" data-action="finish-task" title="${isDone ? 'Mark as not done' : 'Finish this task'}" aria-label="${isDone ? 'Mark as not done' : 'Finish this task'}">
          <i class="ti ${isDone ? 'ti-check' : 'ti-circle-check'}"></i>
        </button>
      </div>
      <div class="task-card-title">${App.utils.escapeHtml(t.title)}</div>
      ${t.description ? `<div class="task-card-desc">${App.utils.escapeHtml(t.description)}</div>` : ''}
      <div class="task-card-foot">
        <span class="task-card-who">${App.utils.avatarHtml(person)}<span>${App.utils.escapeHtml(person.name)}</span></span>
        ${subs.length ? `<span class="task-card-subs" title="${subDone}/${subs.length} subtasks done"><i class="ti ti-checklist"></i>${subDone}/${subs.length}</span>` : ''}
        <span class="due-cell ${due.cls}">${due.text}</span>
      </div>
    `;
    // Card clicks (finish-task + select) are handled by the module's delegated
    // _onRowClick; makeActivatable's synthesized click bubbles into it too.
    App.utils.makeActivatable(card, null, `Open task: ${t.title}`);
    return card;
  }

  layouts.cards = {
    render(view, tasks) {
      view.body.className = 'cards-view';
      view.body.innerHTML = '';
      // The table column header is meaningless for cards — hide it like kanban does.
      const listHeader = document.querySelector('#taskViewWrap .list-header');
      if (listHeader) listHeader.classList.add('hidden');
      if (tasks.length === 0) { view._renderEmpty(view._emptyConfig()); return; }
      const grid = document.createElement('div');
      grid.className = 'cards-grid';
      tasks.forEach(t => grid.appendChild(renderTaskCard(view, t)));
      view.body.appendChild(grid);
    },
  };
})();
