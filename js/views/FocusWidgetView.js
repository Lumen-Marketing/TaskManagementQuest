window.App = window.App || {};

/* FocusWidgetView — a compact, drag-reorderable peek at the current person's
   Focus list (execution order), in the page head beside Up next. Header opens
   the full Focus view; rows open their task. Hidden when the list is empty so
   it never shows dead chrome. */
App.FocusWidgetView = class FocusWidgetView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;
    this.mount = document.getElementById('focusWidget');
    if (!this.mount) return;
    this.MAX = 2; // fits the 88px card next to Up next / Progress; rest = "+N more"
    this.subscribe();
    this.render();
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.render());
    App.EventBus.on('view:changed',  () => this.render());
    App.EventBus.on('sort:changed',  () => this.render());
  }

  render() {
    if (!this.mount) return;
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    // When the list is already sorted by Execution order it shows the full
    // sequenced list — the widget becomes a compact "Close" toggle to exit
    // (rather than duplicating the rows).
    if (this.controller.uiState.sortBy === 'focus') { this.renderActive(); return; }

    const ownerId = this.controller.focusOwnerId();
    const all = this.taskModel.focusList(ownerId);
    // Nothing ordered yet: instead of vanishing (which made the feature
    // undiscoverable), show a prompt that opens the execution-order view.
    if (!all.length) { this.renderEmpty(); return; }

    const shown = all.slice(0, this.MAX);
    const canEdit = this.controller.canSetFocusFor(shown[0]);
    const extra = all.length - shown.length;

    this.mount.innerHTML = `
      <div class="focus-widget">
        <button type="button" class="focus-widget-head" data-action="open-focus">
          <span class="focus-widget-eyebrow"><i class="ti ti-list-numbers"></i> Focus</span>
          <span class="focus-widget-open">Open</span>
        </button>
        <div class="focus-widget-rows"></div>
        ${extra > 0 ? `<div class="focus-widget-more">+${extra} more</div>` : ''}
      </div>
    `;

    const rowsEl = this.mount.querySelector('.focus-widget-rows');
    shown.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'focus-widget-row';
      row.dataset.id = t.id;
      row.innerHTML = `
        <span class="focus-widget-rank">${i + 1}</span>
        <span class="focus-widget-title" title="${App.utils.escapeHtml(t.title)}">${App.utils.escapeHtml(t.title)}</span>
      `;
      row.addEventListener('click', () => {
        if (row.classList.contains('dragging')) return;
        this.controller.selectTask(t.id);
      });
      rowsEl.appendChild(row);
    });

    // "Open" folds the full list into the main table via the Execution-order
    // sort (ensure we're on the table layout so the sequenced list shows).
    this.mount.querySelector('[data-action="open-focus"]').addEventListener('click', () => {
      this.controller.setLayout('table');
      this.controller.setSortBy('focus');
    });

    if (canEdit && App.makeReorderable) {
      this._cleanup = App.makeReorderable(rowsEl, {
        onDrop: (movedId, newIndex) => {
          const ordered = this.taskModel.focusList(ownerId).filter(t => t.id !== movedId);
          const before = ordered[newIndex - 1];
          const after = ordered[newIndex];
          let seq;
          if (!before && !after) seq = 0;
          else if (!before) seq = after.focusSeq - 1;
          else if (!after) seq = before.focusSeq + 1;
          else seq = (before.focusSeq + after.focusSeq) / 2;
          this.controller.setFocusOrder(movedId, seq);
        },
      });
    }
  }

  // Active state — shown while the list is in Execution-order sort. A one-click
  // "Close" returns to the normal list (default Priority sort).
  renderActive() {
    this.mount.innerHTML = `
      <div class="focus-widget focus-widget-empty">
        <button type="button" class="focus-widget-head" data-action="close-focus">
          <span class="focus-widget-eyebrow"><i class="ti ti-list-numbers"></i> Focus</span>
          <span class="focus-widget-open">Close</span>
        </button>
        <div class="focus-widget-hint">Showing execution order — drag rows to reorder.</div>
      </div>
    `;
    this.mount.querySelector('[data-action="close-focus"]').addEventListener('click', () => this.controller.setSortBy('priority'));
  }

  // Empty-state prompt — keeps the widget visible so the execution-order view
  // is discoverable even before anything is ranked.
  renderEmpty() {
    this.mount.innerHTML = `
      <div class="focus-widget focus-widget-empty">
        <button type="button" class="focus-widget-head" data-action="open-focus">
          <span class="focus-widget-eyebrow"><i class="ti ti-list-numbers"></i> Focus</span>
          <span class="focus-widget-open">Set order</span>
        </button>
        <div class="focus-widget-hint">Drag tasks to set your execution order.</div>
      </div>
    `;
    this.mount.querySelector('[data-action="open-focus"]').addEventListener('click', () => {
      this.controller.setLayout('table');
      this.controller.setSortBy('focus');
    });
  }
};
