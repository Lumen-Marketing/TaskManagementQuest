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
    this.render();
  }

  render() {
    if (!this.mount) return;

    // Clean up drag-reorder handler from previous render (not signal-based —
    // makeReorderable owns its own listener teardown).
    this._reorderCleanup?.();
    this._reorderCleanup = null;

    // Abort all signal-based listeners from the previous render, then issue a
    // fresh signal for this render's subscriptions.
    this._ac?.abort();
    this._ac = new AbortController();

    // EventBus subscriptions — re-established each render via signal so exactly
    // one set is active at any time; previous render's set is already aborted.
    App.EventBus.on('tasks:changed', () => this.render(), { signal: this._ac.signal });
    App.EventBus.on('view:changed',  () => this.render(), { signal: this._ac.signal });
    App.EventBus.on('sort:changed',  () => this.render(), { signal: this._ac.signal });

    // When the list is already sorted by Execution order it shows the full
    // sequenced list — the widget becomes a compact "Close" toggle to exit
    // (rather than duplicating the rows).
    if (this.controller.uiState.sortBy === 'focus') { this.renderActive(); return; }

    const all = this.taskModel.focusList();
    // Nothing ordered yet: instead of vanishing (which made the feature
    // undiscoverable), show a prompt that opens the execution-order view.
    if (!all.length) { this.renderEmpty(); return; }

    const shown = all.slice(0, this.MAX);
    const canEdit = App.can('tasks.write');

    // Total count lives in the header (like the sidebar badges) so the body is
    // just the top rows — keeps the card the same 88px height as its neighbours.
    this.mount.innerHTML = `
      <div class="focus-widget">
        <button type="button" class="focus-widget-head" data-action="open-focus">
          <span class="focus-widget-eyebrow"><i class="ti ti-list-numbers"></i> Focus<span class="focus-widget-count">${all.length}</span></span>
          <span class="focus-widget-open">Open</span>
        </button>
        <div class="focus-widget-rows"></div>
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
      }, { signal: this._ac.signal });
      rowsEl.appendChild(row);
    });

    // "Open" folds the full list into the main table via the Execution-order
    // sort (ensure we're on the table layout so the sequenced list shows).
    this.mount.querySelector('[data-action="open-focus"]').addEventListener('click', () => {
      this.controller.setLayout('table');
      this.controller.setSortBy('focus');
    }, { signal: this._ac.signal });

    if (canEdit && App.makeReorderable) {
      this._reorderCleanup = App.makeReorderable(rowsEl, {
        onDrop: (movedId, newIndex) => {
          const ordered = this.taskModel.focusList().filter(t => t.id !== movedId);
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
    this.mount.querySelector('[data-action="close-focus"]').addEventListener('click',
      () => this.controller.setSortBy('priority'),
      { signal: this._ac.signal }
    );
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
    }, { signal: this._ac.signal });
  }
};
