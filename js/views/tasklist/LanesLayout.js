/*
  Work Lanes — operational task surface.

  Groups work by task type into horizontal lanes instead of presenting
  the task collection as a spreadsheet. Existing task routing, selection,
  permissions and controller actions remain unchanged.
*/
(function () {
  'use strict';

  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  const PREFERRED_ORDER = [
    'lead',
    'bid',
    'field_work',
    'admin',
    'invoicing',
    'ar',
    'meeting',
    'web_dev'
  ];

  const TYPE_META = {
    lead:       { short: 'Lead', icon: 'ti-user-plus' },
    bid:        { short: 'Bid / Estimate', icon: 'ti-file-dollar' },
    field_work: { short: 'Field Work', icon: 'ti-building-construction' },
    admin:      { short: 'Admin', icon: 'ti-settings' },
    invoicing:  { short: 'Invoicing', icon: 'ti-receipt' },
    ar:         { short: 'AR', icon: 'ti-coin' },
    meeting:    { short: 'Meetings', icon: 'ti-calendar-event' },
    web_dev:    { short: 'Software / Web', icon: 'ti-code' }
  };

  function typeLabel(key) {
    const t = (App.TASK_TYPES || {})[key];
    return (t && t.label) || (TYPE_META[key] && TYPE_META[key].short) || key || 'Other';
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .map(x => x[0] || '')
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  }

  function laneState(tasks, today) {
    const open = tasks.filter(t => !App.taxonomy.isDone(t));
    const overdue = open.filter(t => t.due && t.due < today).length;
    const blocked = open.filter(t => t.status === 'hold').length;
    const review = open.filter(t => t.status === 'review').length;

    if (blocked) return { key: 'blocked', label: `${blocked} blocked` };
    if (overdue) return { key: 'attention', label: `${overdue} overdue` };
    if (review) return { key: 'review', label: `${review} in review` };
    return { key: 'moving', label: open.length ? 'Moving' : 'Clear' };
  }

  function renderTask(view, t, today) {
    const done = App.taxonomy.isDone(t);
    const assignees = App.utils.taskAssignees(t);
    const people = assignees
      .map(id => ({
        id,
        name: view.controller.getUserName(id)
      }))
      .filter(p => p.name);

    const overdue = !done && t.due && t.due < today;
    const blocked = !done && t.status === 'hold';
    const review = !done && t.status === 'review';

    const card = document.createElement('article');
    card.className = [
      'wl-task',
      done ? 'is-done' : '',
      overdue ? 'is-overdue' : '',
      blocked ? 'is-blocked' : '',
      review ? 'is-review' : ''
    ].filter(Boolean).join(' ');

    card.dataset.id = t.id;

    const due = t.due ? App.utils.formatDue(t.due) : null;
    const status = App.taxonomy.statusMeta
      ? App.taxonomy.statusMeta(t.company, t.type, t.status)
      : null;

    card.innerHTML = `
      <div class="wl-task-state"></div>

      <div class="wl-task-main">
        <div class="wl-task-title">${App.utils.escapeHtml(t.title)}</div>

        <div class="wl-task-meta">
          <span>${App.utils.escapeHtml((status && status.label) || ((App.STATUSES[t.status] || {}).label || t.status || ''))}</span>
          ${due ? `<span class="${overdue ? 'is-danger' : ''}">${App.utils.escapeHtml(due.text)}</span>` : ''}
        </div>
      </div>

      <div class="wl-task-people" aria-label="Assigned people">
        ${people.slice(0, 3).map(p => `
          <span class="wl-avatar" title="${App.utils.escapeHtml(p.name)}">
            ${App.utils.escapeHtml(initials(p.name))}
          </span>
        `).join('')}
        ${people.length > 3 ? `<span class="wl-avatar wl-more">+${people.length - 3}</span>` : ''}
      </div>

      <span class="wl-task-arrow" aria-hidden="true">→</span>
    `;

    App.utils.makeActivatable(card, null, `Open task: ${t.title}`);

    card.addEventListener('click', e => {
      if (e.target.closest('[data-action]')) return;
      view.controller.selectTask(t.id);
    });

    return card;
  }

  layouts.lanes = {
    mount(view) {
      view.body.classList.add('wl-mounted');
    },

    unmount(view) {
      view.body.classList.remove('wl-mounted');
    },

    render(view, tasks) {
      view.body.className = 'work-lanes wl-mounted';
      view.body.innerHTML = '';

      const listHeader = document.querySelector('#taskViewWrap .list-header');
      if (listHeader) listHeader.classList.add('hidden');

      const today = App.utils.todayISO(0);

      const byType = new Map();

      tasks.forEach(t => {
        const key = t.type || 'other';
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key).push(t);
      });

      const keys = [...byType.keys()].sort((a, b) => {
        const ai = PREFERRED_ORDER.indexOf(a);
        const bi = PREFERRED_ORDER.indexOf(b);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });

      if (!keys.length) {
        view._renderEmpty(view._emptyConfig());
        return;
      }

      const rail = document.createElement('div');
      rail.className = 'wl-rail';

      keys.forEach(key => {
        const laneTasks = byType.get(key) || [];
        const state = laneState(laneTasks, today);
        const meta = TYPE_META[key] || { icon: 'ti-box' };

        const lane = document.createElement('section');
        lane.className = `wl-lane state-${state.key}`;
        lane.dataset.type = key;

        lane.innerHTML = `
          <header class="wl-lane-head">
            <div class="wl-lane-identity">
              <span class="wl-lane-icon"><i class="ti ${meta.icon}"></i></span>

              <div>
                <span class="wl-lane-kicker">WORK LANE</span>
                <h3>${App.utils.escapeHtml(typeLabel(key))}</h3>
              </div>
            </div>

            <div class="wl-lane-health">
              <span class="wl-health-dot"></span>
              <span>${App.utils.escapeHtml(state.label)}</span>
              <strong>${laneTasks.filter(t => !App.taxonomy.isDone(t)).length}</strong>
            </div>
          </header>

          <div class="wl-track">
            <div class="wl-track-line"></div>
            <div class="wl-track-items"></div>
          </div>
        `;

        const items = lane.querySelector('.wl-track-items');

        laneTasks
          .slice()
          .sort((a, b) => {
            const ad = a.due || '9999-99-99';
            const bd = b.due || '9999-99-99';

            if (ad !== bd) return ad.localeCompare(bd);

            const ap = (App.PRIORITIES[a.priority] || App.PRIORITIES.medium).order;
            const bp = (App.PRIORITIES[b.priority] || App.PRIORITIES.medium).order;

            return ap - bp;
          })
          .forEach(t => items.appendChild(renderTask(view, t, today)));

        rail.appendChild(lane);
      });

      view.body.appendChild(rail);
    }
  };
})();
