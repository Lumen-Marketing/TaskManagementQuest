window.App = window.App || {};

/* BulkActionsView — the floating action bar shown while bulk-select mode is on.
   It reads selection state from the controller (uiState.bulkSelected) and fires
   the controller's bulk* methods. Visibility is driven by the 'bulk:changed'
   event, which AppController emits whenever the mode or selection changes. */
App.BulkActionsView = class BulkActionsView {
  constructor({ controller }) {
    this.controller = controller;
    this.el = document.getElementById('bulkBar');
    if (!this.el) return;
    App.EventBus.on('bulk:changed', () => this.render());
    this.render();
  }

  render() {
    const ui = this.controller.uiState;
    const count = ui.bulkSelected.size;
    const show = !!ui.bulkMode;
    this.el.classList.toggle('hidden', !show);
    document.body.classList.toggle('has-bulk-bar', show);
    if (!show) { this.el.innerHTML = ''; return; }

    const total = this.controller.getVisibleTasks().length;
    const allSelected = total > 0 && count >= total;
    const canWrite = App.can('tasks.write');
    const canDelete = this.controller.canDeleteTasks && this.controller.canDeleteTasks();

    this.el.innerHTML = `
      <div class="bulk-bar-count">
        <button class="bulk-bar-close" data-bulk="cancel" aria-label="Exit selection"><i class="ti ti-x"></i></button>
        <span><strong>${count}</strong> selected</span>
      </div>
      <div class="bulk-bar-actions">
        <button class="btn btn-sm" data-bulk="all">
          <i class="ti ti-${allSelected ? 'square-off' : 'checkbox'}"></i>${allSelected ? 'Clear' : 'Select all'}
        </button>
        ${canWrite ? `<button class="btn btn-sm" data-bulk="complete" ${count ? '' : 'disabled'}><i class="ti ti-circle-check"></i>Complete</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm bulk-danger" data-bulk="delete" ${count ? '' : 'disabled'}><i class="ti ti-trash"></i>Delete</button>` : ''}
      </div>`;

    this.el.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.bulk;
      if (a === 'cancel') this.controller.exitBulkMode();
      else if (a === 'all') this.controller.bulkSelectAllVisible();
      else if (a === 'complete') this.controller.bulkComplete();
      else if (a === 'delete') this.controller.bulkDelete();
    }));
  }
};
