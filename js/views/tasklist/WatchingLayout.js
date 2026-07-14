/* Watching layout adapter (CONTEXT.md: Layout) — two stacked panels in one
   section: the tasks the user is watching (cards via the shared
   view.renderKanbanCard), then, for supervisors with direct reports, a team
   dashboard. Reached via the 'watching' VIEW, not the layout switcher. */
(function () {
  'use strict';
  window.App = window.App || {};
  const layouts = (App.TaskListLayouts = App.TaskListLayouts || {});

  // Panel 1 — tasks the current user is watching. Company-scoped to the active
  // company but NOT role-scoped: being a watcher is itself the reason to see
  // it, so a watched task assigned to someone else still appears (the client
  // only holds tasks RLS already let it read). Mirrors the sidebar badge count.
  function renderWatchedTasksInto(view, container) {
    const me = view.currentUser;
    const cur = view.controller.uiState.currentCompany;
    let watched = view.taskModel.all().filter(t =>
      !t.clearedAt && !App.taxonomy.isDone(t) && (t.watchers || []).includes(me));
    if (cur && cur !== '*') watched = watched.filter(t => App.utils.taskInCompany(t, cur));

    const sec = document.createElement('div');
    sec.className = 'watch-section';
    sec.innerHTML = `<div class="watch-section-head"><i class="ti ti-eye"></i><span>Tasks you're watching</span><span class="group-count">${watched.length}</span></div>`;
    const body = document.createElement('div');
    body.className = 'watch-cards';
    if (watched.length) {
      watched.forEach(t => body.appendChild(view.renderKanbanCard(t)));
    } else {
      body.innerHTML = `<div class="watch-empty"><i class="ti ti-eye-off"></i> You're not watching any tasks. Add yourself as a watcher on a task and it'll show up here.</div>`;
    }
    sec.appendChild(body);
    container.appendChild(sec);
  }

  // Panel 2 — the manager's direct-reports dashboard. Appends a titled section
  // into `container` instead of owning the whole body.
  function renderWatchingTeamInto(view, container) {
    const me = view.currentUser;
    const profiles = App.PROFILES || [];
    const reports = profiles.filter(p => p.supervisor_id === me && p.approved !== false);
    // No direct reports (e.g. a worker, or a manager with none) → skip the team
    // panel entirely rather than showing an empty box.
    if (reports.length === 0) return;

    const sec = document.createElement('div');
    sec.className = 'watch-section';
    sec.innerHTML = `<div class="watch-section-head"><i class="ti ti-users"></i><span>Your team</span><span class="group-count">${reports.length}</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'team-grid';
    sec.appendChild(grid);
    container.appendChild(sec);

    const today = App.utils.todayISO(0);
    const threeDaysAgo = App.utils.todayISO(-3);
    const roleLabels = (App.ROLES || {});

    reports.forEach(p => {
      const memberId = p.member_id;
      const person = App.directory.person(memberId) || { name: p.full_name || memberId, full: p.full_name || memberId, color: '#888' };
      const tasks = view.taskModel.all().filter(t => App.utils.isAssignee(t, memberId));
      const open = tasks.filter(t => !App.taxonomy.isDone(t));
      const overdue = open.filter(t => t.due && t.due < today);
      const dueToday = open.filter(t => t.due === today);
      const completedRecent = tasks.filter(t => t.completedAt && App.utils.hqDateOf(t.completedAt) >= threeDaysAgo);

      const flagOverdue = overdue.length > 0;
      const flagStale = open.length > 0 && completedRecent.length === 0;
      const flagged = flagOverdue || flagStale;
      const initials = App.utils.initials(person.full || person.name || memberId);
      const role = (roleLabels[p.role] && roleLabels[p.role].label) || p.role || 'Member';

      const card = document.createElement('div');
      card.className = 'team-card' + (flagged ? ' is-flagged' : ' is-ok');
      card.dataset.member = memberId;
      card.innerHTML = `
        <div class="team-card-head">
          <div class="team-avatar" style="background:${App.utils.safeColor(person.color)};">${App.utils.escapeHtml(initials)}</div>
          <div class="team-info">
            <div class="team-name">${App.utils.escapeHtml(person.full || person.name || memberId)}</div>
            <div class="team-role">${App.utils.escapeHtml(role)}</div>
          </div>
          <span class="team-status">
            <i class="ti ${flagged ? 'ti-alert-circle' : 'ti-circle-check'}"></i>
            ${flagged ? 'Needs attention' : 'On track'}
          </span>
        </div>
        <div class="team-stats">
          <div class="team-stat ${overdue.length > 0 ? 'is-warn' : ''}">
            <div class="team-stat-num">${overdue.length}</div>
            <div class="team-stat-label">Overdue</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-num">${dueToday.length}</div>
            <div class="team-stat-label">Today</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-num">${open.length}</div>
            <div class="team-stat-label">Open</div>
          </div>
        </div>
        ${flagStale && !flagOverdue
          ? `<div class="team-note"><i class="ti ti-clock-pause"></i> No task completions in the last 3 days.</div>`
          : ''}
        ${flagOverdue
          ? `<div class="team-note"><i class="ti ti-alert-triangle"></i> ${overdue.length} task${overdue.length > 1 ? 's' : ''} past due.</div>`
          : ''}
        <div class="team-actions">
          <button class="btn btn-sm" data-action="view-tasks" data-member="${memberId}">
            <i class="ti ti-list-details"></i>View tasks
          </button>
          <button class="btn btn-sm btn-primary" data-action="ping" data-member="${memberId}" data-overdue="${overdue.length}" data-stale="${flagStale ? 1 : 0}">
            <i class="ti ti-bell-ringing"></i>Ping
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action]');
        if (!t) return;
        e.stopPropagation();
        const mid = t.dataset.member;
        if (t.dataset.action === 'view-tasks') {
          view.controller.setView('person:' + mid);
        } else if (t.dataset.action === 'ping') {
          view.controller.pingTeamMember(mid, {
            overdue: parseInt(t.dataset.overdue, 10) || 0,
            stale: t.dataset.stale === '1',
          });
        }
      });

      grid.appendChild(card);
    });
  }

  layouts.watching = {
    render(view) {
      view.body.className = 'watching-view';
      view.body.innerHTML = '';
      const header = document.querySelector('#taskViewWrap .list-header');
      if (header) header.classList.add('hidden');
      renderWatchedTasksInto(view, view.body);
      renderWatchingTeamInto(view, view.body);
    },
  };
})();
