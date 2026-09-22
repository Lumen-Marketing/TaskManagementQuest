/* Quick board — the phone default layout, built to Abraham's approved v2
   handoff. A flat, sorted card list with an Open/Done/All segment and company
   chips, in place of the table's grouped rows.

   Ordering and segmenting live in quickBoardModel.js so they can be unit
   tested; this file is rendering and event wiring only. Card clicks reuse the
   delegated vocabulary in TaskListView (`data-action`, `data-id`), so
   completing a task needs no new controller plumbing. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  const seg = (view) => view.controller.uiState.quickSeg || 'open';
  const chip = (view) => view.controller.uiState.quickCompany || 'all';
  const swatch = (color) => `<i class="qb-swatch" style="background:${color}"></i>`;

  function priorityPill(t) {
    const p = (App.PRIORITIES || {})[t.priority] || { label: t.priority, cls: 'priority-medium' };
    return `<span class="qb-pill qb-pill-priority ${p.cls}">${App.utils.escapeHtml(p.label)}</span>`;
  }

  function companyPill(t) {
    const c = (App.COMPANIES || {})[t.company] || { label: t.company };
    return `<span class="qb-pill qb-pill-company">${swatch(App.utils.companyColor(t.company))}${App.utils.escapeHtml(c.label || t.company || '')}</span>`;
  }

  function renderCard(view, t, todayIso) {
    const done = App.taxonomy.isDone(t);
    const person = App.directory.person(t.assignee) ||
      { name: t.assignee || 'Unassigned', full: t.assignee || 'Unassigned', color: '#E8A03A' };
    const due = t.due ? App.utils.formatDue(t.due) : null;
    const overdue = App.QuickBoard.isOverdue(t, todayIso);
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subDone = subs.filter(s => s.d).length;
    const pct = subs.length ? Math.round((subDone / subs.length) * 100) : 0;

    const card = document.createElement('article');
    card.className = 'qb-card' + (done ? ' is-done' : '') + (t._flash ? ' is-new' : '');
    card.dataset.id = t.id;
    // One pulse, not one per render: consume the mark as soon as it is used, or
    // every later re-render of an unchanged board would replay the animation.
    if (t._flash) delete t._flash;
    card.innerHTML = `
      <button class="qb-check ${done ? 'is-done' : ''} ${App.can('tasks.write') ? '' : 'hidden'}"
              data-action="finish-task" type="button"
              aria-label="${done ? 'Mark as not done' : 'Mark done'}">
        <i class="ti ${done ? 'ti-circle-check' : 'ti-circle'}"></i>
      </button>
      <div class="qb-body">
        <h3 class="qb-title">${App.utils.escapeHtml(t.title)}</h3>
        <div class="qb-meta">
          ${priorityPill(t)}
          ${companyPill(t)}
          <span class="qb-pill qb-pill-who">${App.utils.avatarHtml(person)}<span>${App.utils.escapeHtml(person.name)}</span></span>
          ${due ? `<span class="qb-pill qb-due ${overdue ? 'is-overdue' : ''}">${App.utils.escapeHtml(due.text)}${t.dueTime ? ' ' + App.utils.escapeHtml(App.utils.formatClock(t.dueTime)) : ''}</span>` : ''}
        </div>
        ${subs.length ? `
        <div class="qb-progress" aria-label="${subDone} of ${subs.length} steps done">
          <span class="qb-progress-n">${subDone}/${subs.length}</span>
          <span class="qb-progress-track"><span class="qb-progress-fill" style="width:${pct}%"></span></span>
        </div>` : ''}
        ${t.description ? `<p class="qb-detail">${App.utils.escapeHtml(t.description)}</p>` : ''}
      </div>`;
    App.utils.makeActivatable(card, null, `Open task: ${t.title}`);
    // Card body taps open the edit sheet. The complete circle keeps its own
    // data-action and is served by TaskListView's delegated vocabulary, so it
    // must not be swallowed here. stopPropagation keeps the delegated handler
    // from also running selectTask, which would open the detail page behind
    // the sheet.
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      e.stopPropagation();
      view.controller.openTaskSheet(t.id);
    });
    return card;
  }

  function renderControls(view) {
    const wrap = document.createElement('div');
    wrap.className = 'qb-controls';
    const segs = [['open', 'Open'], ['done', 'Done'], ['all', 'All']];
    // 'overall' spans every company and is not a filter target.
    const companies = [['all', 'All']].concat(
      Object.values(App.COMPANIES || {})
        .filter(c => !c.all)
        .map(c => [c.id, c.label]));

    wrap.innerHTML = `
      <div class="qb-seg" role="tablist" aria-label="Task segment">
        ${segs.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}"
           aria-selected="${seg(view) === k}" class="${seg(view) === k ? 'is-on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="qb-chips" role="group" aria-label="Filter by company">
        ${companies.map(([id, label]) => `<button type="button" data-company="${id}"
           class="${chip(view) === id ? 'is-on' : ''}">${id === 'all' ? '' : swatch(App.utils.companyColor(id))}${App.utils.escapeHtml(label || id)}</button>`).join('')}
      </div>`;

    // Bound here, not in TaskListView's delegated handler: those are row actions
    // keyed on [data-id], and these controls sit outside any card.
    wrap.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      view.controller.uiState.quickSeg = b.dataset.seg;
      view.renderList();
    }));
    wrap.querySelectorAll('[data-company]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      view.controller.uiState.quickCompany = b.dataset.company;
      view.renderList();
    }));
    return wrap;
  }

  layouts.quick = {
    mount(view) { view.body.classList.add('qb-mounted'); },
    unmount(view) { view.body.classList.remove('qb-mounted'); },

    render(view, tasks) {
      view.body.className = 'qb-board qb-mounted';
      view.body.innerHTML = '';
      // The table's column header means nothing here, the same way cards and
      // kanban drop it.
      const listHeader = document.querySelector('#taskViewWrap .list-header');
      if (listHeader) listHeader.classList.add('hidden');

      view.body.appendChild(renderControls(view));

      const todayIso = App.utils.todayISO(0);
      const company = chip(view);
      let list = App.QuickBoard.bySegment(tasks, seg(view));
      if (company !== 'all') list = list.filter(t => t.company === company);
      list = App.QuickBoard.sort(list);

      if (!list.length) { view._renderEmpty(view._emptyConfig()); return; }

      const frag = document.createDocumentFragment();
      list.forEach(t => frag.appendChild(renderCard(view, t, todayIso)));
      const listEl = document.createElement('div');
      listEl.className = 'qb-list';
      listEl.appendChild(frag);
      view.body.appendChild(listEl);
    },
  };
})();
