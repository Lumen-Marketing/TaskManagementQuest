/* Execution-order layout adapter (CONTEXT.md: Layout) — the target person's
   tasks as one drag-rankable list. Ranked tasks (focusSeq set) sit on top with
   #N badges; the rest sit below a divider and can be dragged up to join the
   order (drag = add). Reached via Sort → "Execution order" (sortBy === 'focus'),
   not the layout switcher. Drag listeners are torn down in unmount() — the
   #listBody element is reused across layouts, so they'd otherwise stack. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  // A "Back to all tasks" bar pinned above the execution list — the obvious way
  // out of the Execution-order sort (returns to the default Priority sort). It
  // has no data-id so the drag helper ignores it and it stays at the top.
  function execBackBar(view) {
    const bar = document.createElement('div');
    bar.className = 'exec-back';
    bar.innerHTML = `<button type="button" class="btn btn-sm exec-back-btn"><i class="ti ti-arrow-left"></i> Back to all tasks</button>`;
    bar.querySelector('button').addEventListener('click', () => view.controller.setSortBy('priority'));
    return bar;
  }

  // Sort the unordered tail: soonest due first, then higher priority.
  function execTailCompare(a, b) {
    const ad = a.due || '9999-12-31';
    const bd = b.due || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2);
  }

  // Translate a drop into a focusSeq write. Dropping into the unordered zone
  // (after the divider) removes an ordered task from the order; dropping into
  // the ordered zone assigns a midpoint seq between the nearest ordered rows,
  // which also adds a previously-unordered task (drag = add).
  function onExecDrop(view, movedId) {
    const safe = (window.CSS && CSS.escape) ? CSS.escape(String(movedId)) : String(movedId);
    const movedEl = view.body.querySelector(`[data-id="${safe}"]`);
    if (!movedEl) return;
    const moved = view.taskModel.find(movedId);
    const divider = view._execDivider;
    const inUnorderedZone = divider &&
      (divider.compareDocumentPosition(movedEl) & Node.DOCUMENT_POSITION_FOLLOWING);

    if (inUnorderedZone) {
      // Left in (or dragged back to) the unordered tail.
      if (moved && moved.focusSeq != null) view.controller.removeFromFocus(movedId);
      else App.EventBus.emit('tasks:changed'); // snap the row back to its sorted slot
      return;
    }

    const before = nearestOrderedSeq(view, movedEl, movedId, 'up');
    const after = nearestOrderedSeq(view, movedEl, movedId, 'down');
    let seq;
    if (before == null && after == null) seq = 0;
    else if (before == null) seq = after - 1;
    else if (after == null) seq = before + 1;
    else seq = (before + after) / 2;
    view.controller.setFocusOrder(movedId, seq);
  }

  // Walk siblings from the moved row in a direction (stopping at the divider)
  // and return the focusSeq of the nearest currently-ordered task, or null.
  function nearestOrderedSeq(view, movedEl, movedId, dir) {
    let el = dir === 'up' ? movedEl.previousElementSibling : movedEl.nextElementSibling;
    while (el && el !== view._execDivider) {
      const id = el.dataset && el.dataset.id;
      if (id && id !== movedId) {
        const t = view.taskModel.find(id);
        if (t && t.focusSeq != null) return t.focusSeq;
      }
      el = dir === 'up' ? el.previousElementSibling : el.nextElementSibling;
    }
    return null;
  }

  function renderExecRow(view, t, index, canEdit, ordered) {
    const priority = App.PRIORITIES[t.priority] || App.PRIORITIES.medium;
    const stLabel = App.taxonomy.statusLabel(t.company, t.type, t.status);
    const stChip = App.taxonomy.chipStyle('status', t.company, t.status, t.type);
    const due = App.utils.formatDue(t.due);
    const person = App.directory.person(t.assignee) || { name: t.assignee || 'Unassigned', color: 'var(--ink-3)' };
    const myActive = view.timeModel.activeFor(view.currentUser);
    const myTimerOnThis = myActive && myActive.taskId === t.id;
    const selected = view.controller.uiState.selectedTaskId === t.id;

    const row = document.createElement('div');
    row.className = 'focus-row' + (ordered ? '' : ' exec-unordered') + (selected ? ' selected' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      ${canEdit ? `<button type="button" class="focus-drag" aria-label="Drag to set execution order" title="Drag to set execution order"><i class="ti ti-grip-vertical"></i></button>` : ''}
      <span class="focus-rank">${ordered ? (index + 1) : '<i class="ti ti-plus"></i>'}</span>
      <div class="focus-main">
        <div class="focus-title">${App.utils.escapeHtml(t.title)}</div>
        <div class="focus-meta">
          <span class="focus-assignee">${App.utils.avatarHtml(person)}${App.utils.escapeHtml(person.name)}</span>
          <span class="priority-block ${priority.cls}">${priority.label}</span>
          <span class="pill-status ${stChip.cls}" style="${stChip.style}">${App.utils.escapeHtml(stLabel)}</span>
          <span class="due-cell ${due.cls}">${due.text}</span>
        </div>
      </div>
      <button class="timer-btn ${myTimerOnThis ? 'active' : ''} ${App.can('clock.use') ? '' : 'hidden'}" data-action="toggle-timer" title="${myTimerOnThis ? 'Pause — back to General shift' : 'Start timer'}">
        <i class="ti ${myTimerOnThis ? 'ti-player-pause-filled' : 'ti-player-play'}"></i>
      </button>
      ${ordered && canEdit ? `<button type="button" class="focus-remove" data-action="remove-focus" aria-label="Remove from order" title="Remove from order"><i class="ti ti-x"></i></button>` : ''}
    `;

    // Row clicks (timer, remove-focus, select) are handled by the module's
    // delegated _onRowClick; it also honours the .dragging no-select guard.
    return row;
  }

  layouts.execution = {
    // Tear down the drag listeners when the user leaves this layout — the
    // dispatch preamble also runs a defensive cleanup before every render.
    unmount(view) {
      if (view._focusCleanup) { view._focusCleanup(); view._focusCleanup = null; }
      view._execDivider = null;
    },

    render(view) {
      // #listBody is reused across renders, so tear down the previous drag
      // listeners before re-binding or they'd stack and fire onDrop repeatedly.
      if (view._focusCleanup) { view._focusCleanup(); view._focusCleanup = null; }
      // Shared, cross-person order: every ranked task (any assignee) on top, then
      // the rest of the CURRENT view's open tasks as a tail you can drag up to add.
      const ordered = view.taskModel.focusList();
      const orderedIds = new Set(ordered.map(t => t.id));
      const unordered = view.controller.getVisibleTasks()
        .filter(t => !orderedIds.has(t.id) && !App.taxonomy.isDone(t) && !t.clearedAt)
        .sort((a, b) => execTailCompare(a, b));
      const canEdit = App.can('tasks.write');

      view.body.className = 'focus-list';
      view.body.innerHTML = '';

      const header = document.querySelector('#taskViewWrap .list-header');
      if (header) header.classList.add('hidden');

      if (ordered.length === 0 && unordered.length === 0) {
        view._renderEmpty({
          icon: 'ti-list-numbers',
          title: 'No tasks to order',
          sub: 'Tasks assigned here will appear so you can drag them into your execution order.',
        });
        view.body.insertAdjacentElement('afterbegin', execBackBar(view));
        view._execDivider = null;
        return;
      }

      view.body.appendChild(execBackBar(view));
      ordered.forEach((t, i) => view.body.appendChild(renderExecRow(view, t, i, canEdit, true)));

      // The divider only makes sense once something is ranked — with zero ordered
      // tasks it would be the first element, and the drag helper (which only moves
      // rows among each other) could never lift a row above it to add the first one.
      view._execDivider = null;
      if (unordered.length) {
        if (ordered.length) {
          const divider = document.createElement('div');
          divider.className = 'exec-divider';
          divider.innerHTML = canEdit
            ? `<span><i class="ti ti-arrow-bar-up"></i> Drag up to add to your order</span>`
            : `<span>Not in the execution order</span>`;
          view.body.appendChild(divider);
          view._execDivider = divider;
        }
        unordered.forEach(t => view.body.appendChild(renderExecRow(view, t, null, canEdit, false)));
      }

      if (canEdit && App.makeReorderable) {
        view._focusCleanup = App.makeReorderable(view.body, {
          handleSelector: '.focus-drag',
          onDrop: (movedId) => onExecDrop(view, movedId),
        });
      }
    },
  };
})();
