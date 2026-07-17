window.App = window.App || {};

/* BottomNavView — the phone-only Instagram-style bottom tab bar.
   Five slots: Home · Tasks · ⊕ · Projects · Team. The raised orange
   center ⊕ is the only New-Task entry point on mobile (the old floating
   FAB is CSS-hidden ≤720px); the Team tab opens the Team workload board
   (gated to roles that can see team time — it's dropped for everyone else).
   Account/profile stays reachable via the topbar avatar, and the full
   secondary navigation (Reports / admin / workspaces / views) through the
   brand-mark drawer toggle, so no destination is stranded. Rendered into
   #bottomNav in app.html and shown only ≤720px via css/mobile.css.

   Routing reuses the controller seams the rest of the app uses
   (goHome / setView / openNewTaskPage), so nothing new is wired downstream.
   Active state + permission gating repaint on view:changed / role:changed. */
App.BottomNavView = class BottomNavView {
  constructor({ controller }) {
    this.controller = controller;
    this.mount = document.getElementById('bottomNav');
    if (!this.mount) return;

    // The task views the "Tasks" tab should light up for (mirrors the desktop
    // primary-nav "Tasks ▾" matches list).
    this.taskViews = ['all', 'mine', 'hot', 'today', 'overdue', 'watching'];

    this.render();
    this.subscribe();
  }

  // The five tabs, in order. `match(view)` decides the active state; a slot is
  // dropped entirely when `gate()` returns false (e.g. Projects for a role that
  // can't see it, or ⊕ for a user who can't create tasks).
  _model() {
    const canView = (v) => this.controller.canView(v);
    return [
      { key: 'home',     label: 'Home',     icon: 'ti-home',       action: () => this.controller.goHome(),
        gate: () => canView('home'), match: (v) => v === 'home' },
      { key: 'tasks',    label: 'Tasks',    icon: 'ti-list-check', action: () => this.controller.setView('all'),
        gate: () => App.can('tasks.view'), match: (v) => this.taskViews.includes(v) },
      { key: 'new',      label: 'New',      icon: 'ti-plus',       action: () => this.controller.openNewTaskPage(),
        gate: () => App.can('tasks.write'), match: () => false, center: true },
      { key: 'projects', label: 'Projects', icon: 'ti-folder',     action: () => this.controller.setView('projects'),
        gate: () => canView('projects'), match: (v) => v === 'projects' },
      { key: 'team',     label: 'Team',     icon: 'ti-users',      action: () => this.controller.setView('time:resource'),
        gate: () => App.can('time.team'), match: (v) => v === 'time:resource' },
    ];
  }

  render() {
    const items = this._model().filter(it => it.gate());
    this.mount.innerHTML = items.map(it => {
      const active = it.match(this.controller.uiState.view) ? ' active' : '';
      const center = it.center ? ' bn-center' : '';
      return `<button type="button" class="bn-tab${center}${active}" data-nav="${it.key}" aria-label="${it.label}">
        <i class="ti ${it.icon}" aria-hidden="true"></i>
        <span class="bn-label">${it.label}</span>
      </button>`;
    }).join('');

    this.mount.querySelectorAll('.bn-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = this._model().find(i => i.key === btn.dataset.nav);
        if (item) item.action();
      });
    });
  }

  // Only the active-state classes change on a view switch — no need to rebuild
  // the markup (which would also re-gate on every navigation).
  paintActive() {
    const view = this.controller.uiState.view;
    const model = this._model();
    this.mount.querySelectorAll('.bn-tab').forEach(btn => {
      const item = model.find(i => i.key === btn.dataset.nav);
      btn.classList.toggle('active', !!(item && item.match(view)));
    });
  }

  subscribe() {
    App.EventBus.on('view:changed', () => this.paintActive());
    // Role / permission changes can add or drop tabs (e.g. Projects, ⊕), so the
    // whole bar is rebuilt.
    App.EventBus.on('role:changed', () => this.render());
  }
};
