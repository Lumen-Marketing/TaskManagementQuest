/* Category Sequence Board (CONTEXT.md: Layout) — the default list surface.
   One rounded card per category (Task Type); each lists that category's tasks
   in manual order with a 1..n badge. Drag or ▲▼ to reorder inline; drag across
   cards to recategorize. Ordering is App.sequenceOrder; persistence + drag are
   wired via App.sequenceBoardWire (Tasks 5-6). Registered as
   App.TaskListLayouts.sequence. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  // The visible, active tasks this board sequences (done/cleared excluded).
  function boardTasks(view) {
    return view.controller.getVisibleTasks()
      .filter(t => !App.taxonomy.isDone(t) && !t.clearedAt);
  }

  // Desired category order = the current company's active types, in taxonomy order.
  function typeOrder(view) {
    const company = view.controller.uiState.currentCompany;
    return (App.taxonomy.activeTypes(company) || []).map(t => t.key);
  }

  function typeLabel(view, key) {
    const company = view.controller.uiState.currentCompany;
    const t = (App.taxonomy.activeTypes(company) || []).find(x => x.key === key);
    return (t && t.label) || key || 'Uncategorized';
  }

  function renderRow(view, task, index, canEdit) {
    const priority = App.PRIORITIES[task.priority] || App.PRIORITIES.medium;
    const due = App.utils.formatDue(task.due);
    const row = document.createElement('div');
    row.className = 'seq-row';
    row.dataset.id = task.id;
    row.dataset.cat = task.type;
    row.innerHTML = `
      ${canEdit ? `<button type="button" class="seq-grip" aria-label="Drag to reorder" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></button>` : ''}
      <span class="seq-badge">${index + 1}</span>
      <div class="seq-body">
        <div class="seq-title">${App.utils.escapeHtml(task.title)}</div>
        <div class="seq-meta">
          <span class="seq-pill ${priority.cls}">${App.utils.escapeHtml(priority.label)}</span>
          <span class="due-cell ${due.cls}">${due.text}</span>
        </div>
      </div>
      ${canEdit ? `<div class="seq-movers">
        <button type="button" data-action="seq-move" data-dir="-1" aria-label="Move up"><i class="ti ti-chevron-up"></i></button>
        <button type="button" data-action="seq-move" data-dir="1" aria-label="Move down"><i class="ti ti-chevron-down"></i></button>
      </div>` : ''}`;
    return row;
  }

  function renderGroup(view, group, canEdit) {
    const section = document.createElement('section');
    section.className = 'seq-group';
    section.dataset.cat = group.key;

    const head = document.createElement('div');
    head.className = 'seq-group-head';
    const n = group.tasks.length;
    head.innerHTML =
      `<span class="seq-group-name">${App.utils.escapeHtml(typeLabel(view, group.key))}</span>` +
      `<span class="seq-group-count">${n} task${n === 1 ? '' : 's'}</span>`;
    section.appendChild(head);

    const list = document.createElement('div');
    list.className = 'seq-group-list';
    list.dataset.cat = group.key;
    group.tasks.forEach((t, i) => list.appendChild(renderRow(view, t, i, canEdit)));
    section.appendChild(list);
    return section;
  }

  // Persist a drop: reassign type if it moved categories, then re-sequence the
  // affected group(s) from their final DOM order (1..n) so the display sticks.
  function persistDrop(view, { id, fromCat, toCat, orderedIds }) {
    if (toCat !== fromCat) {
      view.controller.updateTaskField(id, 'type', toCat);
      if (view.controller.toastView) {
        const pos = (orderedIds[toCat] || []).indexOf(id) + 1;
        const label = typeLabel(view, toCat);
        view.controller.toastView.show({ title: `Moved to ${label} — position ${pos}` });
      }
    }
    Object.keys(orderedIds).forEach(cat => {
      App.sequenceOrder.positionsFor(orderedIds[cat])
        .forEach(({ id: rid, seq }) => view.controller.setFocusOrder(rid, seq));
    });
  }

  // Re-sequence one group from an ordered id list (1..n) via the controller.
  function resequence(view, ids) {
    App.sequenceOrder.positionsFor(ids)
      .forEach(({ id, seq }) => view.controller.setFocusOrder(id, seq));
  }

  // Bind drag + chevrons + save for the current render. Returns a cleanup fn.
  App.sequenceBoardWire = function (view) {
    let dragCleanup = null;
    if (App.can('tasks.write') && App.makeGroupReorderable) {
      dragCleanup = App.makeGroupReorderable(view.body, {
        groupListSelector: '.seq-group-list',
        rowSelector: '.seq-row',
        handleSelector: '.seq-grip',
        onDrop: (payload) => persistDrop(view, payload),
      });
    }

    function onClick(e) {
      // "Save order" is reassurance only — order already persists on each move.
      const save = e.target.closest('[data-action="seq-save"]');
      if (save) {
        if (view.controller.persistNow) view.controller.persistNow();
        if (view.controller.toastView) view.controller.toastView.show({ title: 'Order saved' });
        return;
      }
      const btn = e.target.closest('[data-action="seq-move"]');
      if (!btn || !App.can('tasks.write')) return;
      const row = btn.closest('.seq-row');
      const list = row && row.closest('.seq-group-list');
      if (!list) return;
      const dir = parseInt(btn.dataset.dir, 10);
      const ids = Array.from(list.querySelectorAll('.seq-row')).map(r => r.dataset.id);
      const idx = ids.indexOf(row.dataset.id);
      const target = idx + dir;
      if (target < 0 || target >= ids.length) return;
      [ids[idx], ids[target]] = [ids[target], ids[idx]]; // swap with neighbor
      resequence(view, ids);
    }
    view.body.addEventListener('click', onClick);

    return function cleanup() {
      if (dragCleanup) dragCleanup();
      view.body.removeEventListener('click', onClick);
    };
  };

  layouts.sequence = {
    unmount(view) {
      if (view._seqCleanup) { view._seqCleanup(); view._seqCleanup = null; }
    },

    render(view) {
      if (view._seqCleanup) { view._seqCleanup(); view._seqCleanup = null; }
      const canEdit = App.can('tasks.write');
      const tasks = boardTasks(view);
      const groups = App.sequenceOrder.sequenceGroups(tasks, { order: typeOrder(view) });

      view.body.className = 'sequence-board';
      view.body.innerHTML = '';

      // The static column header (table only) has no place on the card board.
      const header = document.querySelector('#taskViewWrap .list-header');
      if (header) header.classList.add('hidden');

      if (!groups.length) {
        view._renderEmpty({
          icon: 'ti-list-numbers',
          title: 'No tasks to sequence',
          sub: 'Tasks assigned here will appear grouped by category so you can order them.',
        });
        return;
      }

      groups.forEach(g => view.body.appendChild(renderGroup(view, g, canEdit)));

      if (App.sequenceBoardWire) view._seqCleanup = App.sequenceBoardWire(view);
    },
  };
})();
