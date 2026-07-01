window.App = window.App || {};

/* Settings → Task setup (Phase 3). Admin-only screen to customize the per-company
   task taxonomy — types, per-type statuses, and labels. Renders into the shared
   #timeViewWrap like the other admin surfaces (ApprovalView / ClockDashboardView),
   activated on the 'admin:task-setup' view. Full CRUD lands in a later step. */
App.TaskSetupAdminView = class TaskSetupAdminView {
  constructor({ controller }) {
    this.controller = controller;
    this.dataStore = controller.dataStore;
    this.wrap = document.getElementById('timeViewWrap');
    this.company = null;       // concrete company being edited
    this.selectedType = null;  // selected type key — drives the statuses column

    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', (view) => { if (view === 'admin:task-setup') this.render(); });
    App.EventBus.on('taxonomy:changed', rerender);
    App.EventBus.on('company:changed', () => { this.company = null; rerender(); });
  }

  visible() {
    return this.controller.uiState.view === 'admin:task-setup'
      && this.wrap && !this.wrap.classList.contains('hidden');
  }

  render() {
    if (!this.wrap) this.wrap = document.getElementById('timeViewWrap');
    if (!this.wrap) return;
    if (!App.can('task-setup.manage')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><p>Only admins can edit task setup.</p></div>`;
      return;
    }
    this.wrap.innerHTML = `<div class="tsetup"><h2 class="tsetup-title">Task setup</h2><p class="tsetup-sub">Loading…</p></div>`;
  }
};
