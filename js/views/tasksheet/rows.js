/* Field rows for the mobile task sheet.
   Row anatomy is the handoff's and matches the lead detail card: mono label in
   a fixed left column, value right-aligned with an optional leading swatch,
   caret at the end, whole row a tap target. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const CORE = [
    { field: 'company',  label: 'COMPANY' },
    { field: 'assignee', label: 'ASSIGNEE' },
    { field: 'priority', label: 'PRIORITY' },
    { field: 'status',   label: 'STATUS' },
    { field: 'type',     label: 'TYPE' },
    { field: 'due',      label: 'DUE' },
    { field: 'time',     label: 'TIME' },
  ];
  const MORE = [
    { field: 'reminder', label: 'REMINDER' },
    { field: 'label',    label: 'LABEL' },
    { field: 'project',  label: 'PROJECT' },
  ];

  // Values that mean "nothing chosen" render muted, per the handoff.
  const EMPTY = ['No time', 'None', 'No project', 'No date', 'No label', 'Unassigned'];

  function valueHtml(display) {
    return (display.swatch || '') + (display.pill
      ? `<span class="ts-pill ${display.pillCls || ''}">${App.utils.escapeHtml(display.label)}</span>`
      : App.utils.escapeHtml(display.label));
  }

  function row(def, display) {
    const muted = EMPTY.indexOf(display.label) !== -1;
    return `
      <button class="ts-row" type="button" data-field="${def.field}"
              aria-label="${def.label.toLowerCase()}: ${App.utils.escapeHtml(display.label)}">
        <span class="ts-lab">${def.label}</span>
        <span class="ts-val ${muted ? 'is-empty' : ''}">${valueHtml(display)}</span>
        <i class="ts-car ti ti-chevron-down" aria-hidden="true"></i>
      </button>`;
  }

  function render(form, ctx) {
    const d = ctx.display;              // display(field) -> { label, swatch, pill, pillCls }
    return `
      <div class="ts-group">${CORE.map(def => row(def, d(def.field))).join('')}</div>
      <button class="ts-more-toggle" type="button" aria-expanded="false">
        <i class="ti ti-chevron-right"></i> REMINDER · LABEL · PROJECT
      </button>
      <div class="ts-group ts-more" hidden>${MORE.map(def => row(def, d(def.field))).join('')}</div>
      <label class="ts-section">
        <span class="ts-section-lab">DETAIL</span>
        <textarea class="ts-detail" rows="2"
                  placeholder="Add context, links, scope, measurements, anything…">${App.utils.escapeHtml(form.detail || '')}</textarea>
      </label>
      <div class="ts-section">
        <span class="ts-section-lab">CHECKLIST</span>
        <ul class="ts-checklist" data-checklist></ul>
        <div class="ts-check-add">
          <input class="ts-check-in" type="text" placeholder="Add a step, press +" aria-label="Add a checklist step">
          <button class="ts-check-btn btn btn-primary" type="button" aria-label="Add step">+</button>
        </div>
      </div>`;
  }

  function update(sheetEl, field, display) {
    const rowEl = sheetEl.querySelector(`.ts-row[data-field="${field}"]`);
    if (!rowEl) return;
    const el = rowEl.querySelector('.ts-val');
    const muted = EMPTY.indexOf(display.label) !== -1;
    el.classList.toggle('is-empty', muted);
    el.innerHTML = valueHtml(display);
    // Keep the accessible name in step with the visible value.
    const lab = rowEl.querySelector('.ts-lab').textContent.toLowerCase();
    rowEl.setAttribute('aria-label', `${lab}: ${display.label}`);
  }

  TS.rows = { render, update, CORE, MORE };
})();
